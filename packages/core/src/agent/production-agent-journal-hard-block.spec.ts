import { describe, expect, it, vi, beforeEach } from "vitest";

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

function completedLedger(
  tool: string,
  input: Record<string, string>,
  result: string,
  artifacts?: unknown[],
): unknown[] {
  return [
    { type: "tool_start", tool, input },
    { type: "tool_done", tool, result, ...(artifacts ? { artifacts } : {}) },
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
        [
          {
            kind: "analysis",
            id: "analysis-prior",
            url: "/analyses/analysis-prior",
          },
        ],
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
        artifacts: [
          {
            kind: "analysis",
            id: "analysis-prior",
            url: "/analyses/analysis-prior",
          },
        ],
      },
    ]);
  });

  it("does NOT re-execute a journaled-complete write call on resume", async () => {
    const PRIOR_RESULT = "email-sent-id-42";
    const artifacts = [
      { kind: "image", id: "asset-journal", url: "/asset/asset-journal" },
    ];
    currentTurnEventsMock.mockResolvedValue(
      completedLedger("send-email", { to: "a@b.com" }, PRIOR_RESULT, artifacts),
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

    expect(action.run).not.toHaveBeenCalled();

    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_start", tool: "send-email" }),
    );
    const toolDone = events.find((e: any) => e.type === "tool_done");
    expect(toolDone?.result).toContain(PRIOR_RESULT);
    expect(toolDone?.result).toContain("Already completed");
    expect(toolDone?.completedSideEffect).toBe(true);
    expect(toolDone?.artifacts).toEqual(artifacts);
  });

  it("executes a fresh call normally when the journal is empty", async () => {
    currentTurnEventsMock.mockResolvedValue([]);

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

  it("survives a single ledger read blip on a continuation", async () => {
    currentTurnEventsMock
      .mockRejectedValueOnce(new Error("neon: connection lost"))
      .mockResolvedValue([]);
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
      threadId: "thread-ledger-blip",
    });

    expect(action.run).toHaveBeenCalledOnce();
    expect(events).not.toContainEqual(
      expect.objectContaining({ errorCode: "tool_call_journal_unreadable" }),
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

  it("does not stop the turn after 8 resurfaced re-fetches of the same read across chunks", async () => {
    const RAW_RESULT = "the actual document content";
    const resurfacedResult =
      "Skipped duplicate read-only call to get-doc: identical input already ran in this turn. " +
      `Its earlier result is no longer in view, so here it is again:\n\n${RAW_RESULT}`;
    const readAction = vi.fn(async () => RAW_RESULT);
    const action: ActionEntry = {
      tool: {
        description: "A read action",
        parameters: { type: "object", properties: {} },
      },
      readOnly: true,
      run: readAction,
    };

    let ledger: unknown[] = completedLedger(
      "get-doc",
      { id: "doc-1" },
      RAW_RESULT,
    );

    for (let chunk = 1; chunk <= 8; chunk++) {
      currentTurnEventsMock.mockResolvedValue(ledger);
      const events: any[] = [];

      await runAgentLoop({
        engine: singleToolEngine("get-doc", { id: "doc-1" }),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: `continue ${chunk}` }],
          },
        ],
        actions: { "get-doc": action },
        send: (e) => events.push(e),
        signal: new AbortController().signal,
        threadId: "thread-resurface",
      });

      expect(events).not.toContainEqual(
        expect.objectContaining({ errorCode: "repeated_tool_call" }),
      );
      const toolDone = events.find((e: any) => e.type === "tool_done");
      expect(toolDone?.result).toBe(resurfacedResult);

      ledger = [
        ...ledger,
        ...completedLedger("get-doc", { id: "doc-1" }, resurfacedResult),
      ];
    }

    expect(readAction).not.toHaveBeenCalled();
  });

  it("seeds repeat counts by call identity, not FIFO-per-tool-name, when concurrent same-tool calls resolve out of order", async () => {
    const resurfacedResult =
      "Skipped duplicate read-only call to get-data: identical input already ran in this turn. " +
      "Its earlier result is no longer in view, so here it is again:\n\nold-id-2-result";
    currentTurnEventsMock.mockResolvedValue([
      { type: "tool_start", tool: "get-data", input: { id: "1" } },
      { type: "tool_start", tool: "get-data", input: { id: "2" } },
      {
        type: "tool_done",
        tool: "get-data",
        input: { id: "2" },
        result: resurfacedResult,
      },
      { type: "tool_start", tool: "get-data", input: { id: "1" } },
      { type: "tool_start", tool: "get-data", input: { id: "1" } },
      { type: "tool_start", tool: "get-data", input: { id: "1" } },
      { type: "tool_start", tool: "get-data", input: { id: "1" } },
      { type: "tool_start", tool: "get-data", input: { id: "1" } },
      { type: "tool_start", tool: "get-data", input: { id: "1" } },
    ]);

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
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: { "get-data": readAction },
      send: (e) => events.push(e),
      signal: new AbortController().signal,
      threadId: "thread-concurrent-out-of-order",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "repeated_tool_call",
        recoverable: false,
      }),
    );
  });
});
