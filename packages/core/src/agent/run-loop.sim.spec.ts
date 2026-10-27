import * as fc from "fast-check";
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

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { EXECUTION_LEASE_LOST_ABORT_REASON } from "./abort-reasons.js";
import type { AgentEngine, EngineEvent } from "./engine/types.js";
import { withExecutionFence } from "./execution-fence.js";
import type { AgentExecutionStepIntent } from "./run-store.js";
import type { AgentChatEvent } from "./types.js";

const START_MS = Date.UTC(2026, 0, 1);
let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let activeTrace: TraceRecorder | undefined;
let networkCalls = 0;
const injectedFaults = vi.hoisted(() => ({
  afterDispatch: undefined as (() => Promise<void>) | undefined,
  dispatchCommitted: undefined as (() => void) | undefined,
}));

function postgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function virtualizeDatabaseClock(sql: string): string {
  return sql.replaceAll(
    "clock_timestamp()",
    `to_timestamp(${Date.now()} / 1000.0)`,
  );
}

async function executeOn(
  client: {
    exec(sql: string): Promise<unknown>;
    query(
      sql: string,
      args?: unknown[],
    ): Promise<{
      affectedRows?: number;
      rowCount?: number;
      rows: unknown[];
    }>;
  },
  input: string | { sql: string; args?: unknown[] },
) {
  if (typeof input === "string") {
    await client.exec(virtualizeDatabaseClock(input));
    return { rows: [], rowsAffected: 0 };
  }
  const result = await client.query(
    postgresSql(virtualizeDatabaseClock(input.sql)),
    (input.args ?? []).map((value) => value ?? null),
  );
  return {
    rows: result.rows,
    rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
  };
}

function getExecutor(): DbExec {
  const direct: DbExec = {
    execute: (input) => executeOn(pglite.db, input),
  };
  return {
    ...direct,
    transaction: (run) =>
      pglite.db.transaction((tx) =>
        run({ execute: (input) => executeOn(tx, input) }),
      ),
  };
}

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => getExecutor(),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: async () => true,
  ensureIndexExists: async () => true,
  ensureTableExists: async () => true,
}));

vi.mock("./run-store.js", async (importOriginal) => {
  const store = await importOriginal<typeof import("./run-store.js")>();
  return {
    ...store,
    markAgentExecutionStepDispatched: async (
      intent: AgentExecutionStepIntent,
    ) => {
      await store.markAgentExecutionStepDispatched(intent);
      injectedFaults.dispatchCommitted?.();
      await injectedFaults.afterDispatch?.();
    },
  };
});

const {
  beginAgentExecutionStep,
  claimTurnExecutionLease,
  cleanupOldRuns,
  ensureRunTables,
  insertRun,
  lockTaskExecutionLease,
  markAgentExecutionStepDispatched,
  markAgentExecutionStepUnknown,
  resetAgentExecutionStepBeforeInvocation,
  revokeTaskExecutionLease,
  TurnExecutionLeaseBusyError,
  updateRunStatusIfRunning,
} = await import("./run-store.js");

class TraceRecorder {
  private readonly events: string[] = [];

  constructor(
    private readonly startMs: number,
    private readonly onRecord?: (trace: string) => void,
  ) {
    activeTrace = this;
  }

  add(event: string): void {
    this.events.push(`t=${Date.now() - this.startMs}ms ${event}`);
    this.onRecord?.(this.toString());
  }

  toString(): string {
    return this.events.join("\n");
  }
}

function scriptedEngine(trace: TraceRecorder): AgentEngine {
  let call = 0;
  const toolCall: EngineEvent[] = [
    {
      type: "assistant-content",
      parts: [
        {
          type: "tool-call",
          id: "call-1",
          name: "write",
          input: { value: "payload" },
        },
      ],
    },
    { type: "stop", reason: "tool_use" },
  ];
  const finalText: EngineEvent[] = [
    {
      type: "assistant-content",
      parts: [{ type: "text", text: "done" }],
    },
    { type: "stop", reason: "end_turn" },
  ];
  return {
    name: "simulation",
    label: "Simulation",
    defaultModel: "sim-model",
    supportedModels: ["sim-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(): AsyncIterable<EngineEvent> {
      call += 1;
      trace.add(`model request=${call}`);
      for (const event of call === 1 ? toolCall : finalText) yield event;
    },
  };
}

function writeAction(run: () => Promise<string> | string) {
  return {
    tool: {
      description: "Write one simulated effect",
      parameters: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      },
    },
    readOnly: false,
    run: async (_input: unknown) => run(),
  } as import("./production-agent.js").ActionEntry;
}

async function runLoop(input: {
  fence: Awaited<ReturnType<typeof claimTurnExecutionLease>>;
  trace: TraceRecorder;
  action: () => Promise<string> | string;
  signal?: AbortSignal;
}) {
  const { runAgentLoop } = await import("./production-agent.js");
  return withExecutionFence(input.fence, () =>
    runAgentLoop({
      engine: scriptedEngine(input.trace),
      model: "sim-model",
      systemPrompt: "Simulation",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Run the simulated tool." }],
        },
      ],
      actions: { write: writeAction(input.action) },
      send: async (event: AgentChatEvent) => {
        if (event.type === "tool_start" || event.type === "tool_done") {
          input.trace.add(`event ${event.type} tool=${event.tool}`);
        }
      },
      signal: input.signal ?? new AbortController().signal,
      threadId: input.fence.threadId,
      turnId: input.fence.turnId,
      runId: input.fence.runId,
      durableStepIdForToolCall: () => "sim:step-1",
    }),
  );
}

async function createAttempt(input: {
  threadId: string;
  turnId: string;
  runId: string;
  trace: TraceRecorder;
}) {
  await insertRun(input.runId, input.threadId, input.turnId);
  const fence = await claimTurnExecutionLease(
    input.threadId,
    input.turnId,
    input.runId,
  );
  input.trace.add(`lease acquired run=${input.runId} gen=${fence.generation}`);
  return fence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function startManagedLoop(input: {
  runId: string;
  threadId: string;
  trace: TraceRecorder;
  action: () => Promise<string> | string;
  turnId?: string;
}) {
  const { startRun } = await import("./run-manager.js");
  let turnId = input.turnId ?? input.runId;
  const run = startRun(
    input.runId,
    input.threadId,
    async (send, signal) => {
      const { runAgentLoop } = await import("./production-agent.js");
      await runAgentLoop({
        engine: scriptedEngine(input.trace),
        model: "sim-model",
        systemPrompt: "Simulation",
        tools: [],
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Run the simulated tool." }],
          },
        ],
        actions: { write: writeAction(input.action) },
        send,
        signal,
        threadId: input.threadId,
        turnId,
        runId: input.runId,
        durableStepIdForToolCall: () => "sim:step-1",
      });
    },
    undefined,
    {
      executionLease: true,
      softTimeoutMs: 0,
      ...(input.turnId ? { turnId: input.turnId } : {}),
    },
  );
  turnId = run.turnId;
  return run;
}

async function toolStartWasPersisted(runId: string): Promise<boolean> {
  const result = await pglite.db.query(
    "SELECT event_data FROM agent_run_events WHERE run_id = $1",
    [runId],
  );
  return result.rows.some((row) => {
    if (!isRecord(row) || typeof row.event_data !== "string") return false;
    const event: unknown = JSON.parse(row.event_data);
    return isRecord(event) && event.type === "tool_start";
  });
}

interface DeliveryModel {
  deliveryCount: number;
  sideEffectCount: number;
  clockAdvances: number;
}

interface DeliveryReal {
  prefix: string;
  threadId: string;
  turnId: string;
  nextRun: number;
  effects: string[];
  trace: TraceRecorder;
}

class DuplicateDeliveryCommand implements fc.AsyncCommand<
  DeliveryModel,
  DeliveryReal
> {
  check(model: Readonly<DeliveryModel>): boolean {
    return model.deliveryCount < 6;
  }

  async run(model: DeliveryModel, real: DeliveryReal): Promise<void> {
    const runId = `${real.prefix}-run-${real.nextRun}`;
    real.nextRun += 1;
    const fence = await createAttempt({
      threadId: real.threadId,
      turnId: real.turnId,
      runId,
      trace: real.trace,
    });
    real.trace.add(`duplicate delivery run=${runId}`);
    await runLoop({
      fence,
      trace: real.trace,
      action: () => {
        real.effects.push("sim:step-1");
        real.trace.add(`tool sideEffect count=${real.effects.length}`);
        return "saved";
      },
    });
    await withExecutionFence(fence, () =>
      updateRunStatusIfRunning(runId, "completed", {
        terminalReason: "done",
      }),
    );
    model.deliveryCount += 1;
    expect(real.effects).toHaveLength(model.sideEffectCount);
    await assertSingleTurnOwner(real);
  }

  toString(): string {
    return "duplicate-delivery(same-turn,same-step)";
  }
}

class AdvanceVirtualTimeCommand implements fc.AsyncCommand<
  DeliveryModel,
  DeliveryReal
> {
  check(model: Readonly<DeliveryModel>): boolean {
    return model.clockAdvances < 2;
  }

  async run(model: DeliveryModel, real: DeliveryReal): Promise<void> {
    await vi.advanceTimersByTimeAsync(15_001);
    model.clockAdvances += 1;
    real.trace.add("virtual clock advanced 15001ms");
    await assertSingleTurnOwner(real);
  }

  toString(): string {
    return "advance-virtual-clock-past-lease";
  }
}

async function assertSingleTurnOwner(real: DeliveryReal): Promise<void> {
  const result = await pglite.db.query(
    `SELECT owner_run_id FROM agent_execution_leases
     WHERE thread_id = $1 AND turn_id = $2
       AND lease_expires_at > to_timestamp($3 / 1000.0)`,
    [real.threadId, real.turnId, Date.now()],
  );
  expect(result.rows.length).toBeLessThanOrEqual(1);
}

async function assertTurnRows(
  real: DeliveryReal,
  expectedDeliveries: number,
): Promise<void> {
  const result = await pglite.db.query(
    `SELECT id FROM agent_runs WHERE thread_id = $1 AND turn_id = $2`,
    [real.threadId, real.turnId],
  );
  expect(result.rows).toHaveLength(expectedDeliveries);
}

function simulationRunCount(): number {
  const configured = process.env.AGENT_RUN_SIM_SEEDS;
  if (configured === undefined) return 24;
  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("AGENT_RUN_SIM_SEEDS must be a positive integer");
  }
  return parsed;
}

function blockSimulationNetwork(): void {
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL): Promise<Response> => {
      networkCalls += 1;
      activeTrace?.add(`network request refused input=${String(input)}`);
      throw new Error("Unexpected network request in deterministic simulation");
    },
  );
}

beforeAll(async () => {
  pglite = await createTestPglite();
  await ensureRunTables();
}, 30_000);

beforeEach(() => {
  vi.useFakeTimers({ now: START_MS });
  networkCalls = 0;
  blockSimulationNetwork();
});

afterEach(() => {
  const networkFailure =
    networkCalls === 0
      ? undefined
      : `Simulation attempted ${networkCalls} network request(s)\n${activeTrace?.toString() ?? ""}`;
  injectedFaults.afterDispatch = undefined;
  injectedFaults.dispatchCommitted = undefined;
  activeTrace = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (networkFailure) throw new Error(networkFailure);
});

afterAll(async () => {
  vi.useRealTimers();
  await pglite.close();
});

describe("deterministic agent run simulation", () => {
  it("admits exactly one of two concurrent live lease claims", async () => {
    const trace = new TraceRecorder(START_MS);
    const threadId = "sim-claim-race-thread";
    const turnId = "sim-claim-race-turn";
    const runIds = ["sim-claim-race-run-a", "sim-claim-race-run-b"];
    await Promise.all(
      runIds.map((runId) => insertRun(runId, threadId, turnId)),
    );

    const claims = await Promise.allSettled(
      runIds.map((runId) => claimTurnExecutionLease(threadId, turnId, runId)),
    );
    const acquired = claims.filter(
      (
        claim,
      ): claim is PromiseFulfilledResult<
        Awaited<ReturnType<typeof claimTurnExecutionLease>>
      > => claim.status === "fulfilled",
    );
    const rejected = claims.filter(
      (claim): claim is PromiseRejectedResult => claim.status === "rejected",
    );

    expect(acquired).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const winningClaim = acquired[0];
    const losingClaim = rejected[0];
    if (
      !winningClaim ||
      !losingClaim ||
      !(losingClaim.reason instanceof TurnExecutionLeaseBusyError)
    ) {
      throw new Error("Concurrent lease claims did not produce one owner");
    }
    const owner = await pglite.db.query(
      `SELECT owner_run_id FROM agent_execution_leases
       WHERE thread_id = $1 AND turn_id = $2
         AND lease_expires_at > to_timestamp($3 / 1000.0)`,
      [threadId, turnId, Date.now()],
    );
    expect(owner.rows).toHaveLength(1);
    expect(
      isRecord(owner.rows[0]) ? owner.rows[0].owner_run_id : undefined,
    ).toBe(winningClaim.value.runId);

    trace.add("two running attempts claim the same turn concurrently");
    trace.add("lease acquired exactly-one winner gen=1");
    trace.add(`competing claim rejected reason=${losingClaim.reason.code}`);
    expect(trace.toString()).toMatchInlineSnapshot(`
      "t=0ms two running attempts claim the same turn concurrently
      t=0ms lease acquired exactly-one winner gen=1
      t=0ms competing claim rejected reason=turn_execution_lease_busy"
    `);
  });

  it(
    "checks redelivery command sequences against one live lease and one effect",
    async () => {
      let propertyTrace = "";
      let sample = 0;
      const commandArbitraries: fc.Arbitrary<
        fc.AsyncCommand<DeliveryModel, DeliveryReal>
      >[] = [
        fc.constant(new DuplicateDeliveryCommand()),
        fc.constant(new AdvanceVirtualTimeCommand()),
      ];
      try {
        await fc.assert(
          fc.asyncProperty(
            fc.commands(commandArbitraries, { maxCommands: 5 }),
            async (commands) => {
              vi.setSystemTime(START_MS);
              const prefix = `sim-property-${sample}`;
              sample += 1;
              const trace = new TraceRecorder(START_MS, (record) => {
                propertyTrace = record;
              });
              propertyTrace = trace.toString();
              const real: DeliveryReal = {
                prefix,
                threadId: `${prefix}-thread`,
                turnId: `${prefix}-turn`,
                nextRun: 2,
                effects: [],
                trace,
              };
              const firstFence = await createAttempt({
                threadId: real.threadId,
                turnId: real.turnId,
                runId: `${prefix}-run-1`,
                trace,
              });
              await runLoop({
                fence: firstFence,
                trace,
                action: () => {
                  real.effects.push("sim:step-1");
                  trace.add("tool sideEffect count=1");
                  return "saved";
                },
              });
              await withExecutionFence(firstFence, () =>
                updateRunStatusIfRunning(firstFence.runId, "completed", {
                  terminalReason: "done",
                }),
              );
              const model: DeliveryModel = {
                deliveryCount: 1,
                sideEffectCount: 1,
                clockAdvances: 0,
              };
              await fc.asyncModelRun(
                () => ({ model, real }),
                [new DuplicateDeliveryCommand(), ...commands],
              );
              propertyTrace = trace.toString();
              await assertTurnRows(real, model.deliveryCount);
              await assertSingleTurnOwner(real);
              expect(real.effects).toHaveLength(1);
            },
          ),
          { seed: 20261028, numRuns: simulationRunCount() },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}\nLast simulation trace:\n${propertyTrace}`);
      }
    },
    Math.max(60_000, simulationRunCount() * 1_500),
  );

  it("F2 keeps a live turn's dispatched journal through retention pruning", async () => {
    let trace = new TraceRecorder(START_MS);
    let finalTrace = "";
    try {
      await fc.assert(
        fc.asyncProperty(fc.constant("active-turn-prune"), async () => {
          trace = new TraceRecorder(START_MS);
          const threadId = "sim-f2-thread";
          const turnId = "sim-f2-turn";
          const firstRunId = "sim-f2-run-1";
          const secondRunId = "sim-f2-run-2";
          const stepId = "sim-f2-step";
          const effects: string[] = [];

          await insertRun(firstRunId, threadId, turnId);
          const firstFence = await claimTurnExecutionLease(
            threadId,
            turnId,
            firstRunId,
          );
          trace.add(`lease acquired run=${firstRunId} holder=A gen=1`);
          const firstIntent = {
            ...firstFence,
            stepId,
            operationId: stepId,
            toolName: "write",
            inputJson: JSON.stringify({ argumentsHash: "same-input" }),
            replayPolicy: "never" as const,
          };
          await withExecutionFence(firstFence, async () => {
            const admission = await beginAgentExecutionStep(firstIntent);
            expect(admission.status).toBe("execute");
            trace.add(`journal prepared step=${stepId}`);
            await markAgentExecutionStepDispatched(firstIntent);
            trace.add(`journal dispatched step=${stepId}`);
            effects.push(stepId);
            trace.add(`tool sideEffect step=${stepId} count=${effects.length}`);
            await updateRunStatusIfRunning(firstRunId, "aborted", {
              terminalReason: "simulated-process-stop",
            });
            trace.add(`process stopped run=${firstRunId}`);
          });

          await vi.advanceTimersByTimeAsync(1);
          const pruneCutoffMs = Date.now();
          await pglite.db.query(
            `UPDATE agent_execution_steps
             SET updated_at = to_timestamp($1 / 1000.0)
             WHERE thread_id = $2 AND turn_id = $3 AND step_id = $4`,
            [pruneCutoffMs - 1, threadId, turnId, stepId],
          );
          const eligibleStep = await pglite.db.query(
            `SELECT updated_at < to_timestamp($1 / 1000.0) AS eligible
             FROM agent_execution_steps
             WHERE thread_id = $2 AND turn_id = $3 AND step_id = $4`,
            [pruneCutoffMs, threadId, turnId, stepId],
          );
          expect(
            isRecord(eligibleStep.rows[0])
              ? eligibleStep.rows[0].eligible
              : undefined,
          ).toBe(true);
          await cleanupOldRuns(0, 0);
          const prunedRun = await pglite.db.query(
            "SELECT id FROM agent_runs WHERE id = $1",
            [firstRunId],
          );
          const retainedStep = await pglite.db.query(
            `SELECT status FROM agent_execution_steps
             WHERE thread_id = $1 AND turn_id = $2 AND step_id = $3`,
            [threadId, turnId, stepId],
          );
          const retainedLease = await pglite.db.query(
            `SELECT owner_run_id FROM agent_execution_leases
             WHERE thread_id = $1 AND turn_id = $2`,
            [threadId, turnId],
          );
          expect(prunedRun.rows).toHaveLength(0);
          expect(retainedStep.rows).toHaveLength(1);
          expect(retainedLease.rows).toHaveLength(1);
          trace.add(
            "retention prune removed run; retained journal and live lease",
          );

          await vi.advanceTimersByTimeAsync(15_001);
          trace.add("lease expired; recovery may claim the turn");
          await insertRun(secondRunId, threadId, turnId);
          const secondFence = await claimTurnExecutionLease(
            threadId,
            turnId,
            secondRunId,
          );
          trace.add(`lease acquired run=${secondRunId} holder=B gen=2`);
          const secondIntent = { ...firstIntent, ...secondFence };
          await withExecutionFence(secondFence, async () => {
            const admission = await beginAgentExecutionStep(secondIntent);
            if (admission.status === "execute") {
              trace.add(`journal prepared step=${stepId}`);
              await markAgentExecutionStepDispatched(secondIntent);
              effects.push(stepId);
              trace.add(
                `tool sideEffect step=${stepId} count=${effects.length}`,
              );
            } else {
              trace.add(`journal admission status=${admission.status}`);
            }
          });
          finalTrace = trace.toString();
          expect(effects).toHaveLength(1);
          expect(finalTrace).toMatchInlineSnapshot(`
            "t=0ms lease acquired run=sim-f2-run-1 holder=A gen=1
            t=0ms journal prepared step=sim-f2-step
            t=0ms journal dispatched step=sim-f2-step
            t=0ms tool sideEffect step=sim-f2-step count=1
            t=0ms process stopped run=sim-f2-run-1
            t=1ms retention prune removed run; retained journal and live lease
            t=15002ms lease expired; recovery may claim the turn
            t=15002ms lease acquired run=sim-f2-run-2 holder=B gen=2
            t=15002ms journal admission status=unknown"
          `);
        }),
        { seed: 20261026, numRuns: 1 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\nSimulation trace:\n${finalTrace || trace}`);
    }
  });

  it("F2 prunes an aged prepared intent with no dispatch history", async () => {
    const trace = new TraceRecorder(START_MS);
    const threadId = "sim-f2-prepared-thread";
    const turnId = "sim-f2-prepared-turn";
    const runId = "sim-f2-prepared-run";
    const stepId = "sim-f2-prepared-step";
    await insertRun(runId, threadId, turnId);
    const fence = await claimTurnExecutionLease(threadId, turnId, runId);
    trace.add(`lease acquired run=${runId} gen=1`);
    const intent = {
      ...fence,
      stepId,
      operationId: stepId,
      toolName: "write",
      inputJson: JSON.stringify({ argumentsHash: "no-effect" }),
      replayPolicy: "never" as const,
    };
    await withExecutionFence(fence, async () => {
      const admission = await beginAgentExecutionStep(intent);
      expect(admission.status).toBe("execute");
      trace.add(`journal prepared step=${stepId}`);
      await updateRunStatusIfRunning(runId, "aborted", {
        terminalReason: "stopped-before-dispatch",
      });
    });
    trace.add("process stopped before dispatch; no effect can exist");

    await vi.advanceTimersByTimeAsync(15_001);
    const pruneCutoffMs = Date.now();
    await pglite.db.query(
      `UPDATE agent_execution_steps
       SET updated_at = to_timestamp($1 / 1000.0)
       WHERE thread_id = $2 AND turn_id = $3 AND step_id = $4`,
      [pruneCutoffMs - 1, threadId, turnId, stepId],
    );
    await cleanupOldRuns(0, 0);

    const remainingRows = await pglite.db.query(
      `SELECT 'run' AS kind FROM agent_runs WHERE id = $1
       UNION ALL
       SELECT 'step' AS kind FROM agent_execution_steps
       WHERE thread_id = $2 AND turn_id = $3 AND step_id = $4
       UNION ALL
       SELECT 'lease' AS kind FROM agent_execution_leases
       WHERE thread_id = $2 AND turn_id = $3`,
      [runId, threadId, turnId, stepId],
    );
    expect(remainingRows.rows).toHaveLength(0);
    trace.add("retention prune removed run, undispatched journal, and lease");
    expect(trace.toString()).toMatchInlineSnapshot(`
      "t=0ms lease acquired run=sim-f2-prepared-run gen=1
      t=0ms journal prepared step=sim-f2-prepared-step
      t=0ms process stopped before dispatch; no effect can exist
      t=15001ms retention prune removed run, undispatched journal, and lease"
    `);
  });

  it("F2 prunes a never-replay unknown step after its recovery window expires", async () => {
    const trace = new TraceRecorder(START_MS);
    const threadId = "sim-f2-unknown-thread";
    const turnId = "sim-f2-unknown-turn";
    const runId = "sim-f2-unknown-run";
    const stepId = "sim-f2-unknown-step";
    await insertRun(runId, threadId, turnId);
    const fence = await claimTurnExecutionLease(threadId, turnId, runId);
    trace.add(`lease acquired run=${runId} gen=1`);
    const intent = {
      ...fence,
      stepId,
      operationId: stepId,
      toolName: "write",
      inputJson: JSON.stringify({ argumentsHash: "unknown-result" }),
      replayPolicy: "never" as const,
    };
    await withExecutionFence(fence, async () => {
      const admission = await beginAgentExecutionStep(intent);
      expect(admission.status).toBe("execute");
      await markAgentExecutionStepDispatched(intent);
      await markAgentExecutionStepUnknown(intent);
      trace.add(`journal result lost; step=${stepId} status=unknown`);
      await updateRunStatusIfRunning(runId, "aborted", {
        terminalReason: "simulated-result-loss",
      });
    });
    trace.add("run ended with no live worker");

    await pglite.db.query(
      `UPDATE agent_runs
       SET status = 'aborted', completed_at = $1,
           thread_projection_pending = FALSE
       WHERE id = $2`,
      [START_MS - 30_000, runId],
    );
    await pglite.db.query(
      `UPDATE agent_execution_steps SET updated_at = to_timestamp($1 / 1000.0)
       WHERE thread_id = $2 AND turn_id = $3 AND step_id = $4`,
      [START_MS + 10_000, threadId, turnId, stepId],
    );
    await pglite.db.query(
      `UPDATE agent_execution_leases SET updated_at = to_timestamp($1 / 1000.0)
       WHERE thread_id = $2 AND turn_id = $3`,
      [START_MS - 30_000, threadId, turnId],
    );

    await vi.advanceTimersByTimeAsync(15_001);
    await cleanupOldRuns(30_000, 30_000);
    const beforeWindowExpiry = await pglite.db.query(
      `SELECT s.status, l.lease_expires_at <= to_timestamp($1 / 1000.0) AS expired
       FROM agent_execution_steps s
       JOIN agent_execution_leases l USING (thread_id, turn_id)
       WHERE s.thread_id = $2 AND s.turn_id = $3 AND s.step_id = $4`,
      [Date.now(), threadId, turnId, stepId],
    );
    expect(
      isRecord(beforeWindowExpiry.rows[0])
        ? beforeWindowExpiry.rows[0]
        : undefined,
    ).toEqual({
      status: "unknown",
      expired: true,
    });
    const remainingRun = await pglite.db.query(
      "SELECT id FROM agent_runs WHERE id = $1",
      [runId],
    );
    expect(remainingRun.rows).toHaveLength(0);
    trace.add(
      "lease expired; recovery window still retains unknown step and lease",
    );

    await vi.advanceTimersByTimeAsync(30_001);
    await cleanupOldRuns(30_000, 30_000);
    const expiredArtifacts = await pglite.db.query(
      `SELECT 'step' AS kind FROM agent_execution_steps
       WHERE thread_id = $1 AND turn_id = $2
       UNION ALL
       SELECT 'lease' AS kind FROM agent_execution_leases
       WHERE thread_id = $1 AND turn_id = $2`,
      [threadId, turnId],
    );
    expect(expiredArtifacts.rows).toHaveLength(0);
    trace.add("recovery window expired; unknown step and lease were pruned");
    expect(trace.toString()).toMatchInlineSnapshot(`
      "t=0ms lease acquired run=sim-f2-unknown-run gen=1
      t=0ms journal result lost; step=sim-f2-unknown-step status=unknown
      t=0ms run ended with no live worker
      t=15001ms lease expired; recovery window still retains unknown step and lease
      t=45002ms recovery window expired; unknown step and lease were pruned"
    `);
  });

  it("retains an unknown receipt for late recovery during the retention window", async () => {
    const trace = new TraceRecorder(START_MS);
    const effects: string[] = [];
    let signalActionStarted: () => void = () => {};
    let resolveSlowAction: () => void = () => {};
    let signalActionSettled: () => void = () => {};
    const actionStarted = new Promise<void>((resolve) => {
      signalActionStarted = resolve;
    });
    const actionSettled = new Promise<void>((resolve) => {
      signalActionSettled = resolve;
    });
    const threadId = "sim-late-effect-thread";
    const turnId = "sim-late-effect-turn";
    const firstRunId = "sim-late-effect-run-1";
    const firstFence = await createAttempt({
      runId: firstRunId,
      threadId,
      turnId,
      trace,
    });
    const controller = new AbortController();
    const firstLoop = runLoop({
      fence: firstFence,
      trace,
      signal: controller.signal,
      action: () => {
        trace.add("slow tool started");
        signalActionStarted();
        return new Promise<string>((resolve) => {
          resolveSlowAction = () => {
            effects.push("sim:step-1");
            trace.add("late tool sideEffect step=sim:step-1");
            resolve("saved late");
            signalActionSettled();
          };
        });
      },
    }).then(
      () => {
        throw new Error("The revoked run unexpectedly completed its tool call");
      },
      (error: unknown) => {
        trace.add(
          "old loop stopped error=" +
            (error instanceof Error ? error.name : "unknown"),
        );
      },
    );
    await actionStarted;

    const dispatchedStep = await pglite.db.query(
      `SELECT input_json FROM agent_execution_steps
       WHERE thread_id = $1 AND turn_id = $2 AND step_id = $3`,
      [threadId, turnId, "sim:step-1"],
    );
    const dispatchedRow = dispatchedStep.rows[0];
    if (
      !isRecord(dispatchedRow) ||
      typeof dispatchedRow.input_json !== "string"
    ) {
      throw new Error("The dispatched execution step has no input identity");
    }
    const firstIntent: AgentExecutionStepIntent = {
      ...firstFence,
      stepId: "sim:step-1",
      operationId: "sim:step-1",
      toolName: "write",
      inputJson: dispatchedRow.input_json,
      replayPolicy: "never",
    };
    await withExecutionFence(firstFence, () =>
      markAgentExecutionStepUnknown(firstIntent),
    );
    trace.add("action result lost; step=sim:step-1 status=unknown");

    const executor = getExecutor();
    if (!executor.transaction) {
      throw new Error(
        "The late-effect simulation requires transaction support",
      );
    }
    await executor.transaction(async (tx) => {
      await lockTaskExecutionLease(tx, threadId, turnId);
      await revokeTaskExecutionLease(tx, threadId, turnId);
    });
    trace.add("lease revoked while action remains in flight");
    controller.abort(EXECUTION_LEASE_LOST_ABORT_REASON);
    expect(controller.signal.reason).toBe(EXECUTION_LEASE_LOST_ABORT_REASON);
    await firstLoop;
    trace.add(
      "lease lost -> abort reason=" + EXECUTION_LEASE_LOST_ABORT_REASON,
    );

    await pglite.db.query(
      "UPDATE agent_runs SET status = 'aborted', completed_at = $1, thread_projection_pending = FALSE WHERE id = $2",
      [START_MS - 30_000, firstRunId],
    );
    await vi.advanceTimersByTimeAsync(15_001);
    await cleanupOldRuns(30_000, 30_000);

    const retainedReceipt = await pglite.db.query(
      `SELECT status, input_json FROM agent_execution_steps
       WHERE thread_id = $1 AND turn_id = $2 AND step_id = $3`,
      [threadId, turnId, "sim:step-1"],
    );
    const prunedLease = await pglite.db.query(
      `SELECT updated_at, lease_expires_at FROM agent_execution_leases
       WHERE thread_id = $1 AND turn_id = $2`,
      [threadId, turnId],
    );
    expect(retainedReceipt.rows).toHaveLength(1);
    expect(
      isRecord(retainedReceipt.rows[0])
        ? retainedReceipt.rows[0].status
        : undefined,
    ).toBe("unknown");
    expect(prunedLease.rows).toHaveLength(1);
    trace.add("lease expired; recovery window still retains unknown receipt");

    const retainedRow = retainedReceipt.rows[0];
    if (!isRecord(retainedRow) || typeof retainedRow.input_json !== "string") {
      throw new Error("The retained execution receipt has no input identity");
    }

    const secondRunId = "sim-late-effect-run-2";
    await insertRun(secondRunId, threadId, turnId);
    const secondFence = await claimTurnExecutionLease(
      threadId,
      turnId,
      secondRunId,
    );
    trace.add(
      `lease acquired run=${secondRunId} gen=${secondFence.generation}`,
    );
    const secondIntent: AgentExecutionStepIntent = {
      ...secondFence,
      stepId: "sim:step-1",
      operationId: "sim:step-1",
      toolName: "write",
      inputJson: retainedRow.input_json,
      replayPolicy: "never",
    };
    const admission = await withExecutionFence(secondFence, () =>
      beginAgentExecutionStep(secondIntent),
    );
    expect(admission.status).toBe("unknown");
    trace.add("same-turn retry blocked by unknown never-replay receipt");

    resolveSlowAction();
    await actionSettled;
    expect(effects).toEqual(["sim:step-1"]);
    // oracle-change: the recovery window now retains unknown receipts only until its cutoff.
    expect(trace.toString()).toMatchInlineSnapshot(`
      "t=0ms lease acquired run=sim-late-effect-run-1 gen=1
      t=0ms model request=1
      t=0ms event tool_start tool=write
      t=0ms slow tool started
      t=0ms action result lost; step=sim:step-1 status=unknown
      t=0ms lease revoked while action remains in flight
      t=0ms event tool_done tool=write
      t=0ms old loop stopped error=StaleExecutionFenceError
      t=0ms lease lost -> abort reason=execution_lease_lost
      t=15001ms lease expired; recovery window still retains unknown receipt
      t=15001ms lease acquired run=sim-late-effect-run-2 gen=2
      t=15001ms same-turn retry blocked by unknown never-replay receipt
      t=15001ms late tool sideEffect step=sim:step-1"
    `);
  });

  it("prunes a policy-flipped unknown step after its recovery window", async () => {
    const trace = new TraceRecorder(START_MS);
    const threadId = "sim-policy-retention-thread";
    const turnId = "sim-policy-retention-turn";
    const stepId = "sim-policy-retention-step";
    const firstRunId = "sim-policy-retention-run-1";
    const secondRunId = "sim-policy-retention-run-2";

    try {
      await insertRun(firstRunId, threadId, turnId);
      const firstFence = await claimTurnExecutionLease(
        threadId,
        turnId,
        firstRunId,
      );
      trace.add(`lease acquired run=${firstRunId} gen=1`);
      const firstIntent: AgentExecutionStepIntent = {
        ...firstFence,
        stepId,
        operationId: stepId,
        toolName: "write",
        inputJson: JSON.stringify({ argumentsHash: "same-input" }),
        replayPolicy: "retry-safe",
      };
      await withExecutionFence(firstFence, async () => {
        const admission = await beginAgentExecutionStep(firstIntent);
        expect(admission.status).toBe("execute");
        await markAgentExecutionStepDispatched(firstIntent);
        await markAgentExecutionStepUnknown(firstIntent);
        trace.add(
          "retry-safe dispatch became unknown; handler may still finish",
        );
        await updateRunStatusIfRunning(firstRunId, "aborted");
      });

      await vi.advanceTimersByTimeAsync(15_001);
      await insertRun(secondRunId, threadId, turnId);
      const secondFence = await claimTurnExecutionLease(
        threadId,
        turnId,
        secondRunId,
      );
      trace.add(
        `lease acquired run=${secondRunId} gen=${secondFence.generation}`,
      );
      const secondIntent: AgentExecutionStepIntent = {
        ...firstIntent,
        ...secondFence,
        replayPolicy: "never",
      };
      await withExecutionFence(secondFence, async () => {
        const admission = await beginAgentExecutionStep(secondIntent);
        expect(admission.status).toBe("unknown");
        trace.add("never-policy attempt blocked by earlier dispatch");
        await updateRunStatusIfRunning(secondRunId, "aborted");
      });

      const recentReceipt = await pglite.db.query(
        `SELECT status, replay_policy FROM agent_execution_steps
         WHERE thread_id = $1 AND turn_id = $2 AND step_id = $3`,
        [threadId, turnId, stepId],
      );
      expect(recentReceipt.rows).toHaveLength(1);
      const recentRow = recentReceipt.rows[0];
      if (!isRecord(recentRow)) {
        throw new Error(
          "The policy-flipped execution receipt was not readable",
        );
      }
      expect(recentRow.status).toBe("unknown");
      expect(recentRow.replay_policy).toBe("retry-safe");
      trace.add("unknown receipt keeps the original retry-safe policy");

      await vi.advanceTimersByTimeAsync(30_001);
      await pglite.db.query(
        `UPDATE agent_runs
         SET completed_at = $1, thread_projection_pending = FALSE
         WHERE id IN ($2, $3)`,
        [Date.now() - 30_001, firstRunId, secondRunId],
      );
      await cleanupOldRuns(30_000, 30_000);

      const prunedReceipt = await pglite.db.query(
        `SELECT status, replay_policy FROM agent_execution_steps
         WHERE thread_id = $1 AND turn_id = $2 AND step_id = $3`,
        [threadId, turnId, stepId],
      );
      const prunedLease = await pglite.db.query(
        `SELECT owner_run_id FROM agent_execution_leases
         WHERE thread_id = $1 AND turn_id = $2`,
        [threadId, turnId],
      );
      trace.add(
        `retention prune left ${prunedReceipt.rows.length} receipt(s) and ${prunedLease.rows.length} lease(s)`,
      );
      expect(prunedReceipt.rows).toHaveLength(0);
      expect(prunedLease.rows).toHaveLength(0);
      trace.add("recovery window expired; unknown step and lease were pruned");
      // oracle-change: unknown receipts now expire after the configured recovery window.
      expect(trace.toString()).toMatchInlineSnapshot(`
        "t=0ms lease acquired run=sim-policy-retention-run-1 gen=1
        t=0ms retry-safe dispatch became unknown; handler may still finish
        t=15001ms lease acquired run=sim-policy-retention-run-2 gen=2
        t=15001ms never-policy attempt blocked by earlier dispatch
        t=15001ms unknown receipt keeps the original retry-safe policy
        t=45002ms retention prune left 0 receipt(s) and 0 lease(s)
        t=45002ms recovery window expired; unknown step and lease were pruned"
      `);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\nSimulation trace:\n${trace}`);
    }
  });

  describe("F7 post-retention same-turn replay", () => {
    let observation:
      | {
          admissionStatus: string;
          effects: string[];
          prunedKinds: string[];
          trace: string;
        }
      | undefined;
    let observedEffects: string[] = [];

    beforeAll(async () => {
      vi.useFakeTimers({ now: START_MS });
      networkCalls = 0;
      blockSimulationNetwork();
      const trace = new TraceRecorder(START_MS);
      const effects: string[] = [];
      const threadId = "sim-expired-turn-thread";
      const turnId = "sim-expired-turn-turn";
      const stepId = "sim-expired-turn-step";
      const firstRunId = "sim-expired-turn-run-1";
      const secondRunId = "sim-expired-turn-run-2";

      try {
        const firstFence = await createAttempt({
          runId: firstRunId,
          threadId,
          turnId,
          trace,
        });
        const retrySafeIntent: AgentExecutionStepIntent = {
          ...firstFence,
          stepId,
          operationId: stepId,
          toolName: "write",
          inputJson: JSON.stringify({ argumentsHash: "same-input" }),
          replayPolicy: "retry-safe",
        };
        await withExecutionFence(firstFence, async () => {
          const admission = await beginAgentExecutionStep(retrySafeIntent);
          if (admission.status !== "execute") {
            throw new Error(
              `Expected initial F7 step to execute, got ${admission.status}`,
            );
          }
          await markAgentExecutionStepDispatched(retrySafeIntent);
          await markAgentExecutionStepUnknown(retrySafeIntent);
          await updateRunStatusIfRunning(firstRunId, "aborted");
        });
        trace.add(
          "retry-safe handler remains in flight with an unknown result",
        );

        const oldTime = Date.now() - 1;
        await pglite.db.query(
          `UPDATE agent_runs
           SET completed_at = $1, thread_projection_pending = FALSE
           WHERE id = $2`,
          [oldTime, firstRunId],
        );
        await pglite.db.query(
          `UPDATE agent_execution_steps SET updated_at = to_timestamp($1 / 1000.0)
           WHERE thread_id = $2 AND turn_id = $3 AND step_id = $4`,
          [oldTime, threadId, turnId, stepId],
        );
        await pglite.db.query(
          `UPDATE agent_execution_leases
           SET updated_at = to_timestamp($1 / 1000.0),
               lease_expires_at = to_timestamp($1 / 1000.0)
           WHERE thread_id = $2 AND turn_id = $3`,
          [oldTime, threadId, turnId],
        );
        await vi.advanceTimersByTimeAsync(1);
        await cleanupOldRuns(0, 0);
        const prunedRows = await pglite.db.query(
          `SELECT 'run' AS kind FROM agent_runs WHERE id = $1
           UNION ALL
           SELECT 'step' AS kind FROM agent_execution_steps
           WHERE thread_id = $2 AND turn_id = $3 AND step_id = $4
           UNION ALL
           SELECT 'lease' AS kind FROM agent_execution_leases
           WHERE thread_id = $2 AND turn_id = $3`,
          [firstRunId, threadId, turnId, stepId],
        );
        trace.add("retention removed the run, unknown step, and expired lease");

        await insertRun(secondRunId, threadId, turnId);
        const secondFence = await claimTurnExecutionLease(
          threadId,
          turnId,
          secondRunId,
        );
        trace.add(`same turn id re-entered run=${secondRunId} gen=1`);
        const neverIntent: AgentExecutionStepIntent = {
          ...retrySafeIntent,
          ...secondFence,
          replayPolicy: "never",
        };
        const admission = await withExecutionFence(secondFence, () =>
          beginAgentExecutionStep(neverIntent),
        );
        if (admission.status === "execute") {
          await withExecutionFence(secondFence, () =>
            markAgentExecutionStepDispatched(neverIntent),
          );
          effects.push(stepId);
          trace.add(`new never step sideEffect step=${stepId}`);
        }
        effects.push(stepId);
        trace.add(`late first handler sideEffect step=${stepId}`);
        observedEffects = effects;
        observation = {
          admissionStatus: admission.status,
          effects,
          prunedKinds: prunedRows.rows.map((row) => {
            if (!isRecord(row) || typeof row.kind !== "string") {
              throw new Error("The F7 prune result was not readable");
            }
            return row.kind;
          }),
          trace: trace.toString(),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}\nSimulation trace:\n${trace}`);
      }
    }, 30_000);

    it("reproduces same-turn replay after retention prunes its journal", () => {
      const result = observation;
      if (!result) throw new Error("F7 simulation scenario did not run");
      expect(result.prunedKinds).toEqual([]);
      expect(result.admissionStatus).toBe("execute");
      expect(result.effects).toHaveLength(2);
      // oracle-change: retention expiry needs a product rule for same-turn request replay.
      expect(result.trace).toMatchInlineSnapshot(`
        "t=0ms lease acquired run=sim-expired-turn-run-1 gen=1
        t=0ms retry-safe handler remains in flight with an unknown result
        t=1ms retention removed the run, unknown step, and expired lease
        t=1ms same turn id re-entered run=sim-expired-turn-run-2 gen=1
        t=1ms new never step sideEffect step=sim-expired-turn-step
        t=1ms late first handler sideEffect step=sim-expired-turn-step"
      `);
    });

    // oracle finding: a reused expired turn id can execute a pruned step while its prior effect is pending.
    // oracle-change: retention expiry needs a product rule for same-turn request replay.
    it.fails("an expired same-turn replay preserves at-most-once effects", () => {
      expect(observedEffects).toHaveLength(1);
    });
  });

  it("F3 remembers dispatch across retry-safe adoption and a policy flip", async () => {
    let trace = new TraceRecorder(START_MS);
    let finalTrace = "";
    try {
      await fc.assert(
        fc.asyncProperty(fc.constant("policy-flip"), async () => {
          trace = new TraceRecorder(START_MS);
          const threadId = "sim-f3-thread";
          const turnId = "sim-f3-turn";
          const stepId = "sim-f3-step";
          const effects: string[] = [];
          const originalIntent = {
            threadId,
            turnId,
            stepId,
            operationId: stepId,
            toolName: "send",
            inputJson: JSON.stringify({ argumentsHash: "same-input" }),
            replayPolicy: "retry-safe" as const,
          };

          await insertRun("sim-f3-run-1", threadId, turnId);
          const firstFence = await claimTurnExecutionLease(
            threadId,
            turnId,
            "sim-f3-run-1",
          );
          trace.add("lease acquired run=sim-f3-run-1 holder=A gen=1");
          const firstIntent = { ...originalIntent, ...firstFence };
          await withExecutionFence(firstFence, async () => {
            await beginAgentExecutionStep(firstIntent);
            await markAgentExecutionStepDispatched(firstIntent);
            effects.push(stepId);
            trace.add(`tool sideEffect step=${stepId} count=${effects.length}`);
            await updateRunStatusIfRunning("sim-f3-run-1", "aborted");
          });

          await insertRun("sim-f3-run-2", threadId, turnId);
          const secondFence = await claimTurnExecutionLease(
            threadId,
            turnId,
            "sim-f3-run-2",
          );
          trace.add("lease acquired run=sim-f3-run-2 holder=B gen=2");
          const secondIntent = { ...originalIntent, ...secondFence };
          await withExecutionFence(secondFence, async () => {
            const admission = await beginAgentExecutionStep(secondIntent);
            expect(admission).toEqual({
              status: "execute",
              wasDispatched: true,
            });
            trace.add("journal adopted status=prepared dispatched_at=present");
            await markAgentExecutionStepDispatched(secondIntent);
            trace.add("journal redispatched before invocation");
            await resetAgentExecutionStepBeforeInvocation(secondIntent, {
              preserveDispatchHistory: admission.wasDispatched,
            });
            trace.add(
              "journal reset before invocation; prior dispatch retained",
            );
            await updateRunStatusIfRunning("sim-f3-run-2", "aborted");
          });

          await insertRun("sim-f3-run-3", threadId, turnId);
          const thirdFence = await claimTurnExecutionLease(
            threadId,
            turnId,
            "sim-f3-run-3",
          );
          trace.add("lease acquired run=sim-f3-run-3 holder=C gen=3");
          const thirdIntent = {
            ...originalIntent,
            ...thirdFence,
            replayPolicy: "never" as const,
          };
          await withExecutionFence(thirdFence, async () => {
            const admission = await beginAgentExecutionStep(thirdIntent);
            if (admission.status === "execute") {
              await markAgentExecutionStepDispatched(thirdIntent);
              effects.push(stepId);
              trace.add(
                `tool sideEffect step=${stepId} count=${effects.length}`,
              );
            } else {
              trace.add(`journal admission status=${admission.status}`);
            }
          });
          finalTrace = trace.toString();
          expect(effects).toHaveLength(1);
          expect(finalTrace).toMatchInlineSnapshot(`
            "t=0ms lease acquired run=sim-f3-run-1 holder=A gen=1
            t=0ms tool sideEffect step=sim-f3-step count=1
            t=0ms lease acquired run=sim-f3-run-2 holder=B gen=2
            t=0ms journal adopted status=prepared dispatched_at=present
            t=0ms journal redispatched before invocation
            t=0ms journal reset before invocation; prior dispatch retained
            t=0ms lease acquired run=sim-f3-run-3 holder=C gen=3
            t=0ms journal admission status=unknown"
          `);
        }),
        { seed: 20261027, numRuns: 1 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\nSimulation trace:\n${finalTrace || trace}`);
    }
  });

  it("normal turn commits one tool effect and completes its journal", async () => {
    const trace = new TraceRecorder(START_MS);
    const effects: string[] = [];
    const fence = await createAttempt({
      threadId: "sim-normal-thread",
      turnId: "sim-normal-turn",
      runId: "sim-normal-run",
      trace,
    });

    await runLoop({
      fence,
      trace,
      action: () => {
        effects.push("sim:step-1");
        trace.add("tool sideEffect step=sim:step-1");
        return "saved";
      },
    });
    await withExecutionFence(fence, () =>
      updateRunStatusIfRunning(fence.runId, "completed", {
        terminalReason: "done",
      }),
    );

    expect(effects).toHaveLength(1);
    expect(trace.toString()).toMatchInlineSnapshot(`
      "t=0ms lease acquired run=sim-normal-run gen=1
      t=0ms model request=1
      t=0ms event tool_start tool=write
      t=0ms tool sideEffect step=sim:step-1
      t=0ms event tool_done tool=write
      t=0ms model request=2"
    `);
  });

  it("aborts a slow in-flight tool with the shared lease-loss reason", async () => {
    const trace = new TraceRecorder(START_MS);
    const effects: string[] = [];
    let signalActionStarted: () => void = () => {};
    let resolveSlowAction: () => void = () => {};
    let signalActionSettled: () => void = () => {};
    const actionStarted = new Promise<void>((resolve) => {
      signalActionStarted = resolve;
    });
    const actionSettled = new Promise<void>((resolve) => {
      signalActionSettled = resolve;
    });
    const run = await startManagedLoop({
      runId: "sim-lease-loss-run",
      threadId: "sim-lease-loss-thread",
      trace,
      action: () => {
        trace.add("slow tool started");
        signalActionStarted();
        return new Promise<string>((resolve) => {
          resolveSlowAction = () => {
            effects.push("sim:step-1");
            trace.add("tool sideEffect after lease loss");
            resolve("saved late");
            signalActionSettled();
          };
        });
      },
    });
    await actionStarted;
    await run.waitForPersistence?.();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await run.livenessReady).toBe(true);
    trace.add("lease heartbeat confirmed");

    const executor = getExecutor();
    if (!executor.transaction) {
      throw new Error("The lease-loss simulation requires transaction support");
    }
    await executor.transaction(async (tx) => {
      await lockTaskExecutionLease(tx, run.threadId, run.turnId);
      await revokeTaskExecutionLease(tx, run.threadId, run.turnId);
    });
    trace.add("lease revoked by competing worker");
    await vi.advanceTimersByTimeAsync(1_500);
    await run.finalized;
    expect(run.abortReason).toBe(EXECUTION_LEASE_LOST_ABORT_REASON);
    trace.add(`lease lost -> abort reason=${run.abortReason}`);

    resolveSlowAction();
    await actionSettled;
    expect(effects).toHaveLength(1);
    expect(trace.toString()).toMatchInlineSnapshot(`
      "t=0ms model request=1
      t=0ms slow tool started
      t=1500ms lease heartbeat confirmed
      t=1500ms lease revoked by competing worker
      t=3000ms lease lost -> abort reason=execution_lease_lost
      t=3000ms tool sideEffect after lease loss"
    `);
  });

  it("crashes after the dispatch journal commits and before the effect", async () => {
    const trace = new TraceRecorder(START_MS);
    let signalDispatchCommitted: () => void = () => {};
    const dispatchCommitted = new Promise<void>((resolve) => {
      signalDispatchCommitted = resolve;
    });
    const effects: string[] = [];
    const fence = await createAttempt({
      threadId: "sim-crash-thread",
      turnId: "sim-crash-turn",
      runId: "sim-crash-run-1",
      trace,
    });
    injectedFaults.dispatchCommitted = () => {
      trace.add("journal dispatched step=sim:step-1");
      signalDispatchCommitted();
    };
    injectedFaults.afterDispatch = () => new Promise<never>(() => {});

    void runLoop({
      fence,
      trace,
      action: () => {
        effects.push("sim:step-1");
        trace.add("tool sideEffect step=sim:step-1");
        return "saved";
      },
    }).catch((error: unknown) => {
      trace.add(
        `old process rejected error=${error instanceof Error ? error.name : "unknown"}`,
      );
    });
    await dispatchCommitted;
    injectedFaults.dispatchCommitted = undefined;
    trace.add("process crash after journal commit");

    expect(effects).toHaveLength(0);
    expect(trace.toString()).toMatchInlineSnapshot(`
      "t=0ms lease acquired run=sim-crash-run-1 gen=1
      t=0ms model request=1
      t=0ms event tool_start tool=write
      t=0ms journal dispatched step=sim:step-1
      t=0ms process crash after journal commit"
    `);
  });

  it("restarts after a dispatched crash without repeating the step", async () => {
    const trace = new TraceRecorder(START_MS);
    let signalDispatchCommitted: () => void = () => {};
    const dispatchCommitted = new Promise<void>((resolve) => {
      signalDispatchCommitted = resolve;
    });
    const effects: string[] = [];
    const threadId = "sim-restart-thread";
    const turnId = "sim-restart-turn";
    const firstFence = await createAttempt({
      threadId,
      turnId,
      runId: "sim-restart-run-1",
      trace,
    });
    injectedFaults.dispatchCommitted = () => {
      trace.add("journal dispatched step=sim:step-1");
      signalDispatchCommitted();
    };
    injectedFaults.afterDispatch = () => new Promise<never>(() => {});
    void runLoop({
      fence: firstFence,
      trace,
      action: () => {
        effects.push("sim:step-1");
        trace.add("tool sideEffect step=sim:step-1");
        return "saved";
      },
    }).catch((error: unknown) => {
      trace.add(
        `old process rejected error=${error instanceof Error ? error.name : "unknown"}`,
      );
    });
    await dispatchCommitted;
    injectedFaults.dispatchCommitted = undefined;
    trace.add("process crash after journal commit");
    injectedFaults.afterDispatch = undefined;

    await vi.advanceTimersByTimeAsync(15_001);
    trace.add("process restart after lease expiry");
    const secondFence = await createAttempt({
      threadId,
      turnId,
      runId: "sim-restart-run-2",
      trace,
    });
    await runLoop({
      fence: secondFence,
      trace,
      action: () => {
        effects.push("sim:step-1");
        trace.add("tool sideEffect step=sim:step-1");
        return "saved";
      },
    });
    await withExecutionFence(secondFence, () =>
      updateRunStatusIfRunning(secondFence.runId, "completed", {
        terminalReason: "done",
      }),
    );

    expect(effects).toHaveLength(0);
    expect(trace.toString()).toMatchInlineSnapshot(`
      "t=0ms lease acquired run=sim-restart-run-1 gen=1
      t=0ms model request=1
      t=0ms event tool_start tool=write
      t=0ms journal dispatched step=sim:step-1
      t=0ms process crash after journal commit
      t=15001ms process restart after lease expiry
      t=15001ms lease acquired run=sim-restart-run-2 gen=2
      t=15001ms model request=1
      t=15001ms event tool_start tool=write
      t=15001ms event tool_done tool=write"
    `);
  });

  describe("F5 task retry turn identity", () => {
    let result:
      | { effects: string[]; turnIds: string[]; trace: string }
      | undefined;

    beforeAll(async () => {
      vi.useFakeTimers({ now: START_MS });
      networkCalls = 0;
      blockSimulationNetwork();
      const trace = new TraceRecorder(START_MS);
      const effects: string[] = [];
      const first = await startManagedLoop({
        runId: "sim-f5-run-1",
        threadId: "sim-f5-thread",
        trace,
        action: () => {
          effects.push("sim:step-1");
          trace.add(`task sideEffect attempt=1 count=${effects.length}`);
          return "saved";
        },
      });
      await first.finalized;
      trace.add(`attempt=1 turn=${first.turnId}`);
      const second = await startManagedLoop({
        runId: "sim-f5-run-2",
        threadId: "sim-f5-thread",
        trace,
        action: () => {
          effects.push("sim:step-1");
          trace.add(`task sideEffect attempt=2 count=${effects.length}`);
          return "saved";
        },
      });
      await second.finalized;
      trace.add(`attempt=2 turn=${second.turnId}`);
      result = {
        effects,
        turnIds: [first.turnId, second.turnId],
        trace: trace.toString(),
      };
    }, 30_000);

    it("records current task retry behavior", () => {
      const scenario = result;
      if (!scenario) throw new Error("F5 scenario did not run");
      expect(scenario.turnIds[0]).not.toBe(scenario.turnIds[1]);
      expect(scenario.trace).toMatchInlineSnapshot(`
        "t=0ms model request=1
        t=0ms task sideEffect attempt=1 count=1
        t=0ms model request=2
        t=0ms attempt=1 turn=sim-f5-run-1
        t=0ms model request=1
        t=0ms task sideEffect attempt=2 count=2
        t=0ms model request=2
        t=0ms attempt=2 turn=sim-f5-run-2"
      `);
    });

    // oracle finding: integration retries receive distinct logical turns and repeat the simulated effect.
    // oracle-change: Integration task retries need a product contract for logical-turn identity.
    it.fails("task retries should share one logical turn", () => {
      if (!result) return;
      expect(result.effects).toHaveLength(1);
    });
  });

  it("F6 persists tool_start before a write action begins", async () => {
    const trace = new TraceRecorder(START_MS);
    let sawPersistedStart = false;
    const run = await startManagedLoop({
      runId: "sim-f6-run",
      threadId: "sim-f6-thread",
      trace,
      action: async () => {
        sawPersistedStart = await toolStartWasPersisted("sim-f6-run");
        trace.add(
          sawPersistedStart
            ? "tool_start persisted before sideEffect"
            : "tool_start missing before sideEffect",
        );
        return "saved";
      },
    });
    await run.finalized;

    expect(sawPersistedStart).toBe(true);
    expect(trace.toString()).toMatchInlineSnapshot(`
      "t=0ms model request=1
      t=0ms tool_start persisted before sideEffect
      t=0ms model request=2"
    `);
  });
});
