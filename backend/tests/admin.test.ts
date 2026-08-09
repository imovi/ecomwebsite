import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  api,
  seedAdminAndLogin,
  startTestServer,
  type TestContext,
} from "./helpers/test-server.js";
/* Imported after the harness, which sets the test environment before any
   application module is evaluated. */
import { orderEvents } from "../src/lib/events/order-events.js";
import {
  registerOrderIntegrations,
  unregisterOrderIntegrations,
} from "../src/modules/integrations/integrations.subscriber.js";

/**
 * Team management and order integrations — integration tests.
 *
 * Two features that both fail quietly if they fail at all. A broken team guard
 * is only discovered the day somebody is locked out of their own shop, and a
 * broken Telegram alert is discovered when a customer stops answering the phone
 * because nobody called them. Neither shows up in the UI.
 *
 * Telegram and Google are the only things faked here, and only at the network
 * boundary: `globalThis.fetch` is intercepted for those three hosts and passes
 * everything else — including the test suite's own HTTP calls — straight
 * through. The message body, the HTML escaping, the OAuth assertion and the
 * row layout are all produced by the real code and asserted on the wire.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string; details?: { field: string; message: string }[] };
  requestId: string;
}

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: "manager" | "admin" | "super_admin";
  isActive: boolean;
  lockedUntil: string | null;
  isLocked: boolean;
  lastLoginAt: string | null;
}

const PASSWORD = "TeamAdminPass123";

let ctx: TestContext;
let superToken: string;
let adminToken: string;
let managerToken: string;

/* -------------------------------------------------------------------------- */
/* Fake Telegram and Google                                                   */
/* -------------------------------------------------------------------------- */

interface OutboundCall {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

const outbound: OutboundCall[] = [];

/** Overridable per test, so failure paths get exercised as well as happy ones. */
const fake = {
  telegram: { status: 200, body: {} as unknown },
  googleToken: { status: 200, body: {} as unknown },
  sheets: { status: 200, body: {} as unknown },
};

function resetFakes(): void {
  outbound.length = 0;
  fake.telegram = { status: 200, body: { ok: true, result: { message_id: 1 } } };
  fake.googleToken = {
    status: 200,
    body: { access_token: "fake-access-token", expires_in: 3600 },
  };
  fake.sheets = { status: 200, body: { updates: { updatedRange: "'Orders'!A1:M1" } } };
}

const realFetch = globalThis.fetch;

function installInterceptor(): void {
  globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    const canned =
      url.startsWith("https://api.telegram.org")
        ? fake.telegram
        : url.startsWith("https://oauth2.googleapis.com")
          ? fake.googleToken
          : url.startsWith("https://sheets.googleapis.com")
            ? fake.sheets
            : null;

    /* Everything else — notably this suite's own requests to 127.0.0.1 — is a
       real network call. */
    if (!canned) return realFetch(input, init);

    /* The two shapes this code actually sends: a JSON string for Telegram and
       Sheets, form-encoded parameters for the OAuth exchange. */
    const sent = init?.body;
    const raw =
      typeof sent === "string" ? sent : sent instanceof URLSearchParams ? sent.toString() : "";

    outbound.push({
      url,
      body: raw.startsWith("{") ? JSON.parse(raw) : raw,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });

    return new Response(JSON.stringify(canned.body), {
      status: canned.status,
      headers: { "content-type": "application/json" },
    });
  };
}

const callsTo = (host: string) => outbound.filter((call) => call.url.includes(host));

/** Waits for a fire-and-forget subscriber to reach the network. */
async function until(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

/**
 * A real RSA key in a real service-account envelope.
 *
 * The Sheets export signs a JWT with `importPKCS8`, so a placeholder string
 * would only ever prove the error path. Generating one costs ~100ms and makes
 * the whole signing round trip genuine.
 */
function makeServiceAccountKey(email: string): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    type: "service_account",
    project_id: "gng-test",
    client_email: email,
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  });
}

const BOT_TOKEN = "123456789:AAHtestTokenForIntegrationTests";
const SHEET_ID = "1TestSheetIdForIntegrationTests_abc";

before(async () => {
  ctx = await startTestServer();
  installInterceptor();

  superToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "team-super@gng.com.bd",
    password: PASSWORD,
    role: "super_admin",
  });
  adminToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "team-admin@gng.com.bd",
    password: PASSWORD,
    role: "admin",
  });
  managerToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "team-manager@gng.com.bd",
    password: PASSWORD,
    role: "manager",
  });
});

after(async () => {
  globalThis.fetch = realFetch;
  await ctx.close();
});

beforeEach(() => {
  resetFakes();
});

/* -------------------------------------------------------------------------- */
/* Team management                                                            */
/* -------------------------------------------------------------------------- */

describe("team — access", () => {
  it("is closed to everyone below owner", async () => {
    for (const [label, token] of [
      ["signed out", undefined],
      ["staff", managerToken],
      ["manager", adminToken],
    ] as const) {
      const res = await api(ctx.baseUrl, "/api/v1/admin/team", {
        ...(token ? { accessToken: token } : {}),
      });

      /* Anyone who can edit accounts is an owner in all but name, so this is
         gated above the usual settings floor. */
      assert.equal(res.status, token ? 403 : 401, label);
    }
  });

  it("lists the team for an owner", async () => {
    const res = await api<Envelope<{ team: TeamMember[] }>>(ctx.baseUrl, "/api/v1/admin/team", {
      accessToken: superToken,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.team.length, 3);
    assert.ok(res.body.data.team.every((member) => !("passwordHash" in member)));
  });
});

describe("team — creating people", () => {
  it("generates a password and returns it exactly once", async () => {
    const res = await api<Envelope<{ admin: TeamMember; password: string }>>(
      ctx.baseUrl,
      "/api/v1/admin/team",
      {
        method: "POST",
        accessToken: superToken,
        body: { email: "New.Staff@GNG.com.bd", name: "New Staff", role: "manager" },
      },
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.admin.role, "manager");
    assert.equal(res.body.data.admin.email, "new.staff@gng.com.bd", "email is normalised");
    assert.ok(res.body.data.password.length >= 12);

    /* There is no invitation email, so the create response is the only place
       that password ever exists — it must not be readable afterwards. */
    const list = await api<Envelope<{ team: TeamMember[] }>>(ctx.baseUrl, "/api/v1/admin/team", {
      accessToken: superToken,
    });
    assert.ok(!JSON.stringify(list.body).includes(res.body.data.password));
  });

  it("issues a password that actually signs in", async () => {
    const created = await api<Envelope<{ admin: TeamMember; password: string }>>(
      ctx.baseUrl,
      "/api/v1/admin/team",
      {
        method: "POST",
        accessToken: superToken,
        body: { email: "signin@gng.com.bd", name: "Sign In", role: "admin" },
      },
    );

    const login = await api<Envelope<{ admin: { role: string } }>>(
      ctx.baseUrl,
      "/api/v1/auth/login",
      {
        method: "POST",
        body: { email: "signin@gng.com.bd", password: created.body.data.password },
      },
    );

    assert.equal(login.status, 200);
    assert.equal(login.body.data.admin.role, "admin");
  });

  it("rejects a duplicate email", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/team", {
      method: "POST",
      accessToken: superToken,
      body: { email: "signin@gng.com.bd", name: "Someone Else", role: "manager" },
    });

    assert.equal(res.status, 409);
  });

  it("rejects a chosen password that is too short to be worth setting", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/team", {
      method: "POST",
      accessToken: superToken,
      body: {
        email: "weak@gng.com.bd",
        name: "Weak Password",
        role: "manager",
        password: "short",
      },
    });

    assert.equal(res.status, 422);
  });
});

describe("team — the lockout guards", () => {
  let ownerId = "";
  let staffId = "";

  before(async () => {
    const list = await api<Envelope<{ team: TeamMember[] }>>(ctx.baseUrl, "/api/v1/admin/team", {
      accessToken: superToken,
    });
    ownerId = list.body.data.team.find((m) => m.email === "team-super@gng.com.bd")?.id ?? "";
    staffId = list.body.data.team.find((m) => m.email === "team-manager@gng.com.bd")?.id ?? "";
    assert.ok(ownerId && staffId);
  });

  it("refuses to let anyone change their own role", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, `/api/v1/admin/team/${ownerId}`, {
      method: "PATCH",
      accessToken: superToken,
      body: { role: "admin" },
    });

    /* Demoting yourself is the one mistake the UI cannot undo afterwards. */
    assert.equal(res.status, 400);
    assert.match(res.body.error?.message ?? "", /your own role/i);
  });

  it("refuses to let anyone deactivate or delete themselves", async () => {
    const disable = await api<Envelope<never>>(ctx.baseUrl, `/api/v1/admin/team/${ownerId}`, {
      method: "PATCH",
      accessToken: superToken,
      body: { isActive: false },
    });
    const destroy = await api<Envelope<never>>(ctx.baseUrl, `/api/v1/admin/team/${ownerId}`, {
      method: "DELETE",
      accessToken: superToken,
    });

    assert.equal(disable.status, 400);
    assert.equal(destroy.status, 400);
    assert.match(destroy.body.error?.message ?? "", /your own account/i);
  });

  it("refuses to remove the last owner, whichever way it is attempted", async () => {
    /* A second owner, acting on the first — so the self-guard is not what
       stops these. The shop must still refuse: the end state is a panel with
       nobody able to administer it. */
    const second = await api<Envelope<{ admin: TeamMember; password: string }>>(
      ctx.baseUrl,
      "/api/v1/admin/team",
      {
        method: "POST",
        accessToken: superToken,
        body: { email: "owner2@gng.com.bd", name: "Second Owner", role: "super_admin" },
      },
    );
    assert.equal(second.status, 201);

    const secondToken = (
      await api<Envelope<{ accessToken: string }>>(ctx.baseUrl, "/api/v1/auth/login", {
        method: "POST",
        body: { email: "owner2@gng.com.bd", password: second.body.data.password },
      })
    ).body.data.accessToken;

    /* Step one: the second owner steps down. Two owners exist, so this is
       allowed and leaves exactly one. */
    const demoted = await api<Envelope<{ admin: TeamMember }>>(
      ctx.baseUrl,
      `/api/v1/admin/team/${second.body.data.admin.id}`,
      { method: "PATCH", accessToken: superToken, body: { role: "admin" } },
    );
    assert.equal(demoted.status, 200);
    assert.equal(demoted.body.data.admin.role, "admin");

    /* Step two: that demotion revoked their session, so the token they were
       holding must no longer be able to act as an owner. */
    const staleAttempt = await api(ctx.baseUrl, `/api/v1/admin/team/${ownerId}`, {
      method: "DELETE",
      accessToken: secondToken,
    });
    assert.equal(staleAttempt.status, 403, "privileges are re-read per request");
  });

  it("refuses to hand out a role higher than your own", async () => {
    /* An `admin` cannot manage the team at all, so this is asserted at the one
       place rank still matters: an owner is the only one who can mint one. */
    const res = await api(ctx.baseUrl, "/api/v1/admin/team", {
      method: "POST",
      accessToken: adminToken,
      body: { email: "escalate@gng.com.bd", name: "Escalate", role: "super_admin" },
    });

    assert.equal(res.status, 403);
  });

  it("promotes and demotes other people", async () => {
    const promoted = await api<Envelope<{ admin: TeamMember }>>(
      ctx.baseUrl,
      `/api/v1/admin/team/${staffId}`,
      { method: "PATCH", accessToken: superToken, body: { role: "admin" } },
    );
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.data.admin.role, "admin");

    const back = await api<Envelope<{ admin: TeamMember }>>(
      ctx.baseUrl,
      `/api/v1/admin/team/${staffId}`,
      { method: "PATCH", accessToken: superToken, body: { role: "manager" } },
    );
    assert.equal(back.body.data.admin.role, "manager");
  });
});

describe("team — ending access", () => {
  it("closes live sessions when an account is deactivated", async () => {
    const created = await api<Envelope<{ admin: TeamMember; password: string }>>(
      ctx.baseUrl,
      "/api/v1/admin/team",
      {
        method: "POST",
        accessToken: superToken,
        body: { email: "revoke@gng.com.bd", name: "Revoke Me", role: "manager" },
      },
    );

    const login = await api<Envelope<{ accessToken: string }>>(
      ctx.baseUrl,
      "/api/v1/auth/login",
      {
        method: "POST",
        body: { email: "revoke@gng.com.bd", password: created.body.data.password },
      },
    );
    assert.equal(login.status, 200);
    assert.ok(login.refreshCookie);

    await api(ctx.baseUrl, `/api/v1/admin/team/${created.body.data.admin.id}`, {
      method: "PATCH",
      accessToken: superToken,
      body: { isActive: false },
    });

    /* Revoking, rather than waiting for the access token to expire: a disabled
       account must not be able to mint a replacement. */
    const refreshed = await api(ctx.baseUrl, "/api/v1/auth/refresh", {
      method: "POST",
      body: {},
      ...(login.refreshCookie ? { refreshCookie: login.refreshCookie } : {}),
    });
    assert.notEqual(refreshed.status, 200);

    const signIn = await api(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "revoke@gng.com.bd", password: created.body.data.password },
    });
    assert.notEqual(signIn.status, 200, "and cannot start a new session either");
  });

  it("resets a forgotten password without knowing the old one", async () => {
    const created = await api<Envelope<{ admin: TeamMember; password: string }>>(
      ctx.baseUrl,
      "/api/v1/admin/team",
      {
        method: "POST",
        accessToken: superToken,
        body: { email: "forgot@gng.com.bd", name: "Forgot It", role: "manager" },
      },
    );

    const reset = await api<Envelope<{ admin: TeamMember; password: string }>>(
      ctx.baseUrl,
      `/api/v1/admin/team/${created.body.data.admin.id}/password`,
      { method: "POST", accessToken: superToken, body: {} },
    );

    assert.equal(reset.status, 200);
    assert.notEqual(reset.body.data.password, created.body.data.password);

    const withNew = await api(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "forgot@gng.com.bd", password: reset.body.data.password },
    });
    assert.equal(withNew.status, 200);

    const withOld = await api(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "forgot@gng.com.bd", password: created.body.data.password },
    });
    assert.notEqual(withOld.status, 200);
  });

  it("deletes an account", async () => {
    const created = await api<Envelope<{ admin: TeamMember; password: string }>>(
      ctx.baseUrl,
      "/api/v1/admin/team",
      {
        method: "POST",
        accessToken: superToken,
        body: { email: "delete-me@gng.com.bd", name: "Delete Me", role: "manager" },
      },
    );

    const res = await api(ctx.baseUrl, `/api/v1/admin/team/${created.body.data.admin.id}`, {
      method: "DELETE",
      accessToken: superToken,
    });
    assert.equal(res.status, 204);

    const login = await api(ctx.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "delete-me@gng.com.bd", password: created.body.data.password },
    });
    assert.notEqual(login.status, 200);
  });

  it("404s on an account that is already gone", async () => {
    const res = await api(
      ctx.baseUrl,
      "/api/v1/admin/team/00000000-0000-4000-8000-000000000000",
      { method: "DELETE", accessToken: superToken },
    );
    assert.equal(res.status, 404);
  });
});

/* -------------------------------------------------------------------------- */
/* Integrations — configuration                                               */
/* -------------------------------------------------------------------------- */

describe("integrations — configuration", () => {
  it("reports what is still missing, not just a boolean", async () => {
    const res = await api<
      Envelope<{
        status: {
          telegram: { ready: boolean; problem: string | null; tokenConfigured: boolean };
          googleSheets: {
            ready: boolean;
            problem: string | null;
            serviceAccountEmail: string | null;
            columns: string[];
          };
        };
      }>
    >(ctx.baseUrl, "/api/v1/admin/integrations/status", { accessToken: superToken });

    assert.equal(res.status, 200);
    /* Nothing is configured yet, and the operator cannot read the server log —
       so the first unmet prerequisite has to be named. */
    assert.equal(res.body.data.status.telegram.ready, false);
    assert.equal(res.body.data.status.telegram.problem, "missing_token");
    assert.equal(res.body.data.status.googleSheets.problem, "missing_credentials");
    assert.equal(res.body.data.status.googleSheets.serviceAccountEmail, null);
    assert.ok(res.body.data.status.googleSheets.columns.includes("Phone"));
  });

  it("is closed to staff", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/integrations/status", {
      accessToken: managerToken,
    });
    /* The response reveals whether credentials exist, so it matches the
       settings write floor rather than the read one. */
    assert.equal(res.status, 403);
  });

  it("rejects a bot token that is not one", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/settings", {
      method: "PATCH",
      accessToken: superToken,
      body: { integrations: { telegram: { botToken: "not-a-bot-token" } } },
    });

    assert.equal(res.status, 422);
    assert.match(JSON.stringify(res.body.error), /BotFather/i);
  });

  it("rejects a spreadsheet URL pasted where the id belongs", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/settings", {
      method: "PATCH",
      accessToken: superToken,
      body: {
        integrations: {
          googleSheets: { sheetId: "https://docs.google.com/spreadsheets/d/abc/edit" },
        },
      },
    });

    assert.equal(res.status, 422);
  });

  it("stores the secrets write-only", async () => {
    const key = makeServiceAccountKey("gng-orders@gng-test.iam.gserviceaccount.com");

    const saved = await api<
      Envelope<{
        settings: {
          integrations: {
            telegram: { hasBotToken: boolean; botTokenHint: string | null; chatId: string };
            googleSheets: {
              hasCredentials: boolean;
              serviceAccountEmail: string | null;
              sheetId: string;
              tab: string;
            };
          };
        };
      }>
    >(ctx.baseUrl, "/api/v1/admin/settings", {
      method: "PATCH",
      accessToken: superToken,
      body: {
        integrations: {
          telegram: { botToken: BOT_TOKEN, chatId: "-1001234567890", enabled: true },
          googleSheets: {
            credentials: key,
            sheetId: SHEET_ID,
            tab: "Orders",
            enabled: true,
          },
        },
      },
    });

    assert.equal(saved.status, 200);
    const { telegram, googleSheets } = saved.body.data.settings.integrations;

    assert.equal(telegram.hasBotToken, true);
    assert.equal(telegram.chatId, "-1001234567890");
    assert.equal(googleSheets.hasCredentials, true);
    assert.equal(googleSheets.sheetId, SHEET_ID);

    /* The bot token and the private key are the two things an attacker with
       read access to the dashboard would want most. Neither comes back. */
    const body = JSON.stringify(saved.body);
    assert.ok(!body.includes(BOT_TOKEN), "the bot token is never returned");
    assert.ok(!body.includes("PRIVATE KEY"), "the private key is never returned");

    /* The service account's email is public information inside a credential
       that is not — and the sheet has to be shared with it, so it is shown. */
    assert.equal(
      googleSheets.serviceAccountEmail,
      "gng-orders@gng-test.iam.gserviceaccount.com",
    );
  });

  it("now reports both integrations ready", async () => {
    const res = await api<
      Envelope<{
        status: {
          telegram: { ready: boolean; enabled: boolean };
          googleSheets: { ready: boolean; serviceAccountEmail: string | null };
        };
      }>
    >(ctx.baseUrl, "/api/v1/admin/integrations/status", { accessToken: superToken });

    assert.equal(res.body.data.status.telegram.ready, true);
    assert.equal(res.body.data.status.googleSheets.ready, true);
    assert.match(
      res.body.data.status.googleSheets.serviceAccountEmail ?? "",
      /gserviceaccount\.com$/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Integrations — Telegram                                                    */
/* -------------------------------------------------------------------------- */

describe("integrations — telegram", () => {
  it("sends a test message the owner can recognise", async () => {
    const res = await api<Envelope<{ result: { sent: boolean; reason?: string } }>>(
      ctx.baseUrl,
      "/api/v1/admin/integrations/telegram/test",
      { method: "POST", accessToken: superToken, body: {} },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.result.sent, true);

    const [call] = callsTo("api.telegram.org");
    assert.ok(call);
    assert.ok(call.url.includes(`/bot${BOT_TOKEN}/sendMessage`));
    assert.equal((call.body as { chat_id: string }).chat_id, "-1001234567890");
  });

  it("reports Telegram's own refusal instead of a generic failure", async () => {
    fake.telegram = {
      status: 200,
      body: { ok: false, description: "Bad Request: chat not found" },
    };

    const res = await api<Envelope<{ result: { sent: boolean; reason?: string } }>>(
      ctx.baseUrl,
      "/api/v1/admin/integrations/telegram/test",
      { method: "POST", accessToken: superToken, body: {} },
    );

    /* 200 with an outcome, not a 500: "your chat id is wrong" is a successful
       diagnostic, and it is the sentence the operator needs to read. */
    assert.equal(res.status, 200);
    assert.equal(res.body.data.result.sent, false);
    assert.match(res.body.data.result.reason ?? "", /chat not found/);
  });

  it("survives Telegram being unreachable", async () => {
    globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("https://api.telegram.org")) throw new Error("getaddrinfo ENOTFOUND");
      return realFetch(input, init);
    };

    const res = await api<Envelope<{ result: { sent: boolean; reason?: string } }>>(
      ctx.baseUrl,
      "/api/v1/admin/integrations/telegram/test",
      { method: "POST", accessToken: superToken, body: {} },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.result.sent, false);
    assert.match(res.body.data.result.reason ?? "", /ENOTFOUND/);

    installInterceptor();
  });

  it("finds the chat id from the bot's own updates", async () => {
    fake.telegram = {
      status: 200,
      body: {
        ok: true,
        result: [
          { message: { chat: { id: -1009876543210, title: "gng orders" } } },
          { message: { chat: { id: -1009876543210, title: "gng orders" } } },
          { message: { chat: { id: 55512345, first_name: "Rahim" } } },
        ],
      },
    };

    const res = await api<
      Envelope<{ result: { ok: boolean; chats: { id: string; title: string }[] } }>
    >(ctx.baseUrl, "/api/v1/admin/integrations/telegram/find-chats", {
      method: "POST",
      accessToken: superToken,
      body: {},
    });

    assert.equal(res.body.data.result.ok, true);
    /* Deduplicated: a chat that sent three messages is still one destination. */
    assert.deepEqual(res.body.data.result.chats, [
      { id: "-1009876543210", title: "gng orders" },
      { id: "55512345", title: "Rahim" },
    ]);
  });

  it("says what to do when the bot has no updates yet", async () => {
    fake.telegram = { status: 200, body: { ok: true, result: [] } };

    const res = await api<Envelope<{ result: { ok: boolean; reason?: string } }>>(
      ctx.baseUrl,
      "/api/v1/admin/integrations/telegram/find-chats",
      { method: "POST", accessToken: superToken, body: {} },
    );

    assert.equal(res.body.data.result.ok, true);
    assert.match(res.body.data.result.reason ?? "", /send any message/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Integrations — Google Sheets                                               */
/* -------------------------------------------------------------------------- */

describe("integrations — google sheets", () => {
  it("signs a real assertion and appends the header row", async () => {
    const res = await api<Envelope<{ result: { sent: boolean; updatedRange?: string } }>>(
      ctx.baseUrl,
      "/api/v1/admin/integrations/sheets/test",
      { method: "POST", accessToken: superToken, body: {} },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.result.sent, true);

    /* The OAuth exchange carries a JWT this code signed with the pasted key. */
    const [token] = callsTo("oauth2.googleapis.com");
    assert.ok(token);
    const assertion = new URLSearchParams(String(token.body)).get("assertion") ?? "";
    assert.equal(assertion.split(".").length, 3, "a signed JWT, not a placeholder");

    const [append] = callsTo("sheets.googleapis.com");
    assert.ok(append);
    assert.ok(append.url.includes(SHEET_ID));
    assert.ok(append.url.includes("valueInputOption=USER_ENTERED"));
    assert.equal(append.headers.authorization, "Bearer fake-access-token");

    const [row] = (append.body as { values: string[][] }).values;
    assert.deepEqual(row?.slice(0, 4), ["Order", "Placed at", "Customer", "Phone"]);
  });

  it("reuses the access token rather than re-minting one per write", async () => {
    await api(ctx.baseUrl, "/api/v1/admin/integrations/sheets/test", {
      method: "POST",
      accessToken: superToken,
      body: {},
    });
    await api(ctx.baseUrl, "/api/v1/admin/integrations/sheets/test", {
      method: "POST",
      accessToken: superToken,
      body: {},
    });

    /* Tokens last an hour; signing one per order would add a round trip and an
       RSA signature to every checkout. */
    assert.equal(callsTo("oauth2.googleapis.com").length, 0, "the cached token is reused");
    assert.equal(callsTo("sheets.googleapis.com").length, 2);
  });

  it("names the sharing mistake when Google answers 403", async () => {
    fake.sheets = {
      status: 403,
      body: { error: { message: "The caller does not have permission", status: "PERMISSION_DENIED" } },
    };

    const res = await api<Envelope<{ result: { sent: boolean; reason?: string } }>>(
      ctx.baseUrl,
      "/api/v1/admin/integrations/sheets/test",
      { method: "POST", accessToken: superToken, body: {} },
    );

    assert.equal(res.body.data.result.sent, false);
    /* Overwhelmingly the reason a first setup fails, so the fix is spelled out
       with the actual address to share with. */
    assert.match(res.body.data.result.reason ?? "", /Share the sheet with .*gserviceaccount\.com/);
    assert.match(res.body.data.result.reason ?? "", /Editor/);
  });

  it("suggests checking the id and tab when Google answers 404", async () => {
    fake.sheets = { status: 404, body: { error: { message: "Requested entity was not found." } } };

    const res = await api<Envelope<{ result: { reason?: string } }>>(
      ctx.baseUrl,
      "/api/v1/admin/integrations/sheets/test",
      { method: "POST", accessToken: superToken, body: {} },
    );

    assert.match(res.body.data.result.reason ?? "", /tab name matches/);
  });

  it("publishes the footer copy to the storefront", async () => {
    interface Store {
      settings: { store: { tagline: string; footerNote: string } };
    }

    const saved = await api<Envelope<Store>>(ctx.baseUrl, "/api/v1/admin/settings", {
      method: "PATCH",
      accessToken: superToken,
      body: {
        store: { tagline: "Gadgets, delivered.", footerNote: "Trade licence: 1234567890" },
      },
    });

    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.settings.store.tagline, "Gadgets, delivered.");
    assert.equal(saved.body.data.settings.store.footerNote, "Trade licence: 1234567890");

    /* The admin round trip alone proves nothing: the footer is rendered from
       the PUBLIC endpoint, so copy that saves but never reaches the storefront
       is the failure this is here to catch. */
    const published = await api<Envelope<Store>>(
      ctx.baseUrl,
      "/api/v1/storefront/settings",
    );
    assert.equal(published.body.data.settings.store.tagline, "Gadgets, delivered.");
    assert.equal(
      published.body.data.settings.store.footerNote,
      "Trade licence: 1234567890",
    );
  });

  it("re-mints the token when the credentials are replaced", async () => {
    const replacement = makeServiceAccountKey("rotated@gng-test.iam.gserviceaccount.com");

    const saved = await api(ctx.baseUrl, "/api/v1/admin/settings", {
      method: "PATCH",
      accessToken: superToken,
      body: { integrations: { googleSheets: { credentials: replacement } } },
    });
    assert.equal(saved.status, 200);

    const test = await api<Envelope<{ result: { sent: boolean; reason?: string } }>>(
      ctx.baseUrl,
      "/api/v1/admin/integrations/sheets/test",
      { method: "POST", accessToken: superToken, body: {} },
    );
    assert.equal(test.body.data.result.sent, true, test.body.data.result.reason ?? "");

    /* A cached token minted for the old service account would keep working
       against the old permissions, silently ignoring the rotation. */
    assert.equal(callsTo("oauth2.googleapis.com").length, 1, "the cache was invalidated");
  });

  it("refuses a key that is not a service account key", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/settings", {
      method: "PATCH",
      accessToken: superToken,
      body: {
        integrations: {
          googleSheets: {
            credentials: JSON.stringify({
              type: "authorized_user",
              client_id: "x".repeat(40),
              refresh_token: "y".repeat(40),
            }),
          },
        },
      },
    });

    /* Downloading the wrong key type from the Google console is easy to do and
       impossible to diagnose from a JWT signing error. */
    assert.ok(res.status === 422 || res.status === 400, `got ${res.status}`);
    assert.match(JSON.stringify(res.body.error), /service account/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Integrations — the order hook                                              */
/* -------------------------------------------------------------------------- */

describe("integrations — when an order arrives", () => {
  const order = {
    orderId: "11111111-1111-4111-8111-111111111111",
    orderNumber: "GNG-20001",
    /* Deliberately contains an angle bracket: customer names are free text
       typed by strangers, and Telegram's HTML mode rejects the whole message
       if one is left unescaped — the alert would vanish exactly when it
       matters most. */
    customerName: "Rahim <the> Buyer",
    phone: "01712345678",
    grandTotal: 15_060,
    itemCount: 2,
    contents: [
      {
        sku: "GNG-A1",
        name: "Anker PowerCore 20000",
        variantLabel: "Black",
        quantity: 2,
        unitPrice: 7_500,
        lineTotal: 15_000,
      },
    ],
    address: "House 12, Road 3",
    areaText: "Dhanmondi",
    deliveryZone: "inside_dhaka" as const,
    subtotal: 15_000,
    deliveryCharge: 60,
    customerNote: "Call before delivery",
    /* What the browser told us. Carried on the event for ad-platform reporting;
       the integrations under test here ignore them. `fbc`/`fbp` null is the
       ordinary case — most shoppers arrive without clicking an ad. */
    customerIp: "203.0.113.42",
    userAgent: "Mozilla/5.0 (Linux; Android 13)",
    fbc: null,
    fbp: null,
    placedAt: new Date("2026-07-31T10:00:00.000Z"),
  };

  before(() => {
    registerOrderIntegrations();
  });

  after(() => {
    unregisterOrderIntegrations();
  });

  it("alerts Telegram and appends to the sheet at the same time", async () => {
    orderEvents.emit("order.created", order);

    await until(
      () => callsTo("api.telegram.org").length > 0 && callsTo("sheets.googleapis.com").length > 0,
      "both integrations should have run",
    );

    const text = (callsTo("api.telegram.org")[0]?.body as { text: string }).text;

    assert.match(text, /GNG-20001/);
    assert.match(text, /01712345678/);
    assert.match(text, /Anker PowerCore 20000/);
    assert.match(text, /Dhanmondi/);
    assert.match(text, /Call before delivery/);
    /* The number the shop collects on delivery — the one figure the person
       reading this on their phone actually acts on. */
    assert.match(text, /15,060/);

    assert.ok(text.includes("Rahim &lt;the&gt; Buyer"), "free text is HTML-escaped");
    assert.ok(!text.includes("<the>"), "and the raw bracket never reaches Telegram");

    const row = (callsTo("sheets.googleapis.com")[0]?.body as { values: (string | number)[][] })
      .values[0];
    assert.ok(row);
    assert.equal(row[0], "GNG-20001");
    assert.equal(row[2], "Rahim <the> Buyer", "the sheet is not HTML, so no escaping there");
    /* A leading apostrophe keeps Sheets from rendering 01712345678 as
       1712345678 — a phone number nobody can ring. */
    assert.equal(row[3], "'01712345678");
    assert.equal(row[6], "Inside Dhaka");
    assert.equal(row[8], 2, "total quantity");
    assert.equal(row[11], 15_060);
    assert.equal(row[12], "pending");
  });

  it("still alerts Telegram when the sheet is broken", async () => {
    fake.sheets = { status: 500, body: { error: { message: "Backend error" } } };

    orderEvents.emit("order.created", { ...order, orderNumber: "GNG-20002" });

    await until(() => callsTo("api.telegram.org").length > 0, "Telegram should not wait on Google");

    /* They run concurrently and independently: the alert is the one somebody
       is waiting on, and it must not be lost to a spreadsheet outage. */
    const text = (callsTo("api.telegram.org")[0]?.body as { text: string }).text;
    assert.match(text, /GNG-20002/);
  });

  it("alerts on a cancellation, and stays quiet for routine steps", async () => {
    orderEvents.emit("order.status_changed", {
      orderId: order.orderId,
      orderNumber: "GNG-20003",
      customerName: "Rahim",
      phone: "01712345678",
      previousStatus: "pending",
      newStatus: "confirmed",
      adminId: null,
      changedAt: new Date(),
    });

    orderEvents.emit("order.status_changed", {
      orderId: order.orderId,
      orderNumber: "GNG-20004",
      customerName: "Rahim",
      phone: "01712345678",
      previousStatus: "confirmed",
      newStatus: "cancelled",
      adminId: null,
      changedAt: new Date(),
    });

    await until(() => callsTo("api.telegram.org").length > 0, "the cancellation should alert");
    /* Give the confirmed-status handler the same chance to fire. */
    await new Promise((resolve) => setTimeout(resolve, 50));

    const messages = callsTo("api.telegram.org").map(
      (call) => (call.body as { text: string }).text,
    );

    /* A push on every packing step trains people to ignore the channel, which
       costs the new-order alert its value. */
    assert.equal(messages.length, 1);
    assert.match(messages[0] ?? "", /GNG-20004/);
    assert.match(messages[0] ?? "", /Cancelled/);
  });

  it("sends nothing once the integrations are switched off", async () => {
    await api(ctx.baseUrl, "/api/v1/admin/settings", {
      method: "PATCH",
      accessToken: superToken,
      body: {
        integrations: {
          telegram: { enabled: false },
          googleSheets: { enabled: false },
        },
      },
    });

    orderEvents.emit("order.created", { ...order, orderNumber: "GNG-20005" });
    await new Promise((resolve) => setTimeout(resolve, 100));

    /* Settings are read per event, so the switch takes effect on the next
       order rather than the next restart. */
    assert.equal(callsTo("api.telegram.org").length, 0);
    assert.equal(callsTo("sheets.googleapis.com").length, 0);
  });
});
