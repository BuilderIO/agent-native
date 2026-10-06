import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SINGLE_CONNECTION_NEON_URL,
  createSingleConnectionNeonPool,
} from "../db/test-single-connection-neon-pool.js";
import { ORG_MIGRATIONS } from "../org/migrations.js";
import { BETTER_AUTH_MIGRATIONS } from "./better-auth-migrations.js";

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
  it("records the verification email on the sign-up transaction's connection", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "email_1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { auth, pglite, stats } = await bootSignUp({
      AUTH_REQUIRE_EMAIL_VERIFICATION: "1",
      RESEND_API_KEY: "re_test_not_a_real_key",
      EMAIL_FROM: "Test <test@example.test>",
    });

    await auth.api.signUpEmail({
      body: {
        email: "verify-me@example.test",
        password: "correct-horse-battery",
        name: "verify-me",
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
    expect(stats.maxWaiting).toBe(0);
  });
});
