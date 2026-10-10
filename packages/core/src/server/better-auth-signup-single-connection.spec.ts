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

  it.each(["provider rejection", "network failure"])(
    "rejects verification signup on %s and permits a successful retry",
    async (failure) => {
      const fetchMock = vi.fn(async () => {
        if (failure === "network failure") throw new TypeError("fetch failed");
        return new Response(JSON.stringify({ message: "API key is invalid" }), {
          status: 401,
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const { auth, pglite, stats } = await bootSignUp({
        AUTH_REQUIRE_EMAIL_VERIFICATION: "1",
        RESEND_API_KEY: "re_test_not_a_real_key",
        EMAIL_FROM: "Test <test@example.test>",
        APP_URL: "https://auth.example.test",
      });
      const signup = () =>
        auth.api.signUpEmail({
          body: {
            email: "delivery+qa@example.test",
            password: "correct-horse-battery",
            name: "delivery",
          },
        });

      await expect(signup()).rejects.toThrow();
      expect((await pglite.query('SELECT id FROM "user"')).rows).toHaveLength(
        0,
      );
      expect(
        (await pglite.query('SELECT id FROM "session"')).rows,
      ).toHaveLength(0);

      fetchMock.mockImplementation(
        async () =>
          new Response(JSON.stringify({ id: "email_retry" }), { status: 200 }),
      );
      await expect(signup()).resolves.toMatchObject({
        user: { email: "delivery+qa@example.test", emailVerified: false },
        token: null,
      });
      expect((await pglite.query('SELECT email FROM "user"')).rows).toEqual([
        { email: "delivery+qa@example.test" },
      ]);
      fetchMock.mockImplementation(
        async () =>
          new Response(JSON.stringify({ message: "API key is invalid" }), {
            status: 401,
          }),
      );
      await expect(
        auth.api.sendVerificationEmail({
          body: { email: "delivery+qa@example.test" },
        }),
      ).rejects.toThrow();
      await expect(signup()).rejects.toThrow();
      await pglite.exec('UPDATE "user" SET email_verified = TRUE');
      await expect(signup()).rejects.toThrow();
      expect(
        (await pglite.query('SELECT email_verified FROM "user"')).rows,
      ).toEqual([{ email_verified: true }]);
      fetchMock.mockImplementation(
        async () =>
          new Response(JSON.stringify({ id: "email_resend" }), { status: 200 }),
      );
      await expect(
        auth.api.sendVerificationEmail({
          body: { email: "delivery+qa@example.test" },
        }),
      ).resolves.toEqual({ status: true });
      await expect(signup()).resolves.toMatchObject({ token: null });
      // Log schema introspection queues one query before signup's transaction.
      expect(stats.maxWaiting).toBeLessThanOrEqual(1);
    },
  );

  it.each([
    ["application/json", false],
    ["application/x-www-form-urlencoded", true],
    ["Application/X-WWW-Form-Urlencoded; charset=UTF-8", true],
    ["application/json; profile=application/x-www-form-urlencoded", false],
  ])(
    "keeps new and existing verification signup responses consistent for %s",
    async (contentType, formEncoded) => {
      const fetchMock = vi.fn(
        async (_input: unknown, _init?: RequestInit) =>
          new Response(JSON.stringify({ id: "email_http" }), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const { auth, pglite } = await bootSignUp({
        AUTH_REQUIRE_EMAIL_VERIFICATION: "1",
        RESEND_API_KEY: "re_test_not_a_real_key",
        EMAIL_FROM: "Test <test@example.test>",
        APP_URL: "https://auth.example.test",
      });
      const signup = (email = "http-signup@example.test") => {
        const body = {
          email,
          password: "correct-horse-battery",
          name: "http-signup",
          callbackURL: "https://auth.example.test/after-signup",
        };
        return auth.handler(
          new Request(
            "https://auth.example.test/_agent-native/auth/ba/sign-up/email",
            {
              method: "POST",
              headers: {
                "content-type": contentType,
                origin: "https://auth.example.test",
              },
              body: formEncoded
                ? new URLSearchParams(body)
                : JSON.stringify(body),
            },
          ),
        );
      };

      expect((await signup()).status).toBe(200);
      expect((await signup()).status).toBe(200);
      await pglite.exec('UPDATE "user" SET email_verified = TRUE');
      const accounts = (await pglite.query("SELECT id, password FROM account"))
        .rows;
      expect((await signup()).status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      for (const [, init] of fetchMock.mock.calls) {
        const payload = JSON.parse(String(init?.body)) as { html: string };
        const href = payload.html.match(
          /href="([^"]*email-link\/landing[^"]*)"/,
        )?.[1];
        expect(href).toBeTruthy();
        const landingURL = new URL(href!.replaceAll("&amp;", "&"));
        expect(landingURL.searchParams.get("callbackURL")).toBe(
          "https://auth.example.test/after-signup",
        );
      }

      fetchMock.mockImplementation(
        async () =>
          new Response(JSON.stringify({ message: "API key is invalid" }), {
            status: 401,
          }),
      );
      const existingFailure = await signup();
      const newFailure = await signup("new-http-signup@example.test");
      expect(existingFailure.status).toBe(500);
      expect(newFailure.status).toBe(existingFailure.status);
      expect(
        (await pglite.query("SELECT id, password FROM account")).rows,
      ).toEqual(accounts);
      expect(
        (await pglite.query('SELECT email, email_verified FROM "user"')).rows,
      ).toEqual([{ email: "http-signup@example.test", email_verified: true }]);
      expect(
        (await pglite.query('SELECT id FROM "session"')).rows,
      ).toHaveLength(0);
    },
  );

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
    // Log schema introspection queues one query before signup's transaction.
    expect(stats.maxWaiting).toBeLessThanOrEqual(1);
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

  it("keeps email-change confirmations scanner-safe with custom app paths", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "email_change" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { auth, pglite } = await bootSignUp({
      AUTH_REQUIRE_EMAIL_VERIFICATION: "0",
      NODE_ENV: "production",
      RESEND_API_KEY: "re_test_not_a_real_key",
      EMAIL_FROM: "Test <test@example.test>",
      APP_URL: "https://design.example.test",
      VITE_APP_BASE_PATH: "/workspace",
      AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX: "/_platform",
      BETTER_AUTH_TRUSTED_ORIGINS: "https://workspace.example.test",
    });
    const email = "current-email@example.test";
    const newEmail = "new-email@example.test";
    const password = "correct-horse-battery";
    const callbackURL = "https://workspace.example.test/account";

    await auth.api.signUpEmail({
      body: { email, password, name: "email-change" },
      headers: new Headers({ "user-agent": "vitest" }),
    });
    await pglite.exec(
      `UPDATE "user" SET email_verified = TRUE WHERE email = '${email}'`,
    );

    const signInResponse = await auth.handler(
      new Request(
        "https://design.example.test/workspace/_platform/auth/ba/sign-in/email",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://design.example.test",
          },
          body: JSON.stringify({ email, password }),
        },
      ),
    );
    expect(signInResponse.status).toBe(200);
    const cookieHeader = signInResponse.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    expect(cookieHeader).toContain("session_token=");

    const changeEmailResponse = await auth.handler(
      new Request(
        "https://design.example.test/workspace/_platform/auth/ba/change-email",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: cookieHeader,
            origin: "https://design.example.test",
          },
          body: JSON.stringify({ newEmail, callbackURL }),
        },
      ),
    );
    expect(changeEmailResponse.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstEmail = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { to: string; html: string };
    expect(firstEmail.to).toBe(email);
    const firstHref = firstEmail.html.match(
      /href="([^"]*email-link\/landing[^"]*)"/,
    )?.[1];
    expect(firstHref).toBeTruthy();
    const firstLandingURL = new URL(firstHref!.replaceAll("&amp;", "&"));
    expect(firstLandingURL.pathname).toBe(
      "/workspace/_platform/auth/email-link/landing",
    );
    expect(firstLandingURL.searchParams.get("callbackURL")).toBe(callbackURL);

    const landingHandler = await mountEmailAuthLandingHandler();
    const firstFields = emailAuthLinkFields(
      Object.fromEntries(firstLandingURL.searchParams.entries()),
    );
    expect(firstFields).toBeTruthy();
    for (let scannerRequest = 0; scannerRequest < 2; scannerRequest++) {
      const landingResponse = (await landingHandler(
        createEmailAuthEvent(new Request(firstLandingURL)),
      )) as Response;
      expect(landingResponse.status).toBe(200);
      await landingResponse.text();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await pglite.query(`SELECT email FROM "user"`)).rows).toEqual([
      { email },
    ]);

    const firstContinue = (await landingHandler(
      createEmailAuthEvent(
        createEmailAuthPostRequest(firstLandingURL, firstFields!),
      ),
    )) as Response;
    expect(firstContinue.status).toBe(303);
    const firstVerification = await auth.handler(
      new Request(firstContinue.headers.get("location")!),
    );
    expect(firstVerification.status).toBe(302);
    expect(firstVerification.headers.get("location")).toBe(callbackURL);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondEmail = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as { to: string; html: string };
    expect(secondEmail.to).toBe(newEmail);
    const secondHref = secondEmail.html.match(
      /href="([^"]*email-link\/landing[^"]*)"/,
    )?.[1];
    expect(secondHref).toBeTruthy();
    const secondLandingURL = new URL(secondHref!.replaceAll("&amp;", "&"));
    expect(secondLandingURL.pathname).toBe(firstLandingURL.pathname);

    const secondFields = emailAuthLinkFields(
      Object.fromEntries(secondLandingURL.searchParams.entries()),
    );
    expect(secondFields).toBeTruthy();
    const scannerLandingResponse = (await landingHandler(
      createEmailAuthEvent(new Request(secondLandingURL)),
    )) as Response;
    expect(scannerLandingResponse.status).toBe(200);
    await scannerLandingResponse.text();
    expect((await pglite.query(`SELECT email FROM "user"`)).rows).toEqual([
      { email },
    ]);

    const secondContinue = (await landingHandler(
      createEmailAuthEvent(
        createEmailAuthPostRequest(secondLandingURL, secondFields!),
      ),
    )) as Response;
    expect(secondContinue.status).toBe(303);
    const secondVerification = await auth.handler(
      new Request(secondContinue.headers.get("location")!),
    );
    expect(secondVerification.status).toBe(302);
    expect(secondVerification.headers.get("location")).toBe(callbackURL);
    expect(
      (await pglite.query(`SELECT email, email_verified FROM "user"`)).rows,
    ).toEqual([{ email: newEmail, email_verified: true }]);
  });
});
