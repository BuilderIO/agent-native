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

const { claimTurnExecutionLease, ensureRunTables, insertRun } =
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

async function runCreateDeck(opts: {
  threadId: string;
  turnId: string;
  runId: string;
  title: string;
  messages: EngineMessage[];
  internalContinuation?: boolean;
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
        [
          {
            type: "tool-call",
            id: `${opts.runId}-call`,
            name: "create-deck",
            input: { title: opts.title },
          },
        ],
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
              properties: { title: { type: "string" } },
              required: ["title"],
            },
          },
          readOnly: false,
          retrySafe: true,
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

    await runCreateDeck({
      threadId,
      turnId,
      runId: "run-before-interruption",
      title: "Q3 plan",
      messages: [request],
      run,
    });
    // The interrupted run's tool call never reached history, so the
    // continuation asks the model again from the same checkpoint.
    const events = await runCreateDeck({
      threadId,
      turnId,
      runId: "run-after-interruption",
      title: "Q3 planning deck",
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

    await runCreateDeck({
      threadId,
      turnId,
      runId: "run-before-replay",
      title: "Q3 plan",
      messages: [request],
      run,
    });
    const events = await runCreateDeck({
      threadId,
      turnId,
      runId: "run-after-replay",
      title: "Q3 plan",
      messages: [request, continuePrompt],
      internalContinuation: true,
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "run-after-replay-call",
        result: expect.stringContaining("Saved Q3 plan"),
      }),
    );
    expect(await stepRows(threadId)).toHaveLength(1);
  });
});
