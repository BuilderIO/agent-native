import { writeSync } from "node:fs";

import postgres from "postgres";

import {
  ensureChatThreadTables,
  getThread,
  markQueuedSubmissionSubmitted,
  updateThreadData,
  type QueuedMessage,
  type QueuedSubmissionActor,
} from "../chat-threads/store.js";
import { toPostgresParams, withDbExec, type DbExec } from "../db/client.js";
import { withMigrationRuntime } from "../db/migration-runtime.js";
import { withExecutionFence, type ExecutionFence } from "./execution-fence.js";
import { abortRunAtSafeBoundaryDurably } from "./run-manager.js";
import {
  beginAgentExecutionStep,
  claimTurnExecutionLease,
  completeAgentExecutionStep,
  ensureRunTables,
  insertRun,
  insertRunEvent,
  markAgentExecutionStepDispatched,
  type AgentExecutionStepIntent,
} from "./run-store.js";
import {
  applySubmittedUserMessage,
  buildUserMessage,
  extractThreadMeta,
} from "./thread-data-builder.js";

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

function waitForContinue(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.once("data", () => {
      process.stdin.pause();
      process.stdin.destroy();
      resolve();
    });
    process.stdin.resume();
  });
}

let databaseBackendPid: number | undefined;

async function main(): Promise<void> {
  const databaseUrl = process.env.AGENT_RUN_POSTGRES_TEST_URL; // config-ok: isolated integration-test database selector, not app runtime config
  if (!databaseUrl) throw new Error("AGENT_RUN_POSTGRES_TEST_URL is required");
  const [mode, threadId, turnId, runId, stepId, extra] = process.argv.slice(2);
  if (!mode || !threadId || !turnId || !runId) {
    throw new Error("Expected mode, threadId, turnId, and runId");
  }
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await withDbExec(executor(sql), async () => {
      await withMigrationRuntime(() => ensureRunTables());
      if (mode === "stale-write") {
        const staleFence = JSON.parse(extra ?? "null") as ExecutionFence;
        await withExecutionFence(staleFence, () =>
          insertRunEvent(
            staleFence.runId,
            77,
            JSON.stringify({ type: "text", text: "stale write" }),
            { requireInserted: true },
          ),
        );
        process.stdout.write(JSON.stringify({ status: "unexpected-write" }));
        return;
      }
      if (mode === "queue-submit") {
        await withMigrationRuntime(() => ensureChatThreadTables());
        const input = JSON.parse(extra ?? "null") as {
          message: QueuedMessage;
          claimId: string;
          actor: QueuedSubmissionActor;
        };
        const thread = await getThread(threadId);
        if (!thread)
          throw new Error(`Missing queued-message thread ${threadId}`);
        const userMessage = buildUserMessage({
          text: input.message.text,
          runId,
          queuedMessageId: input.message.id,
        });
        let submissionFailure: string | undefined;
        let pauseBeforeWrite = true;
        const updated = await updateThreadData(
          threadId,
          "{}",
          thread.title,
          thread.preview,
          thread.messageCount,
          {
            transformThreadData: (threadData) => {
              const result = applySubmittedUserMessage(
                JSON.parse(threadData || "{}"),
                userMessage,
                {
                  id: input.message.id,
                  claimId: input.claimId,
                  now: Date.now(),
                },
              );
              if (!("repo" in result)) {
                submissionFailure = result.status;
                return threadData;
              }
              const meta = extractThreadMeta(result.repo);
              return {
                threadData: JSON.stringify(result.repo),
                preview: meta.preview || thread.preview,
              };
            },
            beforeUpdate: async () => {
              if (pauseBeforeWrite) {
                pauseBeforeWrite = false;
                writeSync(1, `${JSON.stringify({ ready: true })}\n`);
                await waitForContinue();
              }
              return !submissionFailure;
            },
            afterUpdate: async (tx) => {
              if (submissionFailure) return;
              await markQueuedSubmissionSubmitted(tx, {
                threadId,
                messageId: input.message.id,
                runId,
                actor: input.actor,
                message: input.message,
              });
            },
          },
        );
        writeSync(
          1,
          JSON.stringify({
            status: submissionFailure ?? "submitted",
            updated,
          }),
        );
        return;
      }

      if (mode === "durable-abort") {
        const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`;
        databaseBackendPid = Number(pid);
        const aborted = await abortRunAtSafeBoundaryDurably(
          runId,
          stepId ?? "user",
        );
        process.stdout.write(
          JSON.stringify({
            aborted,
            processId: process.pid,
            databaseBackendPid,
          }),
        );
        return;
      }

      await insertRun(runId, threadId, turnId);
      const fence = await claimTurnExecutionLease(threadId, turnId, runId);
      if (mode === "claim") {
        process.stdout.write(JSON.stringify({ fence }));
        return;
      }

      const replayPolicy = extra === "retry-safe" ? "retry-safe" : "never";
      const admission = await beginAgentExecutionStep(
        stepIntent(fence, stepId ?? "step-1", replayPolicy),
      );
      if (admission.status !== "execute") {
        throw new Error(`Expected initial execution, got ${admission.status}`);
      }
      if (mode === "wait-stale-write") {
        writeSync(1, `${JSON.stringify({ ready: true, fence })}\n`);
        await waitForContinue();
        await withExecutionFence(fence, () =>
          insertRunEvent(
            runId,
            77,
            JSON.stringify({ type: "text", text: "late live worker write" }),
            { requireInserted: true },
          ),
        );
        writeSync(1, JSON.stringify({ status: "unexpected-write" }));
        return;
      }
      if (mode === "crash-before-dispatch") {
        writeSync(1, JSON.stringify({ fence, admission }));
        process.exit(81);
      }
      if (mode === "dispatch-barrier") {
        await markAgentExecutionStepDispatched(
          stepIntent(fence, stepId ?? "step-1", replayPolicy),
        );
        writeSync(1, `${JSON.stringify({ ready: true, fence, admission })}\n`);
        await waitForContinue();
        await sql`
          INSERT INTO agent_harness_test_effects (effect_id, effect_count)
          VALUES (${stepId}, 1)
          ON CONFLICT (effect_id) DO UPDATE SET
            effect_count = agent_harness_test_effects.effect_count + 1
        `;
        await completeAgentExecutionStep(
          stepIntent(fence, stepId ?? "step-1", replayPolicy),
          JSON.stringify({ result: "completed", completedSideEffect: true }),
        );
        writeSync(1, JSON.stringify({ status: "completed" }));
        return;
      }
      if (mode === "crash-after-effect") {
        await markAgentExecutionStepDispatched(
          stepIntent(fence, stepId ?? "step-1", replayPolicy),
        );
        await sql`
          INSERT INTO agent_harness_test_effects (effect_id, effect_count)
          VALUES (${stepId}, 1)
          ON CONFLICT (effect_id) DO UPDATE SET
            effect_count = agent_harness_test_effects.effect_count + 1
        `;
        writeSync(1, JSON.stringify({ fence, admission }));
        process.exit(82);
      }
      throw new Error(`Unknown worker mode ${mode}`);
    });
  } finally {
    await sql.end({ timeout: 1 });
  }
}

main().catch((error) => {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  process.stdout.write(
    JSON.stringify({
      error: String(error),
      code,
      processId: process.pid,
      databaseBackendPid,
    }),
  );
  process.exitCode = code === "turn_execution_lease_busy" ? 3 : 1;
});
