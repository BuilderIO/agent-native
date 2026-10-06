import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SINGLE_CONNECTION_NEON_URL,
  createSingleConnectionNeonPool,
} from "../db/test-single-connection-neon-pool.js";
import { ORG_MIGRATIONS } from "../org/migrations.js";
import { BETTER_AUTH_MIGRATIONS } from "./better-auth-migrations.js";
import {
  EMAIL_AUTH_LINK_LANDING_PATH,
  emailAuthLinkFields,
} from "./email-auth-links.js";

async function bootSignUp(env: Record<string, string>) {
  vi.stubEnv("DATABASE_URL", SINGLE_CONNECTION_NEON_URL);
  vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "register-single-connection-test");
  vi.stubEnv("DB_OP_TIMEOUT_MS", "250");
  vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(48));
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

  const { pool, pglite, stats } = await createSingleConnectionNeonPool();
  for (const entry of BETTER_AUTH_MIGRATIONS) {
    const sql = typeof entry.sql === "string" ? entry.sql : entry.sql.postgres;
    if (sql) await pglite.exec(sql);
  }
  for (const entry of ORG_MIGRATIONS) await pglite.exec(entry.sql);

  const { getRuntimeDatabaseUrl, sharedDbPool } =
    await import("../db/client.js");
  sharedDbPool(
    "neon",
    getRuntimeDatabaseUrl("pglite:./data/pglite"),
    () => pool,
  );
  const { getBetterAuth } = await import("./better-auth-instance.js");
  return { auth: await getBetterAuth(), pglite, stats };
}

async function mountEmailAuthLandingHandler() {
  const app = { use: vi.fn() };
  const { autoMountAuth } = await import("./auth.js");
  await autoMountAuth(app as any);
  const handler = app.use.mock.calls.find(
    (call: any[]) => call[0] === EMAIL_AUTH_LINK_LANDING_PATH,
  )?.[1];
  if (typeof handler !== "function") {
    throw new Error("Email-auth landing route was not mounted.");
  }
  return handler as (event: any) => Promise<unknown>;
}

function createEmailAuthEvent(request: Request): any {
  const url = new URL(request.url);
  const path = `${url.pathname}${url.search}`;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("host", url.host);
  const requestWithHost = new Request(request, { headers: requestHeaders });
  const headers = Object.fromEntries(requestHeaders.entries());
  return {
    req: requestWithHost,
    url,
    path,
    headers: requestHeaders,
    context: {},
    res: { headers: new Headers(), status: 200 },
    node: {
      req: { url: path, method: request.method, headers },
      res: {
        setHeader: vi.fn(),
        getHeader: vi.fn(),
        appendHeader: vi.fn(),
      },
    },
  };
}

function createEmailAuthPostRequest(
  url: URL,
  fields: Record<string, string>,
): Request {
  return new Request(`${url.origin}${url.pathname}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

// signUpEmail runs its whole body inside one Better Auth transaction. On a
// one-connection pool that transaction holds the only connection, so any
// callback inside it that opens a second handle (getDbExec(), getDb()) waits
// for a connection its own transaction never releases: 3 acquire timeouts, then
// a 500 (production saw 3 x 15s).
describe("password sign-up on a one-connection Neon pool", () => {
  afterEach(async () => {
    const { closeDbExec } = await import("../db/client.js");
    await closeDbExec();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("creates the user and session, checking the required auth provider inside the transaction", async () => {
    const { auth, pglite, stats } = await bootSignUp({
      AUTH_REQUIRE_EMAIL_VERIFICATION: "0",
    });

    const result = await auth.api.signUpEmail({
      body: {
        email: "new-user@example.test",
        password: "correct-horse-battery",
        name: "new-user",
      },
      headers: new Headers({ "user-agent": "vitest" }),
    });

    expect(result.user.email).toBe("new-user@example.test");
    expect((await pglite.query(`SELECT email FROM "user"`)).rows).toEqual([
      { email: "new-user@example.test" },
    ]);
    expect((await pglite.query(`SELECT id FROM "session"`)).rows).toHaveLength(
      1,
    );
    expect(stats.maxWaiting).toBe(0);
  });

  // With verification required, signUpEmail creates no session and awaits
  // sendVerificationEmail inside the transaction. sendEmail then records the
  // send in email_log through getDbExec(). recordEmailSend swallows its own
  // failure, so on an unscoped handle the sign-up still "works" until the
  // server drops the idle transaction and COMMIT fails.
  it("completes email verification after a scanner-shaped GET", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "email_1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { auth, pglite, stats } = await bootSignUp({
      AUTH_REQUIRE_EMAIL_VERIFICATION: "1",
      NODE_ENV: "production",
      RESEND_API_KEY: "re_test_not_a_real_key",
      EMAIL_FROM: "Test <test@example.test>",
      APP_URL: "https://design.example.test",
      VITE_APP_BASE_PATH: "/workspace",
      AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX: "/_platform",
      BETTER_AUTH_TRUSTED_ORIGINS: "https://workspace.example.test",
    });
    const callbackURL = "https://workspace.example.test/after-auth";

    await auth.api.signUpEmail({
      body: {
        email: "verify-me@example.test",
        password: "correct-horse-battery",
        name: "verify-me",
        callbackURL,
      },
      headers: new Headers({ "user-agent": "vitest" }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      (await pglite.query(`SELECT email, email_verified FROM "user"`)).rows,
    ).toEqual([{ email: "verify-me@example.test", email_verified: false }]);
    expect(
      (await pglite.query(`SELECT recipient, status FROM email_log`)).rows,
    ).toEqual([{ recipient: "verify-me@example.test", status: "sent" }]);

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      html: string;
    };
    const href = payload.html.match(
      /href="([^"]*email-link\/landing[^"]*)"/,
    )?.[1];
    expect(href).toBeTruthy();
    const landingURL = new URL(href!.replaceAll("&amp;", "&"));
    expect(landingURL.pathname).toBe(
      "/workspace/_platform/auth/email-link/landing",
    );
    expect(landingURL.searchParams.get("kind")).toBe("verify-email");
    expect(landingURL.searchParams.get("callbackURL")).toBe(callbackURL);
    const fields = emailAuthLinkFields(
      Object.fromEntries(landingURL.searchParams.entries()),
    );
    expect(fields).toBeTruthy();
    const landingHandler = await mountEmailAuthLandingHandler();
    for (let scannerRequest = 0; scannerRequest < 2; scannerRequest++) {
      const landing = (await landingHandler(
        createEmailAuthEvent(new Request(landingURL)),
      )) as Response;
      expect(landing.status).toBe(200);
      expect(landing.headers.get("content-type")).toContain("text/html");
      await landing.text();
    }
    expect((await pglite.query(`SELECT id FROM "session"`)).rows).toHaveLength(
      0,
    );

    const rejectedCallbackResponse = (await landingHandler(
      createEmailAuthEvent(
        createEmailAuthPostRequest(landingURL, {
          ...fields!,
          callbackURL: "https://evil.example/steal",
        }),
      ),
    )) as Response;
    const rejectedVerificationResponse = await auth.handler(
      new Request(rejectedCallbackResponse.headers.get("location")!),
    );
    expect(rejectedVerificationResponse.status).toBe(403);
    expect(
      (
        await pglite.query(
          `SELECT email_verified FROM "user" WHERE email = 'verify-me@example.test'`,
        )
      ).rows,
    ).toEqual([{ email_verified: false }]);

    const continueResponse = (await landingHandler(
      createEmailAuthEvent(createEmailAuthPostRequest(landingURL, fields!)),
    )) as Response;
    expect(continueResponse.status).toBe(303);
    const verificationResponse = await auth.handler(
      new Request(continueResponse.headers.get("location")!),
    );
    expect(verificationResponse.status).toBe(302);
    expect(verificationResponse.headers.get("location")).toBe(callbackURL);
    const cookieHeader = verificationResponse.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeader }),
    });
    expect(session?.user.email).toBe("verify-me@example.test");
    expect(
      (
        await pglite.query(
          `SELECT email FROM "user" WHERE email_verified = TRUE`,
        )
      ).rows,
    ).toEqual([{ email: "verify-me@example.test" }]);
    expect((await pglite.query(`SELECT id FROM "session"`)).rows).toHaveLength(
      1,
    );
    expect(stats.maxWaiting).toBe(0);
  });

  it("keeps a magic link usable after a scanner-shaped GET", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "email_magic" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { auth, pglite } = await bootSignUp({
      AUTH_REQUIRE_EMAIL_VERIFICATION: "0",
      RESEND_API_KEY: "re_test_not_a_real_key",
      EMAIL_FROM: "Test <test@example.test>",
      APP_URL: "http://localhost:3000",
      BETTER_AUTH_TRUSTED_ORIGINS: "https://workspace.example.test",
    });
    const email = "magic-link-user@example.test";

    await auth.api.signUpEmail({
      body: {
        email,
        password: "correct-horse-battery",
        name: "magic-link-user",
      },
      headers: new Headers({ "user-agent": "vitest" }),
    });
    await auth.api.signInMagicLink({
      body: {
        email,
        callbackURL: "https://workspace.example.test/after-magic-link",
      },
      headers: new Headers({ "user-agent": "vitest" }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      html: string;
    };
    const href = payload.html.match(
      /href="([^"]*email-link\/landing[^"]*)"/,
    )?.[1];
    expect(href).toBeTruthy();
    const landingURL = new URL(href!.replaceAll("&amp;", "&"));
    expect(landingURL.pathname).toBe(EMAIL_AUTH_LINK_LANDING_PATH);
    expect(landingURL.searchParams.get("callbackURL")).toBe(
      "https://workspace.example.test/after-magic-link",
    );

    const fields = emailAuthLinkFields(
      Object.fromEntries(landingURL.searchParams.entries()),
    );
    expect(fields).toBeTruthy();
    const landingHandler = await mountEmailAuthLandingHandler();
    const sessionsBeforeVerification = await pglite.query(
      `SELECT id FROM "session"`,
    );
    for (let scannerRequest = 0; scannerRequest < 2; scannerRequest++) {
      const landingResponse = (await landingHandler(
        createEmailAuthEvent(new Request(landingURL)),
      )) as Response;
      expect(landingResponse.status).toBe(200);
      await landingResponse.text();
    }
    expect((await pglite.query(`SELECT id FROM "session"`)).rows.length).toBe(
      sessionsBeforeVerification.rows.length,
    );

    const continueResponse = (await landingHandler(
      createEmailAuthEvent(createEmailAuthPostRequest(landingURL, fields!)),
    )) as Response;
    expect(continueResponse.status).toBe(303);
    const verificationResponse = await auth.handler(
      new Request(continueResponse.headers.get("location")!),
    );
    expect(verificationResponse.status).toBe(302);
    expect(verificationResponse.headers.get("location")).toContain(
      "https://workspace.example.test/after-magic-link",
    );
    const setCookies = verificationResponse.headers.getSetCookie();
    const cookieHeader = setCookies
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    expect(cookieHeader).toContain("session_token=");
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeader }),
    });
    expect(session?.user.email).toBe(email);
    expect(
      (await pglite.query(`SELECT id FROM "session"`)).rows.length,
    ).toBeGreaterThan(0);
  });
});
