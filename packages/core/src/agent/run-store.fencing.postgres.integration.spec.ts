import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { toPostgresParams, withDbExec, type DbExec } from "../db/client.js";
import { withMigrationRuntime } from "../db/migration-runtime.js";
import { withExecutionFence, type ExecutionFence } from "./execution-fence.js";
import {
  beginAgentExecutionStep,
  claimTaskExecutionLease,
  claimTurnExecutionLease,
  completeAgentExecutionStep,
  ensureRunTables,
  insertRun,
  insertRunEvent,
  markAgentExecutionStepDispatched,
  markTurnAborted,
  renewTaskExecutionLease,
  type AgentExecutionStepIntent,
} from "./run-store.js";

const databaseUrl = process.env.AGENT_RUN_POSTGRES_TEST_URL; // config-ok: isolated integration-test database selector, not app runtime config
if (process.env.CI && !databaseUrl) {
  throw new Error("AGENT_RUN_POSTGRES_TEST_URL is required in CI");
}
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);
const workerPath = fileURLToPath(
  new URL("./run-store.fencing.worker.ts", import.meta.url),
);

function executor(sql: postgres.Sql): DbExec {
  return {
    async execute(statement) {
      const query =
        typeof statement === "string" ? { sql: statement } : statement;
      const rows = await sql.unsafe(
        toPostgresParams(query.sql),
        query.args as never[],
      );
      return { rows, rowsAffected: rows.count };
    },
    async transaction<T>(run: (tx: DbExec) => Promise<T>): Promise<T> {
      return (await sql.begin((tx) =>
        run(executor(tx as unknown as postgres.Sql)),
      )) as T;
    },
  };
}

interface WorkerResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runWorker(...args: string[]): Promise<WorkerResult> {
  return new Promise((resolveResult) => {
    execFile(
      process.execPath,
      ["--import", "tsx", workerPath, ...args],
      {
        cwd: repositoryRoot,
        env: process.env,
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
      },
      (error, stdout, stderr) => {
        const exitCode =
          typeof error?.code === "number" ? error.code : error ? 1 : 0;
        resolveResult({ exitCode, stdout, stderr });
      },
    );
  });
}

function workerJson<T>(result: WorkerResult): T {
  try {
    const output = result.stdout.trim();
    return JSON.parse(output.slice(output.lastIndexOf("\n") + 1)) as T;
  } catch {
    throw new Error(
      `Execution worker returned no JSON (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
    );
  }
}

function stepIntent(
  fence: ExecutionFence,
  stepId: string,
  replayPolicy: AgentExecutionStepIntent["replayPolicy"],
): AgentExecutionStepIntent {
  return {
    ...fence,
    stepId,
    operationId: "test:external-effect",
    toolName: "external-effect",
    inputJson: JSON.stringify({ stepId }),
    replayPolicy,
  };
}

async function withTestDatabase<T>(
  fn: (sql: postgres.Sql, prefix: string) => Promise<T>,
): Promise<T> {
  const sql = postgres(databaseUrl!, { max: 1 });
  const prefix = `execution-fence-${randomUUID().replaceAll("-", "")}`;
  try {
    await withDbExec(executor(sql), () =>
      withMigrationRuntime(() => ensureRunTables()),
    );
    await sql`
      CREATE TABLE IF NOT EXISTS agent_harness_test_effects (
        effect_id TEXT PRIMARY KEY,
        effect_count INTEGER NOT NULL
      )
    `;
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION agent_harness_reject_step_receipt()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'completed'
          AND NEW.step_id = current_setting('agent.harness_fail_step', true) THEN
          RAISE EXCEPTION 'test receipt commit rejected';
        END IF;
        RETURN NEW;
      END $$
    `);
    await sql.unsafe(`
      DROP TRIGGER IF EXISTS agent_harness_reject_step_receipt
      ON agent_execution_steps
    `);
    await sql.unsafe(`
      CREATE TRIGGER agent_harness_reject_step_receipt
      BEFORE UPDATE ON agent_execution_steps
      FOR EACH ROW EXECUTE FUNCTION agent_harness_reject_step_receipt()
    `);
    return await withDbExec(executor(sql), () => fn(sql, prefix));
  } finally {
    await sql`SELECT set_config('agent.harness_fail_step', '', false)`;
    await sql`DROP TRIGGER IF EXISTS agent_harness_reject_step_receipt ON agent_execution_steps`;
    await sql`DROP FUNCTION IF EXISTS agent_harness_reject_step_receipt()`;
    await sql`DELETE FROM agent_harness_test_effects WHERE effect_id LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM agent_execution_steps WHERE thread_id LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM agent_execution_leases WHERE thread_id LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM agent_run_events WHERE run_id LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM agent_runs WHERE id LIKE ${`${prefix}%`}`;
    await sql.end();
  }
}

async function forceLeaseExpiry(
  sql: postgres.Sql,
  threadId: string,
  turnId: string,
): Promise<void> {
  await sql`
    UPDATE agent_execution_leases
    SET lease_expires_at = clock_timestamp() - INTERVAL '1 millisecond'
    WHERE thread_id = ${threadId} AND turn_id = ${turnId}
  `;
}

async function claimInProcess(
  sql: postgres.Sql,
  threadId: string,
  turnId: string,
  runId: string,
): Promise<ExecutionFence> {
  return withDbExec(executor(sql), async () => {
    await insertRun(runId, threadId, turnId);
    return claimTurnExecutionLease(threadId, turnId, runId);
  });
}

describe.skipIf(!databaseUrl)(
  "execution lease and journal process failures",
  () => {
    it("serializes independent workers and rejects the old generation after takeover", async () => {
      await withTestDatabase(async (sql, prefix) => {
        const threadId = `${prefix}:thread`;
        const turnId = `${prefix}:turn`;
        const candidates = await Promise.all([
          runWorker("claim", threadId, turnId, `${prefix}:run-a`),
          runWorker("claim", threadId, turnId, `${prefix}:run-b`),
        ]);
        const decoded = candidates.map((candidate) => ({
          candidate,
          payload: workerJson<{
            fence?: ExecutionFence;
            code?: string;
          }>(candidate),
        }));
        const winner = decoded.find(({ payload }) => payload.fence);
        const loser = decoded.find(({ payload }) => payload.code);
        expect(winner?.candidate.exitCode).toBe(0);
        expect(loser?.candidate.exitCode).toBe(3);
        expect(loser?.payload.code).toBe("turn_execution_lease_busy");
        const firstFence = winner!.payload.fence!;

        const stillBusy = await runWorker(
          "claim",
          threadId,
          turnId,
          `${prefix}:run-c`,
        );
        expect(stillBusy.exitCode).toBe(3);
        expect(workerJson<{ code: string }>(stillBusy).code).toBe(
          "turn_execution_lease_busy",
        );

        await forceLeaseExpiry(sql, threadId, turnId);
        const recovery = await runWorker(
          "claim",
          threadId,
          turnId,
          `${prefix}:run-d`,
        );
        expect(recovery.exitCode).toBe(0);
        const secondFence = workerJson<{ fence: ExecutionFence }>(
          recovery,
        ).fence;
        expect(BigInt(secondFence.generation)).toBe(
          BigInt(firstFence.generation) + 1n,
        );

        const staleWrite = await runWorker(
          "stale-write",
          threadId,
          turnId,
          "unused",
          "unused",
          JSON.stringify(firstFence),
        );
        expect(staleWrite.exitCode).toBe(1);
        expect(workerJson<{ code: string }>(staleWrite).code).toBe(
          "stale_execution_fence",
        );
        const staleEvents = await sql`
        SELECT seq FROM agent_run_events WHERE run_id = ${firstFence.runId} AND seq = 77
      `;
        expect(staleEvents).toHaveLength(0);
      });
    }, 45_000);

    it("revokes a lease committed while turn cancellation waits for its lock", async () => {
      await withTestDatabase(async (sql, prefix) => {
        const claimDb = postgres(databaseUrl!, { max: 1 });
        const cancelDb = postgres(databaseUrl!, { max: 1 });
        const threadId = `${prefix}:cancel-race-thread`;
        const turnId = `${prefix}:cancel-race-turn`;
        const runId = `${prefix}:cancel-race-run`;
        const gateKey = Math.floor(Math.random() * 2_000_000_000);
        const suffix = randomUUID().replaceAll("-", "");
        const trigger = `cancel_race_gate_${suffix}`;
        let claim: Promise<ExecutionFence> | undefined;
        let cancel: Promise<"aborted" | "already_terminal"> | undefined;
        try {
          await insertRun(runId, threadId, turnId);
          await sql.unsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW.thread_id = '${threadId}' THEN
                PERFORM pg_advisory_xact_lock(${gateKey});
              END IF;
              RETURN NEW;
            END $$`);
          await sql.unsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE ON agent_execution_leases
            FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
          await sql`SELECT pg_advisory_lock(${gateKey})`;
          const [{ pid: claimPid }] =
            await claimDb`SELECT pg_backend_pid() AS pid`;
          const [{ pid: cancelPid }] =
            await cancelDb`SELECT pg_backend_pid() AS pid`;

          claim = withDbExec(executor(claimDb), () =>
            claimTurnExecutionLease(threadId, turnId, runId),
          );
          await expect
            .poll(async () => {
              const [row] =
                await sql`SELECT wait_event FROM pg_stat_activity WHERE pid = ${claimPid}`;
              return row.wait_event;
            })
            .toBe("advisory");

          cancel = withDbExec(executor(cancelDb), () =>
            markTurnAborted(threadId, turnId),
          );
          await expect
            .poll(async () => {
              const [row] =
                await sql`SELECT ${claimPid} = ANY(pg_blocking_pids(${cancelPid})) AS blocked`;
              return row.blocked;
            })
            .toBe(true);

          await sql`SELECT pg_advisory_unlock(${gateKey})`;
          const fence = await claim;
          expect(await cancel).toBe("aborted");
          const [run] =
            await sql`SELECT status FROM agent_runs WHERE id = ${runId}`;
          const [lease] =
            await sql`SELECT lease_expires_at <= clock_timestamp() AS expired
            FROM agent_execution_leases WHERE thread_id = ${threadId} AND turn_id = ${turnId}`;
          expect(run.status).toBe("aborted");
          expect(lease.expired).toBe(true);
          await expect(
            withExecutionFence(fence, () =>
              insertRunEvent(
                runId,
                77,
                JSON.stringify({ type: "text", text: "late write" }),
                { requireInserted: true },
              ),
            ),
          ).rejects.toMatchObject({ code: "stale_execution_fence" });
        } finally {
          await sql`SELECT pg_advisory_unlock(${gateKey})`;
          await Promise.allSettled([claim, cancel]);
          await sql.unsafe(
            `DROP TRIGGER IF EXISTS ${trigger} ON agent_execution_leases`,
          );
          await sql.unsafe(`DROP FUNCTION IF EXISTS ${trigger}()`);
          await claimDb.end();
          await cancelDb.end();
        }
      });
    }, 45_000);

    it("fences task workers without requiring an agent_runs owner row", async () => {
      await withTestDatabase(async (sql, prefix) => {
        const threadId = `${prefix}:a2a-task`;
        const turnId = `${prefix}:turn`;
        const firstFence = await claimTaskExecutionLease(
          threadId,
          turnId,
          `${prefix}:worker-a`,
        );

        const [owner] = await sql`
          SELECT id FROM agent_runs WHERE id = ${firstFence.runId}
        `;
        expect(owner).toBeUndefined();
        await renewTaskExecutionLease(firstFence);
        await expect(
          claimTaskExecutionLease(threadId, turnId, `${prefix}:worker-b`),
        ).rejects.toMatchObject({ code: "turn_execution_lease_busy" });

        await forceLeaseExpiry(sql, threadId, turnId);
        const secondFence = await claimTaskExecutionLease(
          threadId,
          turnId,
          `${prefix}:worker-b`,
        );
        expect(BigInt(secondFence.generation)).toBe(
          BigInt(firstFence.generation) + 1n,
        );

        await expect(
          withExecutionFence(firstFence, () =>
            beginAgentExecutionStep(
              stepIntent(firstFence, `${prefix}:stale-step`, "never"),
            ),
          ),
        ).rejects.toMatchObject({ code: "stale_execution_fence" });
        await expect(
          withExecutionFence(secondFence, () =>
            beginAgentExecutionStep(
              stepIntent(secondFence, `${prefix}:current-step`, "never"),
            ),
          ),
        ).resolves.toEqual({ status: "execute", wasDispatched: false });
      });
    }, 45_000);

    it("reclaims intent-only crashes and stops unsafe replay after an effect", async () => {
      await withTestDatabase(async (sql, prefix) => {
        const intentThread = `${prefix}:intent-thread`;
        const intentTurn = `${prefix}:intent-turn`;
        const intentStep = `${prefix}:intent-step`;
        const beforeDispatch = await runWorker(
          "crash-before-dispatch",
          intentThread,
          intentTurn,
          `${prefix}:intent-run`,
          intentStep,
        );
        expect(beforeDispatch.exitCode).toBe(81);
        expect(workerJson(beforeDispatch)).toMatchObject({
          admission: { status: "execute", wasDispatched: false },
        });
        await forceLeaseExpiry(sql, intentThread, intentTurn);
        const intentRecoveryFence = await claimInProcess(
          sql,
          intentThread,
          intentTurn,
          `${prefix}:intent-recovery`,
        );
        const intentRecovery = await withExecutionFence(
          intentRecoveryFence,
          async () => {
            const intent = stepIntent(intentRecoveryFence, intentStep, "never");
            const admission = await beginAgentExecutionStep(intent);
            expect(admission).toEqual({
              status: "execute",
              wasDispatched: false,
            });
            await markAgentExecutionStepDispatched(intent);
            await completeAgentExecutionStep(
              intent,
              JSON.stringify({ result: "saved", completedSideEffect: true }),
            );
            return admission;
          },
        );
        expect(intentRecovery.status).toBe("execute");

        const effectThread = `${prefix}:effect-thread`;
        const effectTurn = `${prefix}:effect-turn`;
        const effectStep = `${prefix}:effect-id`;
        const afterEffect = await runWorker(
          "crash-after-effect",
          effectThread,
          effectTurn,
          `${prefix}:effect-run`,
          effectStep,
        );
        expect(afterEffect.exitCode).toBe(82);
        await forceLeaseExpiry(sql, effectThread, effectTurn);
        const effectRecoveryFence = await claimInProcess(
          sql,
          effectThread,
          effectTurn,
          `${prefix}:effect-recovery`,
        );
        const effectRecovery = await withExecutionFence(
          effectRecoveryFence,
          () =>
            beginAgentExecutionStep(
              stepIntent(effectRecoveryFence, effectStep, "never"),
            ),
        );
        expect(effectRecovery).toEqual({ status: "unknown" });
        const effects = await sql`
        SELECT effect_count FROM agent_harness_test_effects WHERE effect_id = ${effectStep}
      `;
        expect(effects[0]?.effect_count).toBe(1);
      });
    }, 45_000);

    it("permits retry-safe replay but keeps a failed receipt commit ambiguous", async () => {
      await withTestDatabase(async (sql, prefix) => {
        const retryThread = `${prefix}:retry-thread`;
        const retryTurn = `${prefix}:retry-turn`;
        const retryStep = `${prefix}:retry-effect`;
        const crashedRetry = await runWorker(
          "crash-after-effect",
          retryThread,
          retryTurn,
          `${prefix}:retry-run`,
          retryStep,
          "retry-safe",
        );
        expect(crashedRetry.exitCode).toBe(82);
        await forceLeaseExpiry(sql, retryThread, retryTurn);
        const retryFence = await claimInProcess(
          sql,
          retryThread,
          retryTurn,
          `${prefix}:retry-recovery`,
        );
        const retryAdmission = await withExecutionFence(
          retryFence,
          async () => {
            const intent = stepIntent(retryFence, retryStep, "retry-safe");
            const admission = await beginAgentExecutionStep(intent);
            expect(admission).toEqual({
              status: "execute",
              wasDispatched: true,
            });
            await markAgentExecutionStepDispatched(intent);
            await sql`
          INSERT INTO agent_harness_test_effects (effect_id, effect_count)
          VALUES (${retryStep}, 1)
          ON CONFLICT (effect_id) DO UPDATE SET
            effect_count = agent_harness_test_effects.effect_count + 1
        `;
            await completeAgentExecutionStep(
              intent,
              JSON.stringify({ result: "retried", completedSideEffect: true }),
            );
            return admission;
          },
        );
        expect(retryAdmission.status).toBe("execute");
        const retryEffects = await sql`
        SELECT effect_count FROM agent_harness_test_effects WHERE effect_id = ${retryStep}
      `;
        expect(retryEffects[0]?.effect_count).toBe(2);

        const failedThread = `${prefix}:failed-thread`;
        const failedTurn = `${prefix}:failed-turn`;
        const failedStep = `${prefix}:failed-step`;
        const failedFence = await claimInProcess(
          sql,
          failedThread,
          failedTurn,
          `${prefix}:failed-run`,
        );
        const failedIntent = stepIntent(failedFence, failedStep, "never");
        await withExecutionFence(failedFence, async () => {
          await beginAgentExecutionStep(failedIntent);
          await markAgentExecutionStepDispatched(failedIntent);
        });
        await sql`SELECT set_config('agent.harness_fail_step', ${failedStep}, false)`;
        await expect(
          withExecutionFence(failedFence, () =>
            completeAgentExecutionStep(
              failedIntent,
              JSON.stringify({ result: "must not commit" }),
            ),
          ),
        ).rejects.toThrow("test receipt commit rejected");
        await sql`SELECT set_config('agent.harness_fail_step', '', false)`;
        const [uncommitted] = await sql`
        SELECT status FROM agent_execution_steps
        WHERE thread_id = ${failedThread} AND turn_id = ${failedTurn} AND step_id = ${failedStep}
      `;
        expect(uncommitted.status).toBe("dispatched");

        await forceLeaseExpiry(sql, failedThread, failedTurn);
        const failedRecoveryFence = await claimInProcess(
          sql,
          failedThread,
          failedTurn,
          `${prefix}:failed-recovery`,
        );
        const failedAdmission = await withExecutionFence(
          failedRecoveryFence,
          () =>
            beginAgentExecutionStep(
              stepIntent(failedRecoveryFence, failedStep, "never"),
            ),
        );
        expect(failedAdmission).toEqual({ status: "unknown" });
      });
    }, 45_000);
  },
);
