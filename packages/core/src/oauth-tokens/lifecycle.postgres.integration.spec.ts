import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

interface WorkerResult {
  accessToken?: string | null;
  attemptCount?: number;
  kind?: string;
  redemptionCount?: number;
}

const workerMode = process.env.OAUTH_LIFECYCLE_WORKER_MODE;
const workerPrefix = "OAUTH_LIFECYCLE_WORKER_RESULT ";

function testIdentity(testId: string) {
  return {
    provider: "oauth-postgres-integration",
    accountId: `multi-process-${testId}`,
    resource: `https://oauth.example.test/resource/${testId}`,
    owner: { scope: "user" as const, id: `qa-${testId}@example.test` },
  };
}

function leaseKey(testId: string): string {
  const identity = testIdentity(testId);
  const owner = `${identity.owner.scope}:${identity.owner.id.toLowerCase()}`;
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        identity.provider,
        identity.accountId,
        identity.resource,
        owner,
      ]),
    )
    .digest("hex");
  return `oauth-refresh-lease:${digest}`;
}

async function runWorker(mode: string): Promise<WorkerResult> {
  const testId = process.env.OAUTH_LIFECYCLE_TEST_ID;
  if (!testId) throw new Error("OAUTH_LIFECYCLE_TEST_ID is required.");

  const { closeDbExec, getDbExec } = await import("../db/client.js");
  const { mutateSetting } = await import("../settings/store.js");
  const {
    readOAuthCredentialState,
    resolveOAuthCredentialAccess,
    revokeOAuthCredential,
    saveOAuthCredential,
  } = await import("./lifecycle.js");
  const db = getDbExec();
  const identity = testIdentity(testId);
  const initialAccess = `test-initial-access-${testId}`;
  const initialRefresh = `test-initial-refresh-${testId}`;
  const rotatedAccess = `test-rotated-access-${testId}`;
  const rotatedRefresh = `test-rotated-refresh-${testId}`;

  try {
    if (mode === "seed") {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS public.oauth_lifecycle_refresh_test (
          id TEXT PRIMARY KEY,
          current_refresh_token TEXT NOT NULL,
          attempt_count BIGINT NOT NULL,
          redemption_count BIGINT NOT NULL,
          ready_count BIGINT NOT NULL
        )
      `);
      await db.execute({
        sql: `DELETE FROM public.oauth_lifecycle_refresh_test WHERE id = ?`,
        args: [testId],
      });
      await db.execute({
        sql: `INSERT INTO public.oauth_lifecycle_refresh_test (id, current_refresh_token, attempt_count, redemption_count, ready_count) VALUES (?, ?, 0, 0, 0)`,
        args: [testId, initialRefresh],
      });
      await saveOAuthCredential(identity, {
        tokens: {
          access_token: initialAccess,
          refresh_token: initialRefresh,
        },
        tokenExpiresAt: Date.now() - 1,
      });
      await mutateSetting(`oauth-postgres-bootstrap:${testId}`, () => ({
        ready: true,
      }));
      await db.execute({
        sql: `DELETE FROM public.settings WHERE key = ?`,
        args: [`oauth-postgres-bootstrap:${testId}`],
      });
      return { kind: "seeded" };
    }

    if (mode === "resolve") {
      await db.execute({
        sql: `UPDATE public.oauth_lifecycle_refresh_test SET ready_count = ready_count + 1 WHERE id = ?`,
        args: [testId],
      });
      const barrierStartedAt = Date.now();
      while (Date.now() - barrierStartedAt < 5_000) {
        const barrier = await db.execute({
          sql: `SELECT ready_count FROM public.oauth_lifecycle_refresh_test WHERE id = ?`,
          args: [testId],
        });
        if (Number(barrier.rows[0]?.ready_count ?? 0) >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const result = await resolveOAuthCredentialAccess(identity, {
        leaseMs: 500,
        waitMs: 10,
        maxWaitMs: 8_000,
        refresh: async ({ credential }) => {
          await db.execute({
            sql: `UPDATE public.oauth_lifecycle_refresh_test SET attempt_count = attempt_count + 1 WHERE id = ?`,
            args: [testId],
          });
          const redemption = await db.execute({
            sql: `UPDATE public.oauth_lifecycle_refresh_test SET current_refresh_token = ?, redemption_count = redemption_count + 1 WHERE id = ? AND current_refresh_token = ? RETURNING redemption_count`,
            args: [rotatedRefresh, testId, credential.tokens.refresh_token],
          });
          if (redemption.rowsAffected !== 1) {
            throw new Error("The rotating refresh token was already redeemed.");
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
          return {
            ...credential,
            tokens: {
              ...credential.tokens,
              access_token: rotatedAccess,
              refresh_token: rotatedRefresh,
            },
            tokenExpiresAt: Date.now() + 3_600_000,
          };
        },
      });
      return { kind: result.state.kind, accessToken: result.accessToken };
    }

    if (mode === "inspect") {
      const provider = await db.execute({
        sql: `SELECT attempt_count, redemption_count FROM public.oauth_lifecycle_refresh_test WHERE id = ?`,
        args: [testId],
      });
      const state = await readOAuthCredentialState(identity);
      return {
        kind: state.kind,
        accessToken:
          state.kind === "connected"
            ? state.credential.tokens.access_token
            : null,
        attemptCount: Number(provider.rows[0]?.attempt_count ?? -1),
        redemptionCount: Number(provider.rows[0]?.redemption_count ?? -1),
      };
    }

    if (mode === "cleanup") {
      await revokeOAuthCredential(identity);
      await db.execute({
        sql: `DELETE FROM public.oauth_lifecycle_refresh_test WHERE id = ?`,
        args: [testId],
      });
      await db.execute({
        sql: `DELETE FROM public.settings WHERE key = ?`,
        args: [leaseKey(testId)],
      });
      return { kind: "cleaned" };
    }

    throw new Error(`Unknown worker mode: ${mode}`);
  } finally {
    await closeDbExec();
  }
}

if (workerMode) {
  const result = await runWorker(workerMode);
  process.stdout.write(`${workerPrefix}${JSON.stringify(result)}\n`);
} else {
  const { describe, expect, it } = await import("vitest");

  const databaseUrl = process.env.OAUTH_LIFECYCLE_POSTGRES_TEST_URL;
  const integrationTest = databaseUrl ? it : it.skip;
  const workerFile = fileURLToPath(import.meta.url);
  const tsxLoader = import.meta.resolve("tsx");

  async function invokeWorker(mode: string, testId: string) {
    return await new Promise<WorkerResult>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", tsxLoader, workerFile],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
            SECRETS_ENCRYPTION_KEY: "oauth-lifecycle-integration-test-key",
            OAUTH_LIFECYCLE_TEST_ID: testId,
            OAUTH_LIFECYCLE_WORKER_MODE: mode,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `OAuth lifecycle ${mode} worker exited ${code}: ${stderr || stdout}`,
            ),
          );
          return;
        }
        const resultLine = stdout
          .split("\n")
          .find((line) => line.startsWith(workerPrefix));
        if (!resultLine) {
          reject(
            new Error(
              `OAuth lifecycle ${mode} worker returned no result: ${stderr || stdout}`,
            ),
          );
          return;
        }
        resolve(JSON.parse(resultLine.slice(workerPrefix.length)));
      });
    });
  }

  describe("OAuth lifecycle on shared Postgres", () => {
    integrationTest(
      "lets two independent processes share one rotating refresh redemption and reload the winner",
      async () => {
        const testId = randomUUID();
        await invokeWorker("seed", testId);
        try {
          const [first, second] = await Promise.all([
            invokeWorker("resolve", testId),
            invokeWorker("resolve", testId),
          ]);
          const expectedAccessToken = `test-rotated-access-${testId}`;
          expect(first).toMatchObject({
            kind: "connected",
            accessToken: expectedAccessToken,
          });
          expect(second).toMatchObject({
            kind: "connected",
            accessToken: expectedAccessToken,
          });
          await expect(invokeWorker("inspect", testId)).resolves.toMatchObject({
            kind: "connected",
            accessToken: expectedAccessToken,
            attemptCount: 1,
            redemptionCount: 1,
          });
        } finally {
          await invokeWorker("cleanup", testId);
        }
      },
      30_000,
    );
  });
}
