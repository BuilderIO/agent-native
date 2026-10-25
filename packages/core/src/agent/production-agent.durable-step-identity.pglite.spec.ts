import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
  EngineMessage,
} from "./engine/types.js";
import { withExecutionFence } from "./execution-fence.js";
import type { AgentChatEvent } from "./types.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: (): DbExec => ({
    async execute(input) {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await pglite.query(input.sql, input.args ?? []);
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? 0,
      };
    },
    transaction: (fn) => pglite.transaction(fn),
  }),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: async () => true,
  ensureIndexExists: async () => true,
  ensureTableExists: async () => true,
}));

const { claimTurnExecutionLease, ensureRunTables, insertRun, insertRunEvents } =
  await import("./run-store.js");
const { AGENT_INTERNAL_CONTINUE_PROMPT, runAgentLoop } =
  await import("./production-agent.js");

beforeAll(async () => {
  pglite = await createTestPglite();
  await ensureRunTables();
});

afterAll(async () => {
  await pglite?.close();
});

const request: EngineMessage = {
  role: "user",
  content: [{ type: "text", text: "Create a deck." }],
};
const continuePrompt: EngineMessage = {
  role: "user",
  content: [
    {
      type: "text",
      text: `${AGENT_INTERNAL_CONTINUE_PROMPT}\n\nInternal note: The previous stream ended before the agent sent a final completion signal.`,
    },
  ],
};

function engineFor(turns: EngineContentPart[][]): AgentEngine {
  let streamCall = 0;
  return {
    name: "test",
    label: "Test",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(): AsyncIterable<EngineEvent> {
      const parts = turns[streamCall++] ?? [
        { type: "text", text: "(script exhausted)" },
      ];
      yield { type: "assistant-content", parts };
      yield {
        type: "stop",
        reason: parts.some((part) => part.type === "tool-call")
          ? "tool_use"
          : "end_turn",
      };
    },
  };
}

async function runCreateDecks(opts: {
  threadId: string;
  turnId: string;
  runId: string;
  titles: (string | { title: string; theme?: string })[];
  messages: EngineMessage[];
  internalContinuation?: boolean;
  retrySafe?: boolean;
  run: (args: { title: string }) => Promise<string>;
}): Promise<AgentChatEvent[]> {
  await insertRun(opts.runId, opts.threadId, opts.turnId);
  // The previous run's lease is gone, as it is after a crash or checkpoint.
  await pglite.query(
    `UPDATE agent_execution_leases
        SET lease_expires_at = clock_timestamp() - INTERVAL '1 millisecond'
      WHERE thread_id = ? AND turn_id = ?`,
    [opts.threadId, opts.turnId],
  );
  const fence = await claimTurnExecutionLease(
    opts.threadId,
    opts.turnId,
    opts.runId,
  );
  const events: AgentChatEvent[] = [];
  await withExecutionFence(fence, () =>
    runAgentLoop({
      engine: engineFor([
        opts.titles.map((title, index) => ({
          type: "tool-call" as const,
          id: `${opts.runId}-call-${index}`,
          name: "create-deck",
          input: typeof title === "string" ? { title } : title,
        })),
        [{ type: "text", text: "The deck is ready." }],
      ]),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: opts.messages,
      actions: {
        "create-deck": {
          tool: {
            description: "Create a deck",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string" },
                theme: { type: "string" },
              },
              required: ["title"],
            },
          },
          readOnly: false,
          retrySafe: opts.retrySafe ?? true,
          run: opts.run,
        },
      },
      threadId: opts.threadId,
      turnId: opts.turnId,
      ...(opts.internalContinuation ? { internalContinuation: true } : {}),
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    }),
  );
  return events;
}

/**
 * Rewrites a prior run's step as the release before call-derived IDs left it:
 * under the slot-only ID, with the ledger holding its start and, when asked,
 * its result.
 */
async function recordUnderSlotOnlyId(opts: {
  threadId: string;
  priorRunId: string;
  priorEvents: AgentChatEvent[];
  slot: number;
  dispatchedOnly?: boolean;
  withResult?: boolean;
}): Promise<string> {
  const priorStart = opts.priorEvents.find(
    (event) =>
      event.type === "tool_start" &&
      event.id === `${opts.priorRunId}-call-${opts.slot}`,
  );
  if (priorStart?.type !== "tool_start" || !priorStart.executionStepId) {
    throw new Error("The prior run did not start a durable step");
  }
  const checkpoint = createHash("sha256")
    .update(JSON.stringify([request]))
    .digest("hex");
  const slotOnlyStepId = `model-step:${createHash("sha256")
    .update(`${checkpoint}:${opts.slot}`)
    .digest("hex")}`;
  await pglite.query(
    `UPDATE agent_execution_steps
        SET step_id = ?, operation_id = ?${
          opts.dispatchedOnly
            ? ", status = 'dispatched', result_json = NULL, error_json = NULL"
            : ""
        }
      WHERE thread_id = ? AND step_id = ?`,
    [slotOnlyStepId, slotOnlyStepId, opts.threadId, priorStart.executionStepId],
  );
  const priorDone = opts.priorEvents.find(
    (event) => event.type === "tool_done" && event.id === priorStart.id,
  );
  if (opts.withResult && !priorDone) {
    throw new Error("The prior run did not finish its durable step");
  }
  await insertRunEvents(opts.priorRunId, [
    {
      seq: opts.slot * 2,
      eventAt: Date.now(),
      eventData: JSON.stringify({
        ...priorStart,
        executionStepId: slotOnlyStepId,
      }),
    },
    ...(opts.withResult && priorDone
      ? [
          {
            seq: opts.slot * 2 + 1,
            eventAt: Date.now(),
            eventData: JSON.stringify({
              ...priorDone,
              executionStepId: slotOnlyStepId,
            }),
          },
        ]
      : []),
  ]);
  return slotOnlyStepId;
}

async function stepRows(threadId: string) {
  const { rows } = await pglite.query(
    `SELECT step_id, tool_name, input_json, status
       FROM agent_execution_steps
      WHERE thread_id = ?
      ORDER BY created_at`,
    [threadId],
  );
  return rows as {
    step_id: string;
    tool_name: string;
    input_json: string;
    status: string;
  }[];
}

describe("durable execution step identity", () => {
  it("runs a different call when a continuation resumes from the same checkpoint", async () => {
    const threadId = "thread-resume-different-call";
    const turnId = "turn-resume-different-call";
    const run = vi.fn(async ({ title }: { title: string }) => `Saved ${title}`);

    await runCreateDecks({
      threadId,
      turnId,
      runId: "run-before-interruption",
      titles: ["Q3 plan"],
      messages: [request],
      run,
    });
    // The interrupted run's tool call never reached history, so the
    // continuation asks the model again from the same checkpoint.
    const events = await runCreateDecks({
      threadId,
      turnId,
      runId: "run-after-interruption",
      titles: ["Q3 planning deck"],
      messages: [request, continuePrompt],
      internalContinuation: true,
      run,
    });

    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "error" }),
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Q3 planning deck" }),
      expect.anything(),
    );
    const rows = await stepRows(threadId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.step_id)).size).toBe(2);
    expect(rows.every((row) => row.status === "completed")).toBe(true);
  });

  it("replays the same call when a continuation resumes from the same checkpoint", async () => {
    const threadId = "thread-resume-same-call";
    const turnId = "turn-resume-same-call";
    const run = vi.fn(async ({ title }: { title: string }) => `Saved ${title}`);

    await runCreateDecks({
      threadId,
      turnId,
      runId: "run-before-replay",
      titles: ["Q3 plan"],
      messages: [request],
      run,
    });
    const events = await runCreateDecks({
      threadId,
      turnId,
      runId: "run-after-replay",
      titles: ["Q3 plan"],
      messages: [request, continuePrompt],
      internalContinuation: true,
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "run-after-replay-call-0",
        result: expect.stringContaining("Saved Q3 plan"),
      }),
    );
    expect(await stepRows(threadId)).toHaveLength(1);
  });

  it("replays the same call when a continuation moves it to another slot", async () => {
    const threadId = "thread-resume-moved-call";
    const turnId = "turn-resume-moved-call";
    const run = vi.fn(async ({ title }: { title: string }) => `Saved ${title}`);

    await runCreateDecks({
      threadId,
      turnId,
      runId: "run-before-move",
      titles: ["Q3 plan", "Q3 plan"],
      messages: [request],
      run,
    });
    const events = await runCreateDecks({
      threadId,
      turnId,
      runId: "run-after-move",
      titles: ["Q4 plan", "Q3 plan", "Q3 plan", "Q3 plan"],
      messages: [request, continuePrompt],
      internalContinuation: true,
      run,
    });

    expect(run.mock.calls.map(([args]) => args.title)).toEqual([
      "Q3 plan",
      "Q3 plan",
      "Q4 plan",
      "Q3 plan",
    ]);
    for (const id of ["run-after-move-call-1", "run-after-move-call-2"]) {
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "tool_done",
          id,
          result: expect.stringContaining("Saved Q3 plan"),
        }),
      );
    }
    expect(await stepRows(threadId)).toHaveLength(4);
  });

  it("replays the same call when a continuation reorders its argument keys", async () => {
    const threadId = "thread-resume-reordered-keys";
    const turnId = "turn-resume-reordered-keys";
    const run = vi.fn(async ({ title }: { title: string }) => `Saved ${title}`);

    await runCreateDecks({
      threadId,
      turnId,
      runId: "run-before-reorder",
      titles: [{ title: "Q3 plan", theme: "dark" }],
      messages: [request],
      run,
    });
    const events = await runCreateDecks({
      threadId,
      turnId,
      runId: "run-after-reorder",
      titles: [{ theme: "dark", title: "Q3 plan" }],
      messages: [request, continuePrompt],
      internalContinuation: true,
      run,
    });

    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "error" }),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "run-after-reorder-call-0",
        result: expect.stringContaining("Saved Q3 plan"),
      }),
    );
    expect(await stepRows(threadId)).toHaveLength(1);
  });

  it("replays a step recorded under the slot-only ID before this release", async () => {
    const threadId = "thread-resume-slot-only-step";
    const turnId = "turn-resume-slot-only-step";
    const run = vi.fn(async ({ title }: { title: string }) => `Saved ${title}`);

    const priorEvents = await runCreateDecks({
      threadId,
      turnId,
      runId: "run-before-release",
      titles: ["Q3 plan"],
      messages: [request],
      run,
    });
    const slotOnlyStepId = await recordUnderSlotOnlyId({
      threadId,
      priorRunId: "run-before-release",
      priorEvents,
      slot: 0,
    });

    const events = await runCreateDecks({
      threadId,
      turnId,
      runId: "run-after-release",
      titles: ["Q3 plan"],
      messages: [request, continuePrompt],
      internalContinuation: true,
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "run-after-release-call-0",
        executionStepId: slotOnlyStepId,
        result: expect.stringContaining("Saved Q3 plan"),
      }),
    );
    expect((await stepRows(threadId)).map((row) => row.step_id)).toEqual([
      slotOnlyStepId,
    ]);
  });

  it("replays a slot-only step from before this release when its call moves", async () => {
    const threadId = "thread-resume-moved-slot-only-step";
    const turnId = "turn-resume-moved-slot-only-step";
    const run = vi.fn(async ({ title }: { title: string }) => `Saved ${title}`);

    const priorEvents = await runCreateDecks({
      threadId,
      turnId,
      runId: "run-before-release-move",
      titles: ["Q4 plan", "Q3 plan"],
      messages: [request],
      run,
    });
    const slotOnlyStepId = await recordUnderSlotOnlyId({
      threadId,
      priorRunId: "run-before-release-move",
      priorEvents,
      slot: 1,
    });

    const events = await runCreateDecks({
      threadId,
      turnId,
      runId: "run-after-release-move",
      titles: ["Q3 plan"],
      messages: [request, continuePrompt],
      internalContinuation: true,
      run,
    });

    expect(run.mock.calls.map(([args]) => args.title)).toEqual([
      "Q4 plan",
      "Q3 plan",
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "run-after-release-move-call-0",
        executionStepId: slotOnlyStepId,
        result: expect.stringContaining("Saved Q3 plan"),
      }),
    );
  });

  it("replays a finished slot-only step from before this release when its call moves", async () => {
    const threadId = "thread-resume-moved-finished-slot-only-step";
    const turnId = "turn-resume-moved-finished-slot-only-step";
    const run = vi.fn(async ({ title }: { title: string }) => `Saved ${title}`);

    const priorEvents = await runCreateDecks({
      threadId,
      turnId,
      runId: "run-before-release-finished",
      titles: ["Q4 plan", "Q3 plan"],
      messages: [request],
      run,
    });
    const slotOnlyStepId = await recordUnderSlotOnlyId({
      threadId,
      priorRunId: "run-before-release-finished",
      priorEvents,
      slot: 1,
      withResult: true,
    });

    const events = await runCreateDecks({
      threadId,
      turnId,
      runId: "run-after-release-finished",
      titles: ["Q3 plan"],
      messages: [request, continuePrompt],
      internalContinuation: true,
      run,
    });

    expect(run.mock.calls.map(([args]) => args.title)).toEqual([
      "Q4 plan",
      "Q3 plan",
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "run-after-release-finished-call-0",
        executionStepId: slotOnlyStepId,
        result: expect.stringContaining("Saved Q3 plan"),
      }),
    );
  });

  it("holds a moved write whose slot-only step from before this release may have run", async () => {
    const threadId = "thread-resume-moved-dispatched-step";
    const turnId = "turn-resume-moved-dispatched-step";
    const run = vi.fn(async ({ title }: { title: string }) => `Saved ${title}`);

    const priorEvents = await runCreateDecks({
      threadId,
      turnId,
      runId: "run-before-release-dispatch",
      titles: ["Q4 plan", "Q3 plan"],
      messages: [request],
      retrySafe: false,
      run,
    });
    await recordUnderSlotOnlyId({
      threadId,
      priorRunId: "run-before-release-dispatch",
      priorEvents,
      slot: 1,
      dispatchedOnly: true,
    });

    const events = await runCreateDecks({
      threadId,
      turnId,
      runId: "run-after-release-dispatch",
      titles: ["Q3 plan"],
      messages: [request, continuePrompt],
      internalContinuation: true,
      retrySafe: false,
      run,
    });

    expect(run.mock.calls.map(([args]) => args.title)).toEqual([
      "Q4 plan",
      "Q3 plan",
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "run-after-release-dispatch-call-0",
        isError: true,
        errorCode: "write_tool_outcome_unknown",
      }),
    );
    expect(await stepRows(threadId)).toHaveLength(2);
  });
});
