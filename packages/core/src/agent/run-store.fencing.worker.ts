import { writeSync } from "node:fs";

import postgres from "postgres";
import { z } from "zod";

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
import type { AgentEngine, EngineEvent } from "./engine/types.js";
import { withExecutionFence, type ExecutionFence } from "./execution-fence.js";
import type { ActionEntry } from "./production-agent.js";
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
        writeSync(1, JSON.stringify({ status: "unexpected-write" }));
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
        writeSync(
          1,
          JSON.stringify({
            aborted,
            processId: process.pid,
            databaseBackendPid,
          }),
        );
        return;
      }

      if (
        mode === "production-loop-crash" ||
        mode === "production-loop-resume"
      ) {
        const { runAgentLoop } = await import("./production-agent.js");
        const input = JSON.parse(extra ?? "null") as {
          replayPolicy: "never" | "retry-safe";
          providerCallId: string;
          phase?: "before-effect" | "after-effect" | "after-receipt";
        };
        if (
          !input ||
          !["never", "retry-safe"].includes(input.replayPolicy) ||
          !input.providerCallId
        ) {
          throw new Error("Production loop worker options are invalid");
        }
        if (mode === "production-loop-crash") {
          await insertRun(runId, threadId, turnId, {
            dispatchMode: "background",
            dispatchPayload: JSON.stringify({
              threadId,
              turnId,
              prompt: `Apply effect ${stepId}`,
            }),
          });
        }
        const fence = await claimTurnExecutionLease(threadId, turnId, runId);
        const events: unknown[] = [];
        let seq = 0;
        let modelCall = 0;
        const actionName = "test-external-effect";
        const effectAction: ActionEntry = {
          tool: {
            description: "Record a test effect.",
            parameters: {
              type: "object",
              properties: { effectId: { type: "string" } },
              required: ["effectId"],
            },
          },
          schema: z.object({ effectId: z.string() }),
          retrySafe: input.replayPolicy === "retry-safe",
          run: async ({ effectId }: { effectId: string }) => {
            if (
              mode === "production-loop-crash" &&
              input.phase === "before-effect"
            ) {
              writeSync(
                1,
                `${JSON.stringify({ ready: true, stage: "before-effect", fence })}\n`,
              );
              await waitForContinue();
            }
            await sql`
              INSERT INTO agent_harness_test_effects (effect_id, effect_count)
              VALUES (${effectId}, 1)
              ON CONFLICT (effect_id) DO UPDATE SET
                effect_count = agent_harness_test_effects.effect_count + 1
            `;
            if (
              mode === "production-loop-crash" &&
              input.phase === "after-effect"
            ) {
              writeSync(
                1,
                `${JSON.stringify({ ready: true, stage: "after-effect", fence })}\n`,
              );
              await waitForContinue();
            }
            return `Recorded effect ${effectId}`;
          },
        };
        const engine: AgentEngine = {
          name: "fencing-test",
          label: "Fencing test",
          defaultModel: "fencing-test-model",
          supportedModels: ["fencing-test-model"],
          capabilities: {
            thinking: false,
            promptCaching: false,
            vision: false,
            computerUse: false,
            parallelToolCalls: false,
          },
          async *stream(): AsyncIterable<EngineEvent> {
            if (modelCall++ === 0) {
              yield {
                type: "assistant-content",
                parts: [
                  {
                    type: "tool-call",
                    id: input.providerCallId,
                    name: actionName,
                    input: { effectId: stepId },
                  },
                ],
              };
              yield { type: "stop", reason: "tool_use" };
              return;
            }
            yield {
              type: "assistant-content",
              parts: [{ type: "text", text: "Effect handling finished." }],
            };
            yield { type: "stop", reason: "end_turn" };
          },
        };
        await withExecutionFence(fence, () =>
          runAgentLoop({
            engine,
            model: engine.defaultModel,
            systemPrompt: "system",
            tools: [
              {
                name: actionName,
                description: effectAction.tool.description,
                inputSchema: {
                  type: "object",
                  properties: { effectId: { type: "string" } },
                  required: ["effectId"],
                },
              },
            ],
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: `Apply effect ${stepId}` }],
              },
            ],
            actions: { [actionName]: effectAction },
            threadId,
            turnId,
            runId,
            recoverCompletedExecutionSteps: true,
            send: async (event) => {
              if (
                mode === "production-loop-crash" &&
                input.phase === "after-receipt" &&
                event.type === "tool_done"
              ) {
                writeSync(
                  1,
                  `${JSON.stringify({ ready: true, stage: "after-receipt", fence })}\n`,
                );
                await waitForContinue();
              }
              events.push(event);
              await insertRunEvent(runId, seq++, JSON.stringify(event), {
                requireInserted: true,
              });
            },
            signal: new AbortController().signal,
          }),
        );
        writeSync(
          1,
          JSON.stringify({
            status: "completed",
            fence,
            providerCallId: input.providerCallId,
            toolDone: events.find(
              (event) =>
                event &&
                typeof event === "object" &&
                (event as { type?: unknown }).type === "tool_done",
            ),
          }),
        );
        return;
      }

      await insertRun(runId, threadId, turnId);
      const fence = await claimTurnExecutionLease(threadId, turnId, runId);
      if (mode === "claim") {
        writeSync(1, JSON.stringify({ fence }));
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

void main().then(
  () => process.exit(0),
  (error) => {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    writeSync(
      1,
      JSON.stringify({
        error: String(error),
        code,
        processId: process.pid,
        databaseBackendPid,
      }),
    );
    process.exit(code === "turn_execution_lease_busy" ? 3 : 1);
  },
);
