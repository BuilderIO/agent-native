/**
 * Specs for the tool-call journal hard-block (tool-layer enforcement):
 *
 *   1. A write tool whose exact call already COMPLETED in the per-turn journal
 *      (derived from the durable run-event ledger of a prior interrupted chunk)
 *      is NOT re-executed on resume - run() is never called and the journaled
 *      result is returned, with a coherent tool_start/tool_done transcript.
 *   2. A FRESH call (empty journal - no prior completion) executes normally.
 *   3. A different-input call (no journal match) executes normally.
 *
 * The run-store ledger reader is mocked so no DB is touched.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock run-store: getCurrentTurnEventsForThread drives the journal.
const currentTurnEventsMock = vi.hoisted(() =>
  vi.fn<() => Promise<unknown[]>>(async () => []),
);

vi.mock("./run-store.js", () => ({
  writeLedgerEntry: vi.fn(async () => {}),
  readLedgerEntry: vi.fn(async () => null),
  clearLedgerForThread: vi.fn(async () => {}),
  getCurrentTurnEventsForThread: currentTurnEventsMock,
  insertRun: vi.fn(),
  updateRunHeartbeat: vi.fn(),
  getRunAbortState: vi.fn(async () => ({ aborted: false, reason: null })),
  insertRunEvent: vi.fn(),
  updateRunStatusIfRunning: vi.fn(),
  markRunAborted: vi.fn(),
  reapIfStale: vi.fn(async () => false),
  bumpRunProgress: vi.fn(),
  ensureTerminalRunEvent: vi.fn(),
  setRunError: vi.fn(),
  setRunTerminalReason: vi.fn(),
}));

// Keep OM out of the way. It's gated on ownerEmail anyway, but mock it so the
// post-turn compaction never touches a DB.
vi.mock("./observational-memory/index.js", () => ({
  maybeCompactThread: vi.fn(async () => ({})),
  buildObservationalContext: vi.fn(async () => ({
    threadId: "t",
    reflections: [],
    observations: [],
    recentMessages: [],
    tokens: { reflections: 0, observations: 0, recentMessages: 0, total: 0 },
  })),
  hasObservationalMemory: () => false,
  serializeObservationalMemoryBlock: () => "",
}));

const {
  runAgentLoop,
  MAX_IDENTICAL_TOOL_CALLS,
  AGENT_INTERNAL_CONTINUE_PROMPT,
} = await import("./production-agent.js");
import type { AgentEngine, EngineEvent } from "./engine/types.js";
import type { ActionEntry } from "./production-agent.js";

// Helpers.

function makeWriteAction(): ActionEntry {
  return {
    tool: {
      description: "A write action",
      parameters: { type: "object", properties: {} },
    },
    readOnly: false,
    run: vi.fn(async () => "fresh-execution-result"),
  };
}

/** Engine that emits one tool call (with the given input) then ends. */
function singleToolEngine(
  toolName: string,
  input: Record<string, unknown>,
): AgentEngine {
  let calls = 0;
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
      calls++;
      if (calls === 1) {
        yield {
          type: "assistant-content",
          parts: [
            { type: "tool-call" as const, id: "tc-1", name: toolName, input },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
        return;
      }
      yield {
        type: "assistant-content",
        parts: [{ type: "text" as const, text: "done" }],
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };
}

function finalTextEngine(text: string): AgentEngine {
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
      yield {
        type: "assistant-content",
        parts: [{ type: "text" as const, text }],
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };
}

/** A prior-chunk ledger where `send-email {to: x}` started AND completed. */
function completedLedger(
  tool: string,
  input: Record<string, string>,
  result: string,
): unknown[] {
  return [
    { type: "tool_start", tool, input },
    { type: "tool_done", tool, result },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  currentTurnEventsMock.mockResolvedValue([]);
});

describe("tool-call journal hard-block", () => {
  it("includes prior continuation tool results in final-response guards", async () => {
    currentTurnEventsMock.mockResolvedValue(
      completedLedger(
        "bigquery",
        { sql: "select count(*)" },
        '{"rows":[{"count":3}]}',
      ),
    );
    const guard = vi.fn(() => null);

    await runAgentLoop({
      engine: finalTextEngine("The count is 3."),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Continue the analysis." }],
        },
      ],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-continuation-guard",
      finalResponseGuard: guard,
    });

    expect(guard).toHaveBeenCalledOnce();
    expect(guard.mock.calls[0]?.[0].toolCalls).toEqual([
      {
        name: "bigquery",
        input: { sql: "select count(*)" },
      },
    ]);
    expect(guard.mock.calls[0]?.[0].toolResults).toEqual([
      {
        name: "bigquery",
        input: { sql: "select count(*)" },
        content: '{"rows":[{"count":3}]}',
        isError: false,
      },
    ]);
  });

  it("does NOT re-execute a journaled-complete write call on resume", async () => {
    const PRIOR_RESULT = "email-sent-id-42";
    currentTurnEventsMock.mockResolvedValue(
      completedLedger("send-email", { to: "a@b.com" }, PRIOR_RESULT),
    );

    const action = makeWriteAction();
    const events: any[] = [];

    await runAgentLoop({
      engine: singleToolEngine("send-email", { to: "a@b.com" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "resend" }] }],
      actions: { "send-email": action },
      send: (e) => events.push(e),
      signal: new AbortController().signal,
      threadId: "thread-resume",
    });

    // The side effect must NOT have re-fired.
    expect(action.run).not.toHaveBeenCalled();

    // Transcript stays coherent: both tool_start and tool_done were emitted,
    // and the journaled result is surfaced.
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_start", tool: "send-email" }),
    );
    const toolDone = events.find((e: any) => e.type === "tool_done");
    expect(toolDone?.result).toContain(PRIOR_RESULT);
    expect(toolDone?.result).toContain("Already completed");
    expect(toolDone?.completedSideEffect).toBe(true);
  });

  it("executes a fresh call normally when the journal is empty", async () => {
    currentTurnEventsMock.mockResolvedValue([]); // no prior chunk

    const action = makeWriteAction();

    await runAgentLoop({
      engine: singleToolEngine("send-email", { to: "a@b.com" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "send" }] }],
      actions: { "send-email": action },
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-fresh",
    });

    // Fresh call: the action runs exactly once.
    expect(action.run).toHaveBeenCalledOnce();
  });

  it("executes normally when a journaled call has a DIFFERENT input", async () => {
    currentTurnEventsMock.mockResolvedValue(
      completedLedger("send-email", { to: "someone-else@b.com" }, "old"),
    );

    const action = makeWriteAction();

    await runAgentLoop({
      engine: singleToolEngine("send-email", { to: "a@b.com" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "send" }] }],
      actions: { "send-email": action },
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-diff-input",
    });

    // No journal match (different recipient), so it executes.
    expect(action.run).toHaveBeenCalledOnce();
  });

  it("executes normally when a matching prior tool_done was blocked or failed", async () => {
    currentTurnEventsMock.mockResolvedValue([
      {
        type: "tool_start",
        tool: "add-slide",
        input: { deckId: "deck-1", layout: "content" },
      },
      {
        type: "tool_done",
        tool: "add-slide",
        result:
          "Plan mode blocked `add-slide`. Switch to Act mode after the user approves the plan, then retry the action.",
      },
    ]);

    const action = makeWriteAction();

    await runAgentLoop({
      engine: singleToolEngine("add-slide", {
        deckId: "deck-1",
        layout: "content",
      }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "add" }] }],
      actions: { "add-slide": action },
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-blocked-prior",
    });

    expect(action.run).toHaveBeenCalledOnce();
  });

  it("serves a read-only tool's journaled result from the prior chunk instead of re-executing it", async () => {
    const fullResult = "x".repeat(50_000);
    currentTurnEventsMock.mockResolvedValue(
      completedLedger("get-data", { id: "1" }, fullResult),
    );

    const readAction: ActionEntry = {
      tool: {
        description: "A read action",
        parameters: { type: "object", properties: {} },
      },
      readOnly: true,
      run: vi.fn(async () => "fresh-read"),
    };

    const events: any[] = [];
    await runAgentLoop({
      engine: singleToolEngine("get-data", { id: "1" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "read" }] }],
      actions: { "get-data": readAction },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      threadId: "thread-read",
    });

    expect(readAction.run).not.toHaveBeenCalled();
    // The FULL journaled body is served, not the 400-char prompt summary that
    // used to leave the model no choice but to re-run the read.
    const done = events.find((event) => event.type === "tool_done");
    expect(done.result).toContain(fullResult);
  });

  it("still re-executes a read-only tool that opted out with dedupe: false", async () => {
    currentTurnEventsMock.mockResolvedValue(
      completedLedger("poll-status", { id: "1" }, "stale-status"),
    );

    const pollAction: ActionEntry = {
      tool: {
        description: "A volatile read",
        parameters: { type: "object", properties: {} },
      },
      readOnly: true,
      dedupe: false,
      run: vi.fn(async () => "fresh-status"),
    };

    await runAgentLoop({
      engine: singleToolEngine("poll-status", { id: "1" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "poll" }] }],
      actions: { "poll-status": pollAction },
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-poll",
    });

    expect(pollAction.run).toHaveBeenCalledOnce();
  });

  it("does not replay a journaled read that a later write in the same turn invalidated", async () => {
    currentTurnEventsMock.mockResolvedValue([
      ...completedLedger("get-data", { id: "1" }, "stale-read"),
      ...completedLedger("save-thing", { id: "9" }, "saved"),
    ]);

    const readAction: ActionEntry = {
      tool: {
        description: "A read action",
        parameters: { type: "object", properties: {} },
      },
      readOnly: true,
      run: vi.fn(async () => "fresh-read"),
    };

    await runAgentLoop({
      engine: singleToolEngine("get-data", { id: "1" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "read" }] }],
      actions: { "get-data": readAction, "save-thing": makeWriteAction() },
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-read-after-write",
    });

    expect(readAction.run).toHaveBeenCalledOnce();
  });

  it("counts identical tool calls from earlier chunks of the same turn", async () => {
    // Seven identical calls already in this turn's ledger, none of them
    // completed. Unseeded, this chunk starts from zero and the model gets
    // another full MAX_IDENTICAL_TOOL_CALLS budget at every chunk boundary.
    currentTurnEventsMock.mockResolvedValue(
      Array.from({ length: MAX_IDENTICAL_TOOL_CALLS - 1 }, () => ({
        type: "tool_start",
        tool: "flaky-write",
        input: { id: "row-1" },
      })),
    );
    const action = makeWriteAction();
    const events: any[] = [];

    await runAgentLoop({
      engine: singleToolEngine("flaky-write", { id: "row-1" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: { "flaky-write": action },
      send: (e) => events.push(e),
      signal: new AbortController().signal,
      threadId: "thread-repeat-across-chunks",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "repeated_tool_call",
        recoverable: false,
      }),
    );
    // A guard stop is a failed run, not a clean one.
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "done" }),
    );
  });

  it("uses the persisted normalized input for repeat counts", async () => {
    currentTurnEventsMock.mockResolvedValue(
      Array.from({ length: MAX_IDENTICAL_TOOL_CALLS - 1 }, () => ({
        type: "tool_start",
        tool: "write-config",
        input: { config: { a: 1 } },
      })),
    );
    const action: ActionEntry = {
      tool: {
        description: "A config write action",
        parameters: {
          type: "object",
          properties: { config: { type: "object" } },
        },
      },
      readOnly: false,
      run: vi.fn(async () => "fresh-execution-result"),
    };
    const events: any[] = [];

    await runAgentLoop({
      // The model sends the same object as a JSON string; action execution and
      // the journal normalize it to the object form before recording the call.
      engine: singleToolEngine("write-config", { config: '{"a":1}' }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: { "write-config": action },
      send: (e) => events.push(e),
      signal: new AbortController().signal,
      threadId: "thread-repeat-normalized-input",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "repeated_tool_call",
        recoverable: false,
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "done" }),
    );
  });

  it("counts identical tool errors from earlier chunks of the same turn", async () => {
    currentTurnEventsMock.mockResolvedValue([
      { type: "tool_start", tool: "flaky-write", input: { id: "row-1" } },
      {
        type: "tool_done",
        tool: "flaky-write",
        input: { id: "row-1" },
        result: "Error running flaky-write: DB exploded",
        isError: true,
      },
      { type: "tool_start", tool: "flaky-write", input: { id: "row-1" } },
      {
        type: "tool_done",
        tool: "flaky-write",
        result: "Error running flaky-write: DB exploded",
        isError: true,
      },
    ]);
    const action: ActionEntry = {
      tool: {
        description: "A write action",
        parameters: { type: "object", properties: {} },
      },
      readOnly: false,
      run: vi.fn(async () => {
        throw new Error("DB exploded");
      }),
    };
    const events: any[] = [];

    await runAgentLoop({
      engine: singleToolEngine("flaky-write", { id: "row-1" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: { "flaky-write": action },
      send: (e) => events.push(e),
      signal: new AbortController().signal,
      threadId: "thread-repeat-error-across-chunks",
    });

    // Two prior failures are already on the ledger, so this chunk's first
    // failure is the third and last.
    expect(action.run).toHaveBeenCalledOnce();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "repeated_identical_tool_error",
        details: expect.stringContaining("DB exploded"),
      }),
    );
  });

  it("stops a continuation whose per-turn ledger cannot be read", async () => {
    currentTurnEventsMock.mockRejectedValue(new Error("neon: connection lost"));
    const action = makeWriteAction();
    const events: any[] = [];

    await runAgentLoop({
      engine: singleToolEngine("send-email", { to: "a@b.com" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: AGENT_INTERNAL_CONTINUE_PROMPT }],
        },
      ],
      actions: { "send-email": action },
      send: (e) => events.push(e),
      signal: new AbortController().signal,
      threadId: "thread-unreadable",
    });

    // Without the ledger we cannot tell a completed side effect from a fresh
    // one, so nothing runs.
    expect(action.run).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "tool_call_journal_unreadable",
        recoverable: false,
        details: expect.stringContaining("neon: connection lost"),
      }),
    );
  });

  it("runs a FRESH turn normally when the ledger read fails", async () => {
    currentTurnEventsMock.mockRejectedValue(new Error("neon: connection lost"));
    const action = makeWriteAction();

    await runAgentLoop({
      engine: singleToolEngine("send-email", { to: "a@b.com" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "send" }] }],
      actions: { "send-email": action },
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-unreadable-fresh",
    });

    expect(action.run).toHaveBeenCalledOnce();
  });
});
