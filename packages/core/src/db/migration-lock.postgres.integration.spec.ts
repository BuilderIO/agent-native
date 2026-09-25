import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

interface WorkerResult {
  violation?: boolean;
  kind?: string;
}

const workerMode = process.env.MIGRATION_LOCK_WORKER_MODE;
const workerPrefix = "MIGRATION_LOCK_WORKER_RESULT ";

async function runWorker(mode: string): Promise<WorkerResult> {
  const testId = process.env.MIGRATION_LOCK_TEST_ID;
  if (!testId) throw new Error("MIGRATION_LOCK_TEST_ID is required.");

  const { closeDbExec, getDbExec, getMigrationDatabaseUrl } =
    await import("./client.js");
  const { withMigrationAdvisoryLock } = await import("./migration-lock.js");
  const db = getDbExec();

  try {
    if (mode === "seed") {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS public.migration_lock_probe_test (
          id TEXT PRIMARY KEY,
          holder TEXT,
          ready_count BIGINT NOT NULL DEFAULT 0
        )
      `);
      await db.execute({
        sql: `DELETE FROM public.migration_lock_probe_test WHERE id = ?`,
        args: [testId],
      });
      await db.execute({
        sql: `INSERT INTO public.migration_lock_probe_test (id, holder, ready_count) VALUES (?, NULL, 0)`,
        args: [testId],
      });
      return { kind: "seeded" };
    }

    if (mode === "hold") {
      await db.execute({
        sql: `UPDATE public.migration_lock_probe_test SET ready_count = ready_count + 1 WHERE id = ?`,
        args: [testId],
      });
      const barrierStartedAt = Date.now();
      let bothWorkersReady = false;
      while (Date.now() - barrierStartedAt < 5_000) {
        const barrier = await db.execute({
          sql: `SELECT ready_count FROM public.migration_lock_probe_test WHERE id = ?`,
          args: [testId],
        });
        if (Number(barrier.rows[0]?.ready_count ?? 0) >= 2) {
          bothWorkersReady = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (!bothWorkersReady) {
        throw new Error(
          "Both migration lock workers did not reach the concurrency barrier.",
        );
      }

      let violation = false;
      await withMigrationAdvisoryLock(getMigrationDatabaseUrl(), async () => {
        const holderId = `${process.pid}-${Math.random()}`;
        await db.execute({
          sql: `UPDATE public.migration_lock_probe_test SET holder = ? WHERE id = ?`,
          args: [holderId, testId],
        });
        // Long enough that a second, unserialized holder reliably stomps this
        // row before we wake up and check it below.
        await new Promise((resolve) => setTimeout(resolve, 300));
        const { rows } = await db.execute({
          sql: `SELECT holder FROM public.migration_lock_probe_test WHERE id = ?`,
          args: [testId],
        });
        if (rows[0]?.holder !== holderId) violation = true;
        await db.execute({
          sql: `UPDATE public.migration_lock_probe_test SET holder = NULL WHERE id = ?`,
          args: [testId],
        });
      });
      return { kind: "held", violation };
    }

    if (mode === "cleanup") {
      await db.execute({
        sql: `DELETE FROM public.migration_lock_probe_test WHERE id = ?`,
        args: [testId],
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

  const databaseUrl = process.env.MIGRATION_LOCK_POSTGRES_TEST_URL;
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
            MIGRATION_LOCK_TEST_ID: testId,
            MIGRATION_LOCK_WORKER_MODE: mode,
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
              `Migration lock ${mode} worker exited ${code}: ${stderr || stdout}`,
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
              `Migration lock ${mode} worker returned no result: ${stderr || stdout}`,
            ),
          );
          return;
        }
        resolve(JSON.parse(resultLine.slice(workerPrefix.length)));
      });
    });
  }

  describe("Cross-process migration advisory lock on shared Postgres", () => {
    integrationTest(
      "never lets two independent processes hold the lock at the same time",
      async () => {
        const testId = randomUUID();
        await invokeWorker("seed", testId);
        try {
          const [first, second] = await Promise.all([
            invokeWorker("hold", testId),
            invokeWorker("hold", testId),
          ]);
          expect(first).toMatchObject({ kind: "held", violation: false });
          expect(second).toMatchObject({ kind: "held", violation: false });
        } finally {
          await invokeWorker("cleanup", testId);
        }
      },
      20_000,
    );
  });
}
