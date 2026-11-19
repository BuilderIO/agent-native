import { createHmac } from "node:crypto";

import { H3 } from "h3";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import { closeDbExec, getDbExec } from "../db/client.js";
import { sql, type SqlFragment } from "../db/sql.js";
import { autoMountAuth } from "./auth.js";
import {
  getBetterAuth,
  getBetterAuthInternalAdapter,
} from "./better-auth-instance.js";
import { betterAuthStore } from "./better-auth-migrations.js";
import { getH3App } from "./framework-request-handler.js";
import { resetRunnerSessionRateLimitForTests } from "./runner-session.js";

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

const SECRET = "runner-secret-for-tests-0123456789abcdef";
const MEMBER = "runner-member@example.test";
const MISSING = "runner-missing@example.test";
const PROVIDER_DOMAIN = "provider-required.example.test";
const PROVIDER_MEMBER = `runner-member@${PROVIDER_DOMAIN}`;
const OUTSIDER = "someone-else@example.test";
const UNVERIFIED = "runner-unverified@example.test";
const TWO_FACTOR = "runner-two-factor@example.test";
const ROUTE = "http://localhost/_agent-native/auth/runner-session";
const TWO_HOURS_MS = 2 * 60 * 60_000;
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);

let app: H3;
let previousDatabaseUrl: string | undefined;
let nonceCounter = 0;

function nextNonce(): string {
  nonceCounter += 1;
  return `runner-nonce-${String(nonceCounter).padStart(8, "0")}`;
}

function sign(
  secret: string,
  email: string,
  ts: number,
  nonce: string,
): string {
  return createHmac("sha256", secret)
    .update(
      `agent-native-runner-session:v1\n${email.trim().toLowerCase()}\n${ts}\n${nonce}`,
      "utf8",
    )
    .digest("hex");
}

function signedBody(
  email: string,
  overrides: Partial<{
    ts: number;
    nonce: string;
    sig: string;
    secret: string;
  }> = {},
) {
  const ts = overrides.ts ?? Date.now();
  const nonce = overrides.nonce ?? nextNonce();
  return {
    email,
    ts,
    nonce,
    sig: overrides.sig ?? sign(overrides.secret ?? SECRET, email, ts, nonce),
  };
}

function post(body: unknown, ip = "203.0.113.10") {
  return app.request(
    new Request(ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function errorCode(response: Response): Promise<unknown> {
  const body = (await response.json()) as { error?: { code?: unknown } };
  return body.error?.code;
}

function sessionCookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0] ?? "")
    .filter((pair) => pair.slice(pair.indexOf("=") + 1) !== "")
    .join("; ");
}

async function sessionEmail(cookie: string): Promise<unknown> {
  const response = await app.request(
    new Request("http://localhost/_agent-native/auth/session", {
      headers: { cookie },
    }),
  );
  const body = (await response.json()) as { email?: unknown };
  return body.email;
}

async function count(query: SqlFragment): Promise<number> {
  const { rows } = await getDbExec().execute(query);
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "pglite:memory";
  await closeDbExec();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTH_DISABLED", "");
  vi.stubEnv("ACCESS_TOKEN", "");
  vi.stubEnv("ACCESS_TOKENS", "");
  vi.stubEnv("APP_BASE_PATH", "");
  vi.stubEnv("VITE_APP_BASE_PATH", "");
  vi.stubEnv("AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT", "1");
  vi.stubEnv("BETTER_AUTH_SECRET", "better-auth-secret-for-runner-tests-0123");
  resetAppConfigForTests();
  app = new H3();
  await autoMountAuth(getH3App({ h3: app }), {});
  await betterAuthStore.ready();
  await getBetterAuth();
  const adapter = await getBetterAuthInternalAdapter();
  if (!adapter) throw new Error("Better Auth adapter is unavailable.");
  await adapter.createUser({
    email: MEMBER,
    name: "Runner Member",
    emailVerified: true,
  });
  await adapter.createUser({
    email: PROVIDER_MEMBER,
    name: "Runner Provider Member",
    emailVerified: true,
  });
  await adapter.createUser({
    email: UNVERIFIED,
    name: "Runner Unverified",
    emailVerified: false,
  });
  await adapter.createUser({
    email: TWO_FACTOR,
    name: "Runner Two Factor",
    emailVerified: true,
  });
  await getDbExec().execute(
    sql`UPDATE "user" SET two_factor_enabled = ${sql.value(true)} WHERE email = ${sql.value(TWO_FACTOR)}`,
  );
  await getDbExec().execute(
    sql`INSERT INTO organizations (id, name, created_by, created_at, allowed_domain, required_auth_provider) VALUES (${sql.value("runner-provider-org")}, ${sql.value("Provider Org")}, ${sql.value(PROVIDER_MEMBER)}, ${sql.value(1)}, ${sql.value(PROVIDER_DOMAIN)}, ${sql.value("google")})`,
  );
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  resetAppConfigForTests();
  await closeDbExec();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

beforeEach(() => {
  resetRunnerSessionRateLimitForTests();
  vi.stubEnv("AUTH_ALLOWED_EMAIL_DOMAINS", "");
  vi.stubEnv("RUNNER_SESSION_SECRET", SECRET);
  vi.stubEnv(
    "RUNNER_SESSION_ALLOWED_EMAILS",
    `${MEMBER}, ${MISSING}, ${PROVIDER_MEMBER}, ${UNVERIFIED}, ${TWO_FACTOR}`,
  );
  resetAppConfigForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runner session route", () => {
  it.each([
    ["no secret", "", `${MEMBER}`],
    ["an empty allowlist", SECRET, ""],
  ])("is off with %s", async (_label, secret, allowlist) => {
    vi.stubEnv("RUNNER_SESSION_SECRET", secret);
    vi.stubEnv("RUNNER_SESSION_ALLOWED_EMAILS", allowlist);
    resetAppConfigForTests();

    const response = await post(signedBody(MEMBER));

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("runner_session_disabled");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("refuses a secret shorter than 32 characters when config loads", async () => {
    vi.stubEnv("RUNNER_SESSION_SECRET", "too-short");
    resetAppConfigForTests();

    const response = await post(signedBody(MEMBER));

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["a missing signature", { email: MEMBER, ts: 1, nonce: nextNonce() }],
    ["a fractional timestamp", { ...signedBody(MEMBER), ts: 1.5 }],
    ["a short nonce", { ...signedBody(MEMBER), nonce: "short" }],
    ["uppercase hex", { ...signedBody(MEMBER), sig: "ABCDEF" }],
    ["an array body", [signedBody(MEMBER)]],
  ])("rejects %s as an invalid request", async (_label, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_request");
  });

  it("limits a client's unsigned failures without blocking its signed sign-ins", async () => {
    const ip = "198.51.100.7";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await post({ email: MEMBER }, ip);
      expect(response.status).toBe(400);
    }

    const limited = await post(
      signedBody(MEMBER, { secret: "another-secret-of-sufficient-length-333" }),
      ip,
    );
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    const signed = await post(signedBody(MEMBER), ip);
    expect(signed.status).toBe(200);

    const otherClient = await post({ email: MEMBER }, "198.51.100.8");
    expect(otherClient.status).toBe(400);
  });

  it("refuses an email outside the allowlist", async () => {
    const response = await post(signedBody(OUTSIDER));

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("email_not_allowed");
  });

  it("checks the signature before saying whether an email is allowlisted", async () => {
    const wrongSecret = { secret: "another-secret-of-sufficient-length-222" };

    const outsider = await post(signedBody(OUTSIDER, wrongSecret));
    const member = await post(signedBody(MEMBER, wrongSecret));

    expect(outsider.status).toBe(401);
    expect(await errorCode(outsider)).toBe("bad_signature");
    expect(member.status).toBe(401);
    expect(await errorCode(member)).toBe("bad_signature");
  });

  it("never lets other clients' failures block a signed sign-in", async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await post({ email: MEMBER }, `192.0.2.${attempt}`);
      expect(response.status).toBe(400);
    }

    const signed = await post(signedBody(MEMBER), "192.0.2.200");

    expect(signed.status).toBe(200);
  });

  it("does not count signed sign-ins against their client", async () => {
    const ip = "192.0.2.201";
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await post(signedBody(MEMBER), ip);
      expect(response.status).toBe(200);
    }
  });

  it("refuses an unverified account when the deployment requires verified email", async () => {
    vi.stubEnv("AUTH_ALLOWED_EMAIL_DOMAINS", "example.test");
    resetAppConfigForTests();

    const response = await post(signedBody(UNVERIFIED));

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("email_unverified");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("refuses an unverified account when password sign-in requires verification", async () => {
    vi.stubEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", "true");
    vi.stubEnv("RESEND_API_KEY", "re_placeholder_for_tests");
    resetAppConfigForTests();
    try {
      const response = await post(signedBody(UNVERIFIED));

      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("email_unverified");
      expect(response.headers.getSetCookie()).toEqual([]);
    } finally {
      vi.stubEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", undefined);
      vi.stubEnv("RESEND_API_KEY", undefined);
      resetAppConfigForTests();
    }
  });

  it("signs in an unverified account when nothing requires verification", async () => {
    const response = await post(signedBody(UNVERIFIED));

    expect(response.status).toBe(200);
  });

  it("leaves enrolled two-factor sign-in in force", async () => {
    const response = await post(signedBody(TWO_FACTOR));

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("two_factor_required");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(
      await count(
        sql`SELECT COUNT(*) AS n FROM "session" s JOIN "user" u ON u.id = s.user_id WHERE u.email = ${sql.value(TWO_FACTOR)}`,
      ),
    ).toBe(0);
  });

  it.each([
    ["old", -120_000],
    ["future", 120_000],
  ])("refuses a timestamp that is too %s", async (_label, skew) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    const response = await post(signedBody(MEMBER, { ts: NOW + skew }));

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("stale_timestamp");
  });

  it.each([
    ["the wrong secret", { secret: "another-secret-of-sufficient-length-000" }],
    ["a signature of the wrong length", { sig: "ab".repeat(16) }],
    ["an odd-length signature", { sig: "a".repeat(63) }],
  ])("refuses %s", async (_label, overrides) => {
    const response = await post(signedBody(MEMBER, overrides));

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("bad_signature");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("refuses a nonce the second time it is used", async () => {
    const body = signedBody(MEMBER);
    const first = await post(body);
    expect(first.status).toBe(200);

    const replay = await post(body);

    expect(replay.status).toBe(409);
    expect(await errorCode(replay)).toBe("nonce_reused");
    expect(replay.headers.getSetCookie()).toEqual([]);
  });

  it("never creates an account for an allowlisted email without one", async () => {
    const users = await count(sql`SELECT COUNT(*) AS n FROM "user"`);
    const orgs = await count(sql`SELECT COUNT(*) AS n FROM organizations`);
    const members = await count(sql`SELECT COUNT(*) AS n FROM org_members`);

    const response = await post(signedBody(MISSING));

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("user_not_found");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await count(sql`SELECT COUNT(*) AS n FROM "user"`)).toBe(users);
    expect(
      await count(
        sql`SELECT COUNT(*) AS n FROM "user" WHERE email = ${sql.value(MISSING)}`,
      ),
    ).toBe(0);
    expect(await count(sql`SELECT COUNT(*) AS n FROM organizations`)).toBe(
      orgs,
    );
    expect(await count(sql`SELECT COUNT(*) AS n FROM org_members`)).toBe(
      members,
    );
  });

  it("signs in an allowlisted account with a short runner session", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now());
    const sentAt = Date.now();

    const response = await post(signedBody(`  ${MEMBER.toUpperCase()} `));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      email: string;
      expiresAt: string;
    };
    expect(body.ok).toBe(true);
    expect(body.email).toBe(MEMBER);
    expect(Date.parse(body.expiresAt)).toBe(sentAt + TWO_HOURS_MS);
    expect(response.headers.get("cache-control")).toBe("no-store");
    vi.useRealTimers();

    const cookie = sessionCookieHeader(response);
    expect(cookie).not.toBe("");
    expect(await sessionEmail(cookie)).toBe(MEMBER);

    const { rows } = await getDbExec().execute({
      sql: `SELECT s.token, s.user_agent, s.ip_address, s.expires_at FROM "session" s JOIN "user" u ON u.id = s.user_id WHERE u.email = ? AND s.expires_at = ?`,
      args: [MEMBER, new Date(body.expiresAt)],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_agent).toBe("runner");
    expect(rows[0]?.ip_address).toBe("203.0.113.10");
    const token = String(rows[0]?.token);
    expect(
      await count(
        sql`SELECT COUNT(*) AS n FROM sessions WHERE token = ${sql.value(token)}`,
      ),
    ).toBe(0);

    const audit = await getDbExec().execute({
      sql: `SELECT action, status, actor_email, input FROM agent_audit_log WHERE action = 'runner-session-sign-in' AND status = 'success' AND actor_email = ?`,
      args: [MEMBER],
    });
    expect(audit.rows.length).toBeGreaterThan(0);
    const input = String(audit.rows.at(-1)?.input);
    expect(JSON.parse(input)).toEqual({
      email: MEMBER,
      ip: "203.0.113.10",
      outcome: "ok",
      label: "runner",
    });
    expect(input).not.toContain(SECRET);

    const auth = await getBetterAuth();
    const read = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    });
    expect(read?.user.email).toBe(MEMBER);
    const after = await getDbExec().execute({
      sql: `SELECT expires_at FROM "session" WHERE token = ?`,
      args: [token],
    });
    expect(new Date(after.rows[0]?.expires_at as Date | string).getTime()).toBe(
      Date.parse(body.expiresAt),
    );

    await getDbExec().execute({
      sql: `UPDATE "session" SET expires_at = NOW() - INTERVAL '1 minute' WHERE token = ?`,
      args: [token],
    });
    expect(await sessionEmail(cookie)).toBeUndefined();
  });

  it("audits signed refusals as the runner's account, never the signature", async () => {
    const body = signedBody(MISSING);
    const response = await post(body);
    expect(response.status).toBe(403);

    const { rows } = await getDbExec().execute({
      sql: `SELECT actor_email, input FROM agent_audit_log WHERE action = 'runner-session-sign-in' AND status = 'denied'`,
      args: [],
    });
    const refused = rows.filter((row) =>
      String(row.input).includes("user_not_found"),
    );
    expect(refused.map((row) => row.actor_email)).toContain(MISSING);
    const inputs = rows.map((row) => String(row.input));
    expect(inputs.some((input) => input.includes(body.sig))).toBe(false);
  });

  it("writes no audit entry for an unsigned attempt", async () => {
    const before = await count(
      sql`SELECT COUNT(*) AS n FROM agent_audit_log WHERE action = 'runner-session-sign-in'`,
    );

    const response = await post(
      signedBody(MEMBER, { secret: "another-secret-of-sufficient-length-111" }),
    );

    expect(response.status).toBe(401);
    expect(
      await count(
        sql`SELECT COUNT(*) AS n FROM agent_audit_log WHERE action = 'runner-session-sign-in'`,
      ),
    ).toBe(before);
  });

  it("leaves an organization's required provider in force", async () => {
    const response = await post(signedBody(PROVIDER_MEMBER));

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("sign_in_provider_required");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(
      await count(
        sql`SELECT COUNT(*) AS n FROM "session" s JOIN "user" u ON u.id = s.user_id WHERE u.email = ${sql.value(PROVIDER_MEMBER)}`,
      ),
    ).toBe(0);
  });

  it("is reachable under an app base path", async () => {
    vi.stubEnv("APP_BASE_PATH", "/runner-app");
    resetAppConfigForTests();
    const inner = new H3();
    await autoMountAuth(getH3App({ h3: inner }), {});
    const mounted = new H3();
    mounted.mount("/runner-app", inner);

    const response = await mounted.request(
      new Request(
        "http://localhost/runner-app/_agent-native/auth/runner-session",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.20",
          },
          body: JSON.stringify(signedBody(MEMBER)),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, email: MEMBER });
    expect(sessionCookieHeader(response)).not.toBe("");
  });
});
