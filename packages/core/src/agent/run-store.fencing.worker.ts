import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

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
import {
  releaseLiveAgentHarnessSession,
  resolveAgentHarnessApproval,
  sendAgentHarnessFollowUp,
  sweepExpiredAgentHarnessFollowUps,
} from "./harness/lifecycle.js";
import { registerAgentHarness } from "./harness/registry.js";
import {
  claimAgentHarnessSessionFollowUp,
  ensureAgentHarnessSessionTables,
  getAgentHarnessSession,
  listAgentHarnessSessionEvents,
  markAgentHarnessSessionFollowUpDispatched,
  markAgentHarnessSessionStopped,
  persistAgentHarnessApprovalEvent,
  persistAgentHarnessFollowUpEvent,
  startAgentHarnessSessionApprovalDispatch,
  startAgentHarnessSessionExpiryCleanup,
  type AgentHarnessSessionStatus,
} from "./harness/store.js";
import type {
  AgentHarnessAdapter,
  AgentHarnessApproval,
  AgentHarnessEvent,
  AgentHarnessSession,
} from "./harness/types.js";
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
  persistRunCheckpointEvent,
  reapIfStale,
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

async function announceDatabaseBackend(sql: postgres.Sql): Promise<void> {
  const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`;
  writeSync(
    1,
    `${JSON.stringify({ ready: true, databaseBackendPid: Number(pid) })}\n`,
  );
}

let databaseBackendPid: number | undefined;

interface NativeApprovalAck {
  type: "approval-ack";
  sessionId: string;
  id: string;
  approved: boolean;
}

class SubprocessApprovalSession implements AgentHarnessSession {
  readonly id: string;
  readonly child: ChildProcessWithoutNullStreams;
  readonly ready: Promise<void>;
  readonly closed: Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>;
  lastApprovalAck: NativeApprovalAck | undefined;
  exitCode: number | null = null;
  private readonly turnEvent: Promise<AgentHarnessEvent>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private resolveTurnEvent!: (event: AgentHarnessEvent) => void;
  private rejectTurnEvent!: (error: Error) => void;
  private resolveApprovalAck: ((ack: NativeApprovalAck) => void) | undefined;
  private rejectApprovalAck: ((error: Error) => void) | undefined;

  constructor(
    nativeSessionId: string,
    storedSessionId: string,
    private readonly recordTurnStart?: () => Promise<void>,
  ) {
    this.id = storedSessionId;
    const fixturePath = fileURLToPath(
      new URL("./run-store.fencing.native-harness.fixture.ts", import.meta.url),
    );
    this.child = spawn(
      process.execPath,
      ["--import", "tsx", fixturePath, nativeSessionId],
      {
        cwd: process.cwd(),
        env: {},
        stdio: "pipe",
      },
    );
    const lines = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.turnEvent = new Promise<AgentHarnessEvent>((resolve, reject) => {
      this.resolveTurnEvent = resolve;
      this.rejectTurnEvent = reject;
    });
    this.closed = new Promise((resolve) => {
      this.child.once("close", (exitCode, signal) => {
        this.exitCode = exitCode;
        resolve({ exitCode, signal });
      });
    });
    lines.on("line", (line) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        this.rejectReady(new Error("Native harness returned invalid JSON."));
        return;
      }
      if (message.type === "ready" && message.sessionId === nativeSessionId) {
        this.resolveReady();
        return;
      }
      if (
        message.type === "approval-request" &&
        typeof message.id === "string" &&
        typeof message.message === "string"
      ) {
        this.resolveTurnEvent({
          type: "approval-request",
          id: message.id,
          message: message.message,
          ...(typeof message.tool === "string" ? { tool: message.tool } : {}),
        });
        return;
      }
      if (
        message.type === "approval-ack" &&
        typeof message.sessionId === "string" &&
        typeof message.id === "string" &&
        typeof message.approved === "boolean"
      ) {
        const ack = message as unknown as NativeApprovalAck;
        this.lastApprovalAck = ack;
        this.resolveApprovalAck?.(ack);
        this.resolveApprovalAck = undefined;
        this.rejectApprovalAck = undefined;
      }
    });
    this.child.once("error", (error) => {
      this.rejectReady(error);
      this.rejectTurnEvent(error);
      this.rejectApprovalAck?.(error);
    });
    this.child.stderr.resume();
  }

  async *streamTurn(input: {
    prompt?: string;
  }): AsyncGenerator<AgentHarnessEvent> {
    await this.ready;
    await this.recordTurnStart?.();
    this.child.stdin.write(
      `${JSON.stringify({ type: "start-turn", prompt: input.prompt })}\n`,
    );
    yield await this.turnEvent;
  }

  rejectStartup(error: Error): void {
    this.rejectReady(error);
  }

  async approve(approval: AgentHarnessApproval): Promise<void> {
    await this.ready;
    const ack = new Promise<NativeApprovalAck>((resolve, reject) => {
      this.resolveApprovalAck = resolve;
      this.rejectApprovalAck = reject;
    });
    this.child.stdin.write(
      `${JSON.stringify({ type: "approve", ...approval })}\n`,
    );
    const timer = setTimeout(
      () => this.rejectApprovalAck?.(new Error("Native approval timed out.")),
      10_000,
    );
    try {
      const received = await ack;
      if (
        received.id !== approval.id ||
        received.approved !== approval.approved
      ) {
        throw new Error("Native harness acknowledged a different approval.");
      }
    } finally {
      clearTimeout(timer);
      this.resolveApprovalAck = undefined;
      this.rejectApprovalAck = undefined;
    }
  }

  async stop(): Promise<void> {
    this.child.stdin.end();
    const timer = setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null) {
        this.child.kill("SIGKILL");
      }
    }, 2_000);
    timer.unref();
    await this.closed;
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.AGENT_RUN_POSTGRES_TEST_URL; // config-ok: isolated integration-test database selector, not app runtime config
  if (!databaseUrl) throw new Error("AGENT_RUN_POSTGRES_TEST_URL is required");
  const [mode, threadId, turnId, runId, stepId, extra] = process.argv.slice(2);
  if (!mode || !threadId || !turnId || !runId) {
    throw new Error("Expected mode, threadId, turnId, and runId");
  }
  const sql = postgres(databaseUrl, {
    // The follow-up dispatch row lock stays open while run-manager starts on a
    // second connection, matching the production pool's concurrent requests.
    max: mode.startsWith("harness-follow-up-native-approval-") ? 4 : 1,
  });
  try {
    await withDbExec(executor(sql), async () => {
      if (!mode.startsWith("harness-")) {
        await withMigrationRuntime(() => ensureRunTables());
      }
      if (mode === "stale-write") {
        const staleFence = JSON.parse(extra) as ExecutionFence;
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
      if (mode === "harness-approval-rehydrate-subprocess") {
        await withMigrationRuntime(() => ensureAgentHarnessSessionTables());
        const { approvalId, ownerEmail, orgId } = JSON.parse(extra) as {
          approvalId: string;
          ownerEmail: string;
          orgId: string;
        };
        let nativeSession: SubprocessApprovalSession | undefined;
        const adapter: AgentHarnessAdapter = {
          name: "subprocess-approval-test",
          label: "Subprocess approval test",
          description:
            "Exercises approval recovery with a native child process.",
          capabilities: {
            sandbox: false,
            resumable: true,
            approvals: true,
            hostTools: false,
            fileEvents: false,
          },
          async createSession(options) {
            const resumeState = options.resumeState as
              | { sessionId?: unknown }
              | undefined;
            if (typeof resumeState?.sessionId !== "string") {
              throw new Error("A persisted native session id is required.");
            }
            const session = new SubprocessApprovalSession(
              resumeState.sessionId,
              options.sessionId ?? threadId,
            );
            nativeSession = session;
            const readyTimeout = setTimeout(
              () =>
                session.rejectStartup(
                  new Error("Native harness did not start."),
                ),
              10_000,
            );
            try {
              await session.ready;
            } catch (error) {
              await session.stop();
              throw error;
            } finally {
              clearTimeout(readyTimeout);
            }
            return session;
          },
        };
        registerAgentHarness({
          name: adapter.name,
          label: adapter.label,
          description: adapter.description,
          capabilities: adapter.capabilities,
          create: () => adapter,
        });
        let result;
        try {
          result = await resolveAgentHarnessApproval({
            runId,
            approval: { id: approvalId, approved: true },
            scope: { ownerEmail, orgId },
          });
        } finally {
          if (nativeSession) {
            releaseLiveAgentHarnessSession(threadId, nativeSession);
            await nativeSession.stop();
          }
        }
        writeSync(
          1,
          JSON.stringify({
            ok: result.ok,
            errorCode: result.errorCode,
            error: result.error,
            resolvedApprovalIds: result.session?.resolvedApprovalIds ?? [],
            pendingApproval: result.session?.pendingApproval ?? null,
            nativeApprovalAck: nativeSession?.lastApprovalAck,
            nativeExitCode: nativeSession?.exitCode,
          }),
        );
        return;
      }
      if (
        mode === "harness-follow-up-native-approval-crash" ||
        mode === "harness-follow-up-native-approval-recover"
      ) {
        await withMigrationRuntime(async () => {
          await ensureRunTables();
          await ensureAgentHarnessSessionTables();
        });
        const { approvalId, ownerEmail, orgId, effectId } = JSON.parse(
          extra,
        ) as {
          approvalId: string;
          ownerEmail: string;
          orgId: string;
          effectId?: string;
        };
        let nativeSession: SubprocessApprovalSession | undefined;
        const adapter: AgentHarnessAdapter = {
          name: "subprocess-follow-up-approval-test",
          label: "Subprocess follow-up approval test",
          description:
            "Exercises native follow-up approval recovery across worker processes.",
          capabilities: {
            sandbox: false,
            resumable: true,
            approvals: true,
            hostTools: false,
            fileEvents: false,
          },
          async createSession(options) {
            const resumeState = options.resumeState as
              | { sessionId?: unknown }
              | undefined;
            if (typeof resumeState?.sessionId !== "string") {
              throw new Error("A persisted native session id is required.");
            }
            const session = new SubprocessApprovalSession(
              resumeState.sessionId,
              options.sessionId ?? threadId,
              effectId
                ? async () => {
                    await sql`
                      INSERT INTO agent_harness_test_effects (effect_id, effect_count)
                      VALUES (${effectId}, 1)
                      ON CONFLICT (effect_id) DO UPDATE SET
                        effect_count = agent_harness_test_effects.effect_count + 1
                    `;
                  }
                : undefined,
            );
            nativeSession = session;
            const readyTimeout = setTimeout(
              () =>
                session.rejectStartup(
                  new Error("Native harness did not start."),
                ),
              10_000,
            );
            try {
              await session.ready;
            } catch (error) {
              await session.stop();
              throw error;
            } finally {
              clearTimeout(readyTimeout);
            }
            return session;
          },
        };
        registerAgentHarness({
          name: adapter.name,
          label: adapter.label,
          description: adapter.description,
          capabilities: adapter.capabilities,
          create: () => adapter,
        });

        if (mode === "harness-follow-up-native-approval-crash") {
          const [backendPidRow] = await sql`SELECT pg_backend_pid() AS pid`;
          if (!backendPidRow) {
            throw new Error("Postgres did not return a backend pid.");
          }
          const { pid } = backendPidRow;
          const result = await sendAgentHarnessFollowUp({
            runId,
            prompt: "Run the native action and request approval",
            scope: { ownerEmail, orgId },
            onHarnessEvent: async (event) => {
              if (event.type !== "approval-request") return;
              writeSync(
                1,
                `${JSON.stringify({
                  ready: true,
                  nativePid: nativeSession?.child.pid,
                  databaseBackendPid: Number(pid),
                  approvalId: event.id,
                })}\n`,
              );
              await waitForContinue();
            },
          });
          writeSync(1, JSON.stringify({ status: result.session?.status }));
          return;
        }

        const recovery = await sweepExpiredAgentHarnessFollowUps();
        const reconciled = await getAgentHarnessSession(threadId);
        let result;
        try {
          result = await resolveAgentHarnessApproval({
            runId,
            approval: { id: approvalId, approved: true },
            scope: { ownerEmail, orgId },
          });
        } finally {
          if (nativeSession) {
            releaseLiveAgentHarnessSession(threadId, nativeSession);
            await nativeSession.stop();
          }
        }
        const latest = await getAgentHarnessSession(threadId);
        const transcript = await listAgentHarnessSessionEvents(threadId);
        const effectRows = effectId
          ? await sql`
              SELECT effect_count AS "effectCount"
              FROM agent_harness_test_effects WHERE effect_id = ${effectId}
            `
          : [];
        writeSync(
          1,
          JSON.stringify({
            recovered: recovery.recovered,
            reconciledOutcome: reconciled?.followUpOutcome,
            ok: result.ok,
            status: latest?.status,
            followUpOutcome: latest?.followUpOutcome,
            resolvedApprovalIds: latest?.resolvedApprovalIds ?? [],
            pendingApproval: latest?.pendingApproval ?? null,
            nativeApprovalAck: nativeSession?.lastApprovalAck,
            nativeExitCode: nativeSession?.exitCode,
            effectCount: Number(
              (effectRows[0] as { effectCount?: unknown } | undefined)
                ?.effectCount ?? 0,
            ),
            transcript: transcript.map((entry) => entry.event),
          }),
        );
        return;
      }
      if (mode === "queue-submit" || mode === "queue-submit-ack-barrier") {
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
        let pauseBeforeWrite = mode === "queue-submit";
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
        if (mode === "queue-submit-ack-barrier") {
          if (submissionFailure || !updated) {
            throw new Error(
              `Queued submission did not commit before ack barrier: ${submissionFailure ?? "thread update rejected"}`,
            );
          }
          writeSync(1, `${JSON.stringify({ ready: true, committed: true })}\n`);
          await waitForContinue();
        }
        writeSync(
          1,
          JSON.stringify({
            status: submissionFailure ?? "submitted",
            updated,
          }),
        );
        return;
      }

      if (mode === "harness-follow-up-claim") {
        await withMigrationRuntime(() => ensureAgentHarnessSessionTables());
        const { expectedGeneration, claimId } = JSON.parse(extra ?? "null") as {
          expectedGeneration: number;
          claimId: string;
        };
        await announceDatabaseBackend(sql);
        const claimed = await claimAgentHarnessSessionFollowUp(
          threadId,
          Number(expectedGeneration),
          claimId,
          {
            followUpId: claimId,
            prompt: `Follow-up ${claimId}`,
            claimLeaseMs: 60_000,
            deadlineDurationMs: 24 * 60 * 60 * 1_000,
          },
        );
        writeSync(
          1,
          JSON.stringify({
            claimed: Boolean(claimed),
            generation: claimed?.generation,
            status: claimed?.status,
          }),
        );
        return;
      }

      if (mode === "harness-follow-up-crash-after-dispatch") {
        await withMigrationRuntime(() => ensureAgentHarnessSessionTables());
        const input = JSON.parse(extra ?? "null") as {
          expectedGeneration: number;
          claimId: string;
          followUpId: string;
          prompt: string;
          effectId: string;
        };
        const claimed = await claimAgentHarnessSessionFollowUp(
          threadId,
          input.expectedGeneration,
          input.claimId,
          {
            followUpId: input.followUpId,
            prompt: input.prompt,
            claimLeaseMs: 60_000,
            deadlineDurationMs: 24 * 60 * 60 * 1_000,
          },
        );
        if (!claimed) throw new Error("Follow-up claim was not admitted");
        const dispatched = await markAgentHarnessSessionFollowUpDispatched(
          threadId,
          claimed.generation,
          input.claimId,
        );
        if (!dispatched) throw new Error("Follow-up dispatch was not admitted");
        await sql`
          INSERT INTO agent_harness_test_effects (effect_id, effect_count)
          VALUES (${input.effectId}, 1)
          ON CONFLICT (effect_id) DO UPDATE
          SET effect_count = agent_harness_test_effects.effect_count + 1
        `;
        await persistAgentHarnessFollowUpEvent(
          threadId,
          input.followUpId,
          input.claimId,
          { type: "text", text: "External effect completed" },
        );
        const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`;
        writeSync(
          1,
          `${JSON.stringify({ ready: true, databaseBackendPid: Number(pid) })}\n`,
        );
        await waitForContinue();
        return;
      }

      if (mode === "harness-follow-up-stop") {
        await withMigrationRuntime(() => ensureAgentHarnessSessionTables());
        await announceDatabaseBackend(sql);
        const stopped = await markAgentHarnessSessionStopped(
          threadId,
          "stopped",
        );
        writeSync(
          1,
          JSON.stringify({
            status: stopped?.status,
            claimId: stopped?.followUpClaimId,
          }),
        );
        return;
      }

      if (mode === "harness-approval-dispatch") {
        await withMigrationRuntime(() => ensureAgentHarnessSessionTables());
        const { expectedStatus, expectedGeneration, approvalId } = JSON.parse(
          extra ?? "null",
        ) as {
          expectedStatus: AgentHarnessSessionStatus;
          expectedGeneration: number;
          approvalId: string;
        };
        await announceDatabaseBackend(sql);
        const dispatch = await startAgentHarnessSessionApprovalDispatch(
          threadId,
          expectedStatus,
          expectedGeneration,
          approvalId,
          () => {
            writeSync(1, `${JSON.stringify({ providerStarted: true })}\n`);
            return true;
          },
        );
        writeSync(
          1,
          JSON.stringify({
            providerStarted: Boolean(dispatch),
            generation: dispatch?.session.generation,
          }),
        );
        return;
      }

      if (mode === "harness-approval-crash-after-event") {
        await withMigrationRuntime(() => ensureAgentHarnessSessionTables());
        const { approvalId } = JSON.parse(extra ?? "null") as {
          approvalId: string;
        };
        await persistAgentHarnessApprovalEvent(threadId, approvalId, {
          type: "text",
          text: "Approval continuation started",
        });
        await persistAgentHarnessApprovalEvent(threadId, approvalId, {
          type: "tool_start",
          tool: "read_file",
          input: { path: "README.md" },
        });
        await announceDatabaseBackend(sql);
        await waitForContinue();
        return;
      }

      if (mode === "harness-expiry-cleanup") {
        await withMigrationRuntime(() => ensureAgentHarnessSessionTables());
        const { expectedStatus, expectedGeneration } = JSON.parse(
          extra ?? "null",
        ) as {
          expectedStatus: AgentHarnessSessionStatus;
          expectedGeneration: number;
        };
        await announceDatabaseBackend(sql);
        const cleanup = await startAgentHarnessSessionExpiryCleanup(
          threadId,
          expectedStatus,
          expectedGeneration,
          randomUUID(),
          () => {
            writeSync(1, `${JSON.stringify({ cleanupStarted: true })}\n`);
            return true;
          },
        );
        writeSync(
          1,
          JSON.stringify({
            cleanupStarted: Boolean(cleanup),
            generation: cleanup?.session.generation,
          }),
        );
        return;
      }

      if (mode === "checkpoint-crash") {
        const payload = JSON.parse(extra ?? "null") as Record<string, unknown>;
        await insertRun(runId, threadId, turnId, {
          dispatchMode: "background",
          dispatchPayload: JSON.stringify(payload),
        });
        const fence = await claimTurnExecutionLease(threadId, turnId, runId);
        await withExecutionFence(fence, async () => {
          await insertRunEvent(
            runId,
            0,
            JSON.stringify({ type: "text", text: "Completed before timeout" }),
          );
          await persistRunCheckpointEvent(
            runId,
            { type: "auto_continue", reason: "run_timeout" },
            "run_timeout",
          );
        });
        writeSync(1, JSON.stringify({ status: "checkpointed", fence }));
        process.exit(83);
      }

      if (mode === "stale-reap") {
        await withMigrationRuntime(() => ensureChatThreadTables());
        const reaped = await reapIfStale(runId);
        writeSync(1, JSON.stringify({ reaped }));
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
