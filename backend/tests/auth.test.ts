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

/* -------------------------------------------------------------------------- */

describe("seed credential handling", () => {
  /**
   * Regression guard for a silent, launch-blocking bug.
   *
   * `SEED_ADMIN_PASSWORD=` with no value — which is exactly what the shipped env
   * templates contain — used to reach the seeder as `""`. A truthiness check said
   * "no password configured, one was generated", while a `??` fallback kept the
   * empty string, so the first super admin was created with a blank password and
   * the operator was told to save a credential that had never been generated.
   *
   * The account was unusable (login requires at least one character) and the
   * seeder's idempotency guard then refused to replace it, which is a dead end on
   * the exact path the launch runbook prescribes.
   *
   * Tested at the env layer because that is where the fix lives: blank is
   * normalised to `undefined`, so every consumer sees "absent" rather than a
   * value that is present but empty.
   */
  it("treats a blank SEED_ADMIN_PASSWORD as absent, not as an empty password", async () => {
    const { loadEnv } = await import("../src/config/env.js");

    const base = {
      NODE_ENV: "test",
      JWT_ACCESS_SECRET: "x".repeat(48),
      DATABASE_DRIVER: "pglite",
      PGLITE_DATA_DIR: "memory://",
    } as Record<string, string>;

    assert.equal(
      loadEnv({ ...base, SEED_ADMIN_PASSWORD: "" }).SEED_ADMIN_PASSWORD,
      undefined,
      "an empty value means generate one",
    );

    assert.equal(
      loadEnv({ ...base, SEED_ADMIN_PASSWORD: "   " }).SEED_ADMIN_PASSWORD,
      undefined,
      "whitespace only is still absent",
    );

    assert.equal(
      loadEnv({ ...base, SEED_ADMIN_PASSWORD: "CorrectHorse123" }).SEED_ADMIN_PASSWORD,
      "CorrectHorse123",
      "a real password is preserved exactly",
    );

    assert.equal(
      loadEnv({ ...base, SEED_ADMIN_PASSWORD: "  padded pass  " }).SEED_ADMIN_PASSWORD,
      "  padded pass  ",
      "a present password is never trimmed — the printed credential must be the stored one",
    );
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Forgotten password — the one-time code flow.
 *
 * The code is not knowable from outside: it goes out over email and Telegram,
 * neither of which exists in a test, and only its Argon2 digest is stored. So
 * these tests overwrite `code_hash` with the digest of a code the test picks.
 * That is not a shortcut around the logic — everything after "is this the right
 * code" runs for real: consumption, the password write, the session
 * revocation, the lockout clear.
 */
describe("auth — forgot password", () => {
  let seq = 0;

  /** A fresh address per test, so the per-account cooldown never bleeds. */
  function nextEmail(): string {
    seq += 1;
    return `forgot${seq}@example.com`;
  }

  /**
   * Turns the Telegram channel on or off.
   *
   * The endpoint now refuses to pretend when the server has no way to deliver
   * anything, so every test that expects a code to be issued needs at least one
   * channel configured. Telegram is the one a test can switch, since it lives in
   * the settings row rather than in the frozen environment.
   *
   * The token is fake, so the background send fails — which is fine and is
   * exactly the point of not awaiting delivery: nothing the tests assert
   * depends on it, and `callTelegram` bounds itself with a timeout.
   */
  async function setTelegramConfigured(configured: boolean): Promise<void> {
    const { getDb } = await import("../src/db/client.js");
    const { storeSettings } = await import("../src/db/schema/store-settings.js");
    const { eq } = await import("drizzle-orm");

    await getDb()
      .update(storeSettings)
      .set({
        telegramBotToken: configured ? "000000:test-token-not-real" : "",
        telegramChatId: configured ? "-100000000" : "",
      })
      .where(eq(storeSettings.id, 1));
  }

  before(async () => {
    await setTelegramConfigured(true);
  });

  async function resetRowsFor(email: string) {
    const { getDb } = await import("../src/db/client.js");
    const { adminPasswordResets } = await import("../src/db/schema/admin-password-resets.js");
    const { admins } = await import("../src/db/schema/admins.js");
    const { desc, eq } = await import("drizzle-orm");

    const [admin] = await getDb().select().from(admins).where(eq(admins.email, email));
    if (!admin) return [];

    return getDb()
      .select()
      .from(adminPasswordResets)
      .where(eq(adminPasswordResets.adminId, admin.id))
      .orderBy(desc(adminPasswordResets.createdAt));
  }

  /** Replaces the stored digest, so the test knows the code. */
  async function plantCode(email: string, code: string): Promise<void> {
    const { getDb } = await import("../src/db/client.js");
    const { adminPasswordResets } = await import("../src/db/schema/admin-password-resets.js");
    const { hashPassword } = await import("../src/lib/security/password.js");
    const { eq } = await import("drizzle-orm");

    const rows = await resetRowsFor(email);
    await getDb()
      .update(adminPasswordResets)
      .set({ codeHash: await hashPassword(code) })
      .where(eq(adminPasswordResets.id, rows[0]!.id));
  }

  function forgot(email: string) {
    return api<Envelope<{ message: string }>>(ctx.baseUrl, "/api/v1/auth/forgot-password", {
      method: "POST",
      body: { email },
    });
  }

  function reset(email: string, code: string, newPassword: string) {
    return api<Envelope<{ message: string }>>(ctx.baseUrl, "/api/v1/auth/reset-password", {
      method: "POST",
      body: { email, code, newPassword },
    });
  }

  function login(email: string, password: string) {
    return api<Envelope<LoginData>>(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email, password },
    });
  }

  it("says so plainly when the server has no way to deliver a code", async () => {
    const email = nextEmail();
    await seedAdmin({ email, password: PASSWORD });

    await setTelegramConfigured(false);
    try {
      const res = await forgot(email);

      assert.equal(res.status, 200);
      assert.match(
        res.body.data.message,
        /not set up/i,
        "a shop with no channel configured must not be told a code is on its way",
      );
      assert.equal(
        (await resetRowsFor(email)).length,
        0,
        "and no code should be minted that nobody can receive",
      );
    } finally {
      await setTelegramConfigured(true);
    }
  });

  it("gives that same answer for an address that does not exist", async () => {
    await setTelegramConfigured(false);
    try {
      const real = await forgot("someone-real@example.com");
      const fake = await forgot("no-such-person@example.com");

      assert.equal(
        real.body.data.message,
        fake.body.data.message,
        "the not-configured answer must not depend on the address either",
      );
    } finally {
      await setTelegramConfigured(true);
    }
  });

  it("answers identically for a real account and one that does not exist", async () => {
    const real = nextEmail();
    await seedAdmin({ email: real, password: PASSWORD });

    const known = await forgot(real);
    const unknown = await forgot("nobody-at-all@example.com");

    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.equal(
      known.body.data.message,
      unknown.body.data.message,
      "a different message would be an account enumeration oracle",
    );
  });

  it("issues a code for a real account and none for an unknown one", async () => {
    const email = nextEmail();
    await seedAdmin({ email, password: PASSWORD });

    await forgot(email);
    assert.equal((await resetRowsFor(email)).length, 1);

    await forgot("still-nobody@example.com");
    assert.equal((await resetRowsFor("still-nobody@example.com")).length, 0);
  });

  it("issues no code for a disabled account", async () => {
    const email = nextEmail();
    await seedAdmin({ email, password: PASSWORD, isActive: false });

    const res = await forgot(email);

    assert.equal(res.status, 200, "still answers the same way");
    assert.equal(
      (await resetRowsFor(email)).length,
      0,
      "a reset must not undo an account somebody disabled on purpose",
    );
  });

  it("will not send a second code straight away", async () => {
    const email = nextEmail();
    await seedAdmin({ email, password: PASSWORD });

    await forgot(email);
    await forgot(email);

    assert.equal(
      (await resetRowsFor(email)).length,
      1,
      "without a cooldown this is a way to flood the owner using the shop's own mail credentials",
    );
  });

  it("rejects a wrong code and counts the attempt", async () => {
    const email = nextEmail();
    await seedAdmin({ email, password: PASSWORD });
    await forgot(email);
    await plantCode(email, "123456");

    const res = await reset(email, "999999", "BrandNewPass123");

    assert.equal(res.status, 401);
    assert.equal((await resetRowsFor(email))[0]!.attempts, 1);
  });

  it("kills the code once its attempts are spent", async () => {
    const { getDb } = await import("../src/db/client.js");
    const { adminPasswordResets } = await import("../src/db/schema/admin-password-resets.js");
    const { eq } = await import("drizzle-orm");

    const email = nextEmail();
    await seedAdmin({ email, password: PASSWORD });
    await forgot(email);
    await plantCode(email, "123456");

    /* The five wrong guesses are written straight to the row rather than driven
       over HTTP. `AUTH_RATE_LIMIT_MAX` is 5 in this harness, so six requests
       would be refused by the limiter and the test would pass for the wrong
       reason — proving the rate limiter works, which another test already does,
       while never reaching the per-code ceiling this one is about. */
    const rows = await resetRowsFor(email);
    await getDb()
      .update(adminPasswordResets)
      .set({ attempts: 5 })
      .where(eq(adminPasswordResets.id, rows[0]!.id));

    /* The RIGHT code, and it no longer works — which is the point. */
    assert.equal((await reset(email, "123456", "BrandNewPass123")).status, 401);
    assert.equal((await login(email, PASSWORD)).status, 200, "the original password still works");
  });

  it("says the code expired, rather than that it is wrong", async () => {
    const { getDb } = await import("../src/db/client.js");
    const { adminPasswordResets } = await import("../src/db/schema/admin-password-resets.js");
    const { eq } = await import("drizzle-orm");

    const email = nextEmail();
    await seedAdmin({ email, password: PASSWORD });
    await forgot(email);
    await plantCode(email, "123456");

    const rows = await resetRowsFor(email);
    await getDb()
      .update(adminPasswordResets)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(adminPasswordResets.id, rows[0]!.id));

    const res = await reset(email, "123456", "BrandNewPass123");

    assert.equal(res.status, 401);
    assert.match(
      res.body.error!.message,
      /expired/i,
      "the fix is to ask for another code, so say that rather than 'wrong code'",
    );
  });

  it("changes the password, and the old one stops working", async () => {
    const email = nextEmail();
    await seedAdmin({ email, password: PASSWORD });
    await forgot(email);
    await plantCode(email, "123456");

    const res = await reset(email, "123456", "BrandNewPass123");
    assert.equal(res.status, 200, JSON.stringify(res.body));

    assert.equal((await login(email, PASSWORD)).status, 401, "the old password must be dead");
    assert.equal((await login(email, "BrandNewPass123")).status, 200, "the new one works");
  });

  it("spends the code — the same one cannot reset twice", async () => {
    const email = nextEmail();
    await seedAdmin({ email, password: PASSWORD });
    await forgot(email);
    await plantCode(email, "123456");

    assert.equal((await reset(email, "123456", "BrandNewPass123")).status, 200);

    assert.equal(
      (await reset(email, "123456", "AnotherPass456")).status,
      401,
      "a used code is not a standing key to the account",
    );
  });

  it("unlocks an account that failed logins had locked", async () => {
    const email = nextEmail();
    await seedAdmin({ email, password: PASSWORD });

    /* Somebody hammers the login until the account locks. This is one of the
       two reasons an owner ends up on the forgot-password page at all.
       Exactly `LOGIN_MAX_FAILED_ATTEMPTS` (3 in this harness) — the auth
       limiter allows 5 failures per address-and-email, and spending them here
       would make `forgot` answer 429 and the test fail for the wrong reason. */
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await login(email, "WrongPassword123");
    }

    const locked = await login(email, PASSWORD);
    assert.equal(locked.status, 403, "precondition: the right password is refused while locked");

    await forgot(email);
    await plantCode(email, "123456");
    assert.equal((await reset(email, "123456", "BrandNewPass123")).status, 200);

    assert.equal(
      (await login(email, "BrandNewPass123")).status,
      200,
      "a reset that left the lockout standing hands back a password that still cannot be used",
    );
  });

  /**
   * The attempt ceiling used to be read-compare-then-increment with an Argon2
   * verification sitting in the gap, so requests fired together all saw the
   * same stale count and all got to guess.
   *
   * Honest caveat: PGlite is single-connection, so these requests serialise at
   * the database rather than truly racing. What this pins down is the
   * accounting — the ceiling is enforced by the same statement that increments,
   * so the total can never overshoot. A regression to the old pattern would
   * still be caught here in the common case.
   */
  it("never lets the attempt count overshoot its ceiling", async () => {
    const { getDb } = await import("../src/db/client.js");
    const { adminPasswordResets } = await import("../src/db/schema/admin-password-resets.js");
    const { eq } = await import("drizzle-orm");

    const email = nextEmail();
    await seedAdmin({ email, password: PASSWORD });
    await forgot(email);
    await plantCode(email, "123456");

    /* One guess left of the five. */
    const rows = await resetRowsFor(email);
    await getDb()
      .update(adminPasswordResets)
      .set({ attempts: 4 })
      .where(eq(adminPasswordResets.id, rows[0]!.id));

    await Promise.all([
      reset(email, "000000", "BrandNewPass123"),
      reset(email, "000001", "BrandNewPass123"),
      reset(email, "000002", "BrandNewPass123"),
    ]);

    assert.equal(
      (await resetRowsFor(email))[0]!.attempts,
      5,
      "three guesses against one remaining attempt must spend one, not three",
    );

    /* And the code is genuinely dead, not merely over budget on paper. */
    assert.equal((await reset(email, "123456", "BrandNewPass123")).status, 401);
  });

  it("never leaves two live codes for one account", async () => {
    const email = nextEmail();
    await seedAdmin({ email, password: PASSWORD });

    /* Two requests at once — a double-tapped button, or a client retrying. Both
       answer 200 either way; what matters is what lands in the table. Enforced
       by a partial unique index, so this holds even when the application's
       invalidate-then-insert is interleaved. */
    await Promise.all([forgot(email), forgot(email)]);

    const live = (await resetRowsFor(email)).filter((row) => row.consumedAt === null);

    assert.equal(
      live.length,
      1,
      "two live codes would mean two independent five-attempt budgets",
    );
  });

  it("rejects a malformed code before it costs an Argon2 verification", async () => {
    const email = nextEmail();
    await seedAdmin({ email, password: PASSWORD });

    for (const code of ["12345", "1234567", "abcdef", ""]) {
      const res = await reset(email, code, "BrandNewPass123");
      assert.equal(res.status, 422, `expected 422 for ${JSON.stringify(code)}`);
    }
  });

  it("holds the new password to the same policy as any other", async () => {
    const email = nextEmail();
    await seedAdmin({ email, password: PASSWORD });
    await forgot(email);
    await plantCode(email, "123456");

    assert.equal((await reset(email, "123456", "short")).status, 422);
  });
});
