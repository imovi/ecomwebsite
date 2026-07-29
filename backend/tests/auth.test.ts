import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, seedAdmin, startTestServer, type TestContext } from "./helpers/test-server.js";

/**
 * Admin authentication — integration tests.
 *
 * These run the real stack end to end: real HTTP, real middleware order, real
 * Argon2 hashing, real SQL against a real Postgres engine. Nothing is mocked,
 * so a pass here means the flow genuinely works rather than that the mocks
 * agree with each other.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string; details?: { field: string; message: string }[] };
  requestId: string;
}

interface LoginData {
  admin: { id: string; email: string; role: string };
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

const PASSWORD = "CorrectHorse123";

let ctx: TestContext;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  await ctx.close();
});

/* -------------------------------------------------------------------------- */

describe("infrastructure", () => {
  it("reports liveness without touching the database", async () => {
    const res = await api<Envelope<{ status: string }>>(ctx.baseUrl, "/health/live");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, "ok");
  });

  it("reports readiness including the database", async () => {
    const res = await api<Envelope<{ status: string; checks: { database: { status: string } } }>>(
      ctx.baseUrl,
      "/health/ready",
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.checks.database.status, "ok");
  });

  it("returns a consistent error envelope for unknown routes", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/does-not-exist");
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error?.code, "ROUTE_NOT_FOUND");
    assert.ok(res.body.requestId, "every response carries a request id");
  });

  it("echoes the request id header", async () => {
    const res = await api(ctx.baseUrl, "/api/v1");
    assert.ok(res.headers.get("x-request-id"));
  });

  it("sets security headers", async () => {
    const res = await api(ctx.baseUrl, "/api/v1");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-powered-by"), null);
  });
});

describe("validation", () => {
  it("rejects a malformed body with field-level detail", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "not-an-email", password: "" },
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error?.code, "VALIDATION_ERROR");
    const fields = res.body.error?.details?.map((d) => d.field) ?? [];
    assert.ok(fields.includes("body.email"));
    assert.ok(fields.includes("body.password"));
  });

  it("rejects unknown keys rather than ignoring them", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "a@b.com", password: "whatever", isAdmin: true },
    });
    assert.equal(res.status, 422);
  });

  it("rejects malformed JSON with a specific code", async () => {
    const response = await fetch(`${ctx.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    const body = (await response.json()) as Envelope<never>;
    assert.equal(response.status, 400);
    assert.equal(body.error?.code, "MALFORMED_JSON");
  });
});

describe("login", () => {
  before(async () => {
    await seedAdmin({ email: "owner@gng.com.bd", password: PASSWORD, role: "super_admin" });
    await seedAdmin({ email: "manager@gng.com.bd", password: PASSWORD, role: "manager" });
    await seedAdmin({
      email: "disabled@gng.com.bd",
      password: PASSWORD,
      isActive: false,
    });
  });

  it("issues an access token and a refresh cookie", async () => {
    const res = await api<Envelope<LoginData>>(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "owner@gng.com.bd", password: PASSWORD },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.admin.email, "owner@gng.com.bd");
    assert.equal(res.body.data.tokenType, "Bearer");
    assert.ok(res.body.data.accessToken.split(".").length === 3, "is a JWT");
    assert.ok(res.refreshCookie, "refresh token is delivered as a cookie");
  });

  it("never returns the password hash", async () => {
    const res = await api<Envelope<LoginData>>(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "owner@gng.com.bd", password: PASSWORD },
    });
    assert.ok(!JSON.stringify(res.body).includes("$argon2"));
  });

  it("marks the refresh cookie httpOnly and path-scoped", async () => {
    const response = await fetch(`${ctx.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@gng.com.bd", password: PASSWORD }),
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\/api\/v1\/auth/i);
  });

  it("is case-insensitive on email", async () => {
    const res = await api<Envelope<LoginData>>(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "OWNER@GNG.COM.BD", password: PASSWORD },
    });
    assert.equal(res.status, 200);
  });

  it("gives an identical response for a wrong password and an unknown account", async () => {
    const wrongPassword = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "owner@gng.com.bd", password: "WrongPassword123" },
    });
    const unknownAccount = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "nobody@gng.com.bd", password: "WrongPassword123" },
    });

    assert.equal(wrongPassword.status, unknownAccount.status);
    assert.equal(wrongPassword.body.error?.code, unknownAccount.body.error?.code);
    assert.equal(wrongPassword.body.error?.message, unknownAccount.body.error?.message);
  });

  it("refuses a disabled account", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "disabled@gng.com.bd", password: PASSWORD },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error?.code, "ACCOUNT_DISABLED");
  });

  it("locks an account after repeated failures", async () => {
    await seedAdmin({ email: "lockme@gng.com.bd", password: PASSWORD });

    // LOGIN_MAX_FAILED_ATTEMPTS is 3 in the test environment.
    for (let attempt = 0; attempt < 3; attempt++) {
      await api(ctx.baseUrl, "/api/v1/auth/login", {
        method: "POST",
        body: { email: "lockme@gng.com.bd", password: "WrongPassword123" },
      });
    }

    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "lockme@gng.com.bd", password: PASSWORD },
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.error?.code, "ACCOUNT_LOCKED");
  });
});

describe("protected routes", () => {
  let accessToken: string;

  before(async () => {
    const res = await api<Envelope<LoginData>>(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "owner@gng.com.bd", password: PASSWORD },
    });
    accessToken = res.body.data.accessToken;
  });

  it("rejects a request with no token", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/me");
    assert.equal(res.status, 401);
    assert.equal(res.body.error?.code, "UNAUTHORIZED");
  });

  it("rejects a malformed token", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/me", {
      accessToken: "not.a.jwt",
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error?.code, "TOKEN_INVALID");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const { SignJWT } = await import("jose");
    const forged = await new SignJWT({ email: "owner@gng.com.bd", role: "super_admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("00000000-0000-4000-8000-000000000000")
      .setJti("forged")
      .setIssuedAt()
      .setExpirationTime("15m")
      .setIssuer("gng-api")
      .setAudience("gng-admin")
      .sign(new TextEncoder().encode("a-completely-different-secret-32-chars"));

    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/me", {
      accessToken: forged,
    });
    assert.equal(res.status, 401);
  });

  it("returns the current admin for a valid token", async () => {
    const res = await api<Envelope<{ admin: { email: string; role: string } }>>(
      ctx.baseUrl,
      "/api/v1/auth/me",
      { accessToken },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.admin.email, "owner@gng.com.bd");
    assert.equal(res.body.data.admin.role, "super_admin");
  });
});

describe("refresh token rotation", () => {
  it("rotates the token on every use", async () => {
    const login = await api<Envelope<LoginData>>(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "owner@gng.com.bd", password: PASSWORD },
    });

    const first = login.refreshCookie!;
    const refreshed = await api<Envelope<LoginData>>(ctx.baseUrl, "/api/v1/auth/refresh", {
      method: "POST",
      body: {},
      refreshCookie: first,
    });

    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.refreshCookie);
    assert.notEqual(refreshed.refreshCookie, first, "a new refresh token is issued");
    assert.ok(refreshed.body.data.accessToken);
  });

  it("detects reuse and revokes the whole family", async () => {
    const login = await api<Envelope<LoginData>>(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "owner@gng.com.bd", password: PASSWORD },
    });

    const stolen = login.refreshCookie!;

    // Legitimate rotation.
    const rotated = await api<Envelope<LoginData>>(ctx.baseUrl, "/api/v1/auth/refresh", {
      method: "POST",
      body: {},
      refreshCookie: stolen,
    });
    assert.equal(rotated.status, 200);

    // The attacker replays the token that was already exchanged.
    const replay = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/refresh", {
      method: "POST",
      body: {},
      refreshCookie: stolen,
    });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error?.code, "REFRESH_TOKEN_REUSED");

    // The legitimate user's newer token is dead too — the family was revoked.
    const afterRevocation = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/refresh", {
      method: "POST",
      body: {},
      refreshCookie: rotated.refreshCookie!,
    });
    assert.equal(afterRevocation.status, 401);
  });

  it("rejects an unknown refresh token", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/refresh", {
      method: "POST",
      body: {},
      refreshCookie: "totally-made-up-token",
    });
    assert.equal(res.status, 401);
  });

  it("requires a refresh token to be supplied at all", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/refresh", {
      method: "POST",
      body: {},
    });
    assert.equal(res.status, 401);
  });
});

describe("logout", () => {
  it("revokes the session and clears the cookie", async () => {
    const login = await api<Envelope<LoginData>>(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "manager@gng.com.bd", password: PASSWORD },
    });

    const logout = await api<Envelope<{ message: string }>>(ctx.baseUrl, "/api/v1/auth/logout", {
      method: "POST",
      body: {},
      accessToken: login.body.data.accessToken,
      refreshCookie: login.refreshCookie!,
    });
    assert.equal(logout.status, 200);

    const reuse = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/refresh", {
      method: "POST",
      body: {},
      refreshCookie: login.refreshCookie!,
    });
    assert.equal(reuse.status, 401, "the revoked refresh token no longer works");
  });

  it("requires authentication", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/logout", {
      method: "POST",
      body: {},
    });
    assert.equal(res.status, 401);
  });
});

describe("rate limiting", () => {
  it("throttles repeated failed logins and sets Retry-After", async () => {
    const email = "ratelimit@gng.com.bd";
    let limited: Awaited<ReturnType<typeof api<Envelope<never>>>> | undefined;

    // AUTH_RATE_LIMIT_MAX is 5 in the test environment; successful requests
    // are not counted, so only failures consume the budget.
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/auth/login", {
        method: "POST",
        body: { email, password: "WrongPassword123" },
      });
      if (res.status === 429) {
        limited = res;
        break;
      }
    }

    assert.ok(limited, "the limiter eventually rejects");
    assert.equal(limited.body.error?.code, "RATE_LIMITED");
    assert.ok(limited.headers.get("retry-after"), "Retry-After is set");
  });
});
