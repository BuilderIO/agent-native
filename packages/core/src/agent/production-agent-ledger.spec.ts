import { describe, expect, it, vi, beforeEach } from "vitest";

import { MCP_ACTION_RESULT_MARKER } from "../mcp-client/app-result.js";
import { assembleA2AFinalResponse } from "../server/agent-chat/action-filters-a2a.js";
import type { AgentEngine, EngineEvent } from "./engine/types.js";
import {
  AGENT_INTERNAL_CONTINUE_PROMPT,
  runAgentLoop,
  type ActionEntry,
} from "./production-agent.js";

const writeLedgerMock = vi.hoisted(() =>
  vi.fn<
    (
      threadId: string,
      toolKey: string,
      result: string,
      artifacts: unknown[],
    ) => Promise<void>
  >(),
);
const readLedgerMock = vi.hoisted(() =>
  vi.fn<
    () => Promise<{
      result: string;
      artifacts: Array<{
        kind: "image";
        id: string;
        url?: string;
        runId?: string;
      }>;
    } | null>
  >(() => Promise.resolve(null)),
);
const clearLedgerMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const currentTurnEventsMock = vi.hoisted(() =>
  vi.fn<() => Promise<any[]>>(() => Promise.resolve([])),
);

vi.mock("./run-store.js", () => ({
  writeLedgerEntry: writeLedgerMock,
  readLedgerEntry: readLedgerMock,
  clearLedgerForThread: clearLedgerMock,
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
  STALE_RUN_ERROR_EVENT: {
    type: "error",
    error: "stale",
    errorCode: "stale_run",
    recoverable: true,
    details: "",
  },
}));

function makeWriteAction(): ActionEntry {
  return {
    tool: {
      description: "A write action",
      parameters: { type: "object", properties: {} },
    },
    readOnly: false,
    run: vi.fn(async () => "write-result"),
  };
}

function makeReadAction(): ActionEntry {
  return {
    tool: {
      description: "A read action",
      parameters: { type: "object", properties: {} },
    },
    readOnly: true,
    run: vi.fn(async () => "read-result"),
  };
}

function singleToolEngine(
  toolName: string,
  input: Record<string, unknown> = {},
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

describe("tool-call result ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readLedgerMock.mockResolvedValue(null);
    clearLedgerMock.mockResolvedValue(undefined);
    writeLedgerMock.mockResolvedValue(undefined);
    currentTurnEventsMock.mockResolvedValue([]);
  });

  it("writes a ledger entry when a zombie write-tool call completes", async () => {
    // Simulate the zombie path: the action promise resolves normally (no race),
    // meaning the zombie .then() fires. With threadId set, writeLedgerEntry
    // must be called with the thread + tool key.
    const action = makeWriteAction();
    (action.run as ReturnType<typeof vi.fn>).mockResolvedValue("zombie-result");

    await runAgentLoop({
      engine: singleToolEngine("save-data", { payload: "x" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: { "save-data": action },
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-zombie",
    });

    expect(writeLedgerMock).toHaveBeenCalledWith(
      "thread-zombie",
      expect.stringContaining("save-data"),
      "zombie-result",
      [],
    );
  });

  it("does not write a ledger entry for resolved MCP error results", async () => {
    const action = makeWriteAction();
    (action.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      [MCP_ACTION_RESULT_MARKER]: true,
      text: "MCP tool failed",
      raw: { isError: true },
      serverId: "test-server",
      toolName: "save-data",
      originalToolName: "save-data",
      input: { payload: "x" },
    });

    await runAgentLoop({
      engine: singleToolEngine("save-data", { payload: "x" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: { "save-data": action },
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-mcp-error",
    });

    expect(writeLedgerMock).not.toHaveBeenCalled();
  });

  it("emits and ledgers artifact receipts before the tool result is capped", async () => {
    const action = makeWriteAction();
    action.maxResultChars = 80;
    (action.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      artifactType: "image",
      id: "asset-large",
      url: "/asset/asset-large",
      runId: "generation-large",
      payload: "X".repeat(500),
      _agentImages: [
        { url: "https://cdn.example.com/asset-large.png", label: "result" },
      ],
    });
    const events: any[] = [];

    await runAgentLoop({
      engine: singleToolEngine("generate-asset", { prompt: "large image" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: { "generate-asset": action },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      threadId: "thread-artifact",
    });

    const receipt = {
      kind: "image",
      id: "asset-large",
      url: "/asset/asset-large",
      runId: "generation-large",
    };
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "generate-asset",
        result: expect.stringContaining("...[truncated"),
        artifacts: [receipt],
      }),
    );
    expect(writeLedgerMock).toHaveBeenCalledWith(
      "thread-artifact",
      expect.stringContaining("generate-asset"),
      expect.stringContaining('"payload"'),
      [receipt],
    );
    const zombieWrite = writeLedgerMock.mock.calls.find(
      ([threadId]) => threadId === "thread-artifact",
    );
    expect(zombieWrite?.[2]).not.toContain("_agentImages");
  });

  it("returns the ledger result without re-executing on continuation match", async () => {
    const PRIOR_RESULT =
      `{"payload":"${"x".repeat(8_000)}` +
      "\n...[ledger truncated at 8000 chars]";
    const artifacts = [
      {
        kind: "image" as const,
        id: "asset-recovered",
        url: "/asset/asset-recovered",
        runId: "generation-recovered",
      },
    ];
    readLedgerMock.mockResolvedValue({ result: PRIOR_RESULT, artifacts });

    const action = makeWriteAction();
    const events: any[] = [];

    await runAgentLoop({
      engine: singleToolEngine("save-data", { content: "big" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "save this" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "orig-1",
              name: "save-data",
              input: { content: "big" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "orig-1",
              toolName: "save-data",
              toolInput: '{"content":"big"}',
              content: "Interrupted before this tool returned a result.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${AGENT_INTERNAL_CONTINUE_PROMPT}\n\nInternal note: retry`,
            },
          ],
        },
      ],
      actions: { "save-data": action },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      threadId: "thread-resume",
    });

    expect(action.run).not.toHaveBeenCalled();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "save-data",
        result: expect.stringContaining(PRIOR_RESULT),
      }),
    );
    const toolDone = events.find((e: any) => e.type === "tool_done");
    expect(toolDone?.result).toContain(
      "Recovered from prior interrupted chunk",
    );
    expect(toolDone?.completedSideEffect).toBe(true);
    expect(toolDone?.artifacts).toEqual(artifacts);

    const toolResults = events
      .filter(
        (
          event,
        ): event is Extract<(typeof events)[number], { type: "tool_done" }> =>
          event.type === "tool_done",
      )
      .map((event) => ({
        tool: event.tool,
        result: event.result,
        isError: event.isError,
        completedSideEffect: event.completedSideEffect,
        artifacts: event.artifacts,
      }));
    const assembled = assembleA2AFinalResponse(events, toolResults, {
      baseUrl: "https://assets.agent-native.com",
    });
    expect(assembled.finalText).toContain("Artifacts:");
    expect(assembled.finalText).toContain(
      "https://assets.agent-native.com/asset/asset-recovered",
    );
  });

  it("waits briefly for a late zombie ledger result before re-executing", async () => {
    readLedgerMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ result: "late zombie result", artifacts: [] });

    const action = makeWriteAction();
    const events: any[] = [];

    await runAgentLoop({
      engine: singleToolEngine("save-data", { content: "slow" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "save this" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "orig-late",
              name: "save-data",
              input: { content: "slow" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "orig-late",
              toolName: "save-data",
              toolInput: '{"content":"slow"}',
              content: "Interrupted before this tool returned a result.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${AGENT_INTERNAL_CONTINUE_PROMPT}\n\nInternal note: retry`,
            },
          ],
        },
      ],
      actions: { "save-data": action },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      threadId: "thread-late-zombie",
    });

    expect(readLedgerMock).toHaveBeenCalledTimes(2);
    expect(action.run).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "activity",
        tool: "save-data",
        label: "Waiting for previous save-data result.",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "save-data",
        result: expect.stringContaining("late zombie result"),
      }),
    );
  });

  it("does not re-execute a write tool when the run is aborted during the ledger wait", async () => {
    const controller = new AbortController();
    readLedgerMock.mockImplementation(async () => {
      controller.abort();
      return null;
    });

    const action = makeWriteAction();
    const events: any[] = [];

    await runAgentLoop({
      engine: singleToolEngine("save-data", { content: "aborted" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "save this" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "orig-abort",
              name: "save-data",
              input: { content: "aborted" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "orig-abort",
              toolName: "save-data",
              toolInput: '{"content":"aborted"}',
              content: "Interrupted before this tool returned a result.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${AGENT_INTERNAL_CONTINUE_PROMPT}\n\nInternal note: retry`,
            },
          ],
        },
      ],
      actions: { "save-data": action },
      send: (event) => events.push(event),
      signal: controller.signal,
      threadId: "thread-aborted-wait",
    }).catch(() => {
      // An aborted run may surface as a rejection depending on loop teardown;
      // the invariant under test is simply that the action never executed.
    });

    expect(action.run).not.toHaveBeenCalled();
  });

  it("returns a completed journal result without re-executing a write tool", async () => {
    currentTurnEventsMock.mockResolvedValue([
      {
        type: "tool_start",
        tool: "save-data",
        input: { content: "already-done" },
      },
      {
        type: "tool_done",
        tool: "save-data",
        result: "journaled-result",
      },
    ]);

    const action = makeWriteAction();
    const events: any[] = [];

    await runAgentLoop({
      engine: singleToolEngine("save-data", { content: "already-done" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: { "save-data": action },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      threadId: "thread-journal-hard-block",
    });

    expect(action.run).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "save-data",
        result: expect.stringContaining("journaled-result"),
      }),
    );
    const toolDone = events.find((e: any) => e.type === "tool_done");
    expect(toolDone?.result).toContain("Already completed");
  });

  it("executes normally when the ledger has no entry for the tool input", async () => {
    readLedgerMock.mockResolvedValue(null);

    const action = makeWriteAction();
    (action.run as ReturnType<typeof vi.fn>).mockResolvedValue("fresh-result");

    await runAgentLoop({
      engine: singleToolEngine("save-data", { content: "different-payload" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "save this" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "orig-2",
              name: "save-data",
              input: { content: "different-payload" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "orig-2",
              toolName: "save-data",
              toolInput: '{"content":"different-payload"}',
              content: "Interrupted before this tool returned a result.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${AGENT_INTERNAL_CONTINUE_PROMPT}\n\nInternal note: retry`,
            },
          ],
        },
      ],
      actions: { "save-data": action },
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-resume-no-match",
    });

    expect(action.run).toHaveBeenCalledOnce();
  });

  it("records a write tool rejected by a run abort as interrupted, not failed", async () => {
    const controller = new AbortController();
    const action = makeWriteAction();
    (action.run as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      controller.abort();
      throw new Error("socket closed");
    });
    const events: any[] = [];

    await runAgentLoop({
      engine: singleToolEngine("save-data", { content: "x" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: { "save-data": action },
      send: (event) => events.push(event),
      signal: controller.signal,
    }).catch(() => {});

    expect(action.run).toHaveBeenCalledOnce();
    const toolDone = events.find((e: any) => e.type === "tool_done");
    expect(toolDone?.result).toBe(
      "Interrupted before this tool returned a result.",
    );
    expect(toolDone?.completedSideEffect).not.toBe(true);
  });

  it("does not count an aborted write toward the repeated-error breaker", async () => {
    const priorAbort = [
      { type: "tool_start", tool: "save-data", input: { content: "x" } },
      {
        type: "tool_done",
        tool: "save-data",
        input: { content: "x" },
        result: "Error running save-data: Run aborted",
        isError: true,
      },
    ];
    currentTurnEventsMock.mockResolvedValue([...priorAbort, ...priorAbort]);
    const controller = new AbortController();
    const action = makeWriteAction();
    (action.run as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      controller.abort();
      throw new Error("Run aborted");
    });
    const events: any[] = [];

    await runAgentLoop({
      engine: singleToolEngine("save-data", { content: "x" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: { "save-data": action },
      send: (event) => events.push(event),
      signal: controller.signal,
      threadId: "thread-abort-breaker",
    }).catch(() => {});

    const toolDone = events.find((e: any) => e.type === "tool_done");
    expect(toolDone?.result).toBe(
      "Interrupted before this tool returned a result.",
    );
  });

  it("still records a per-tool timeout as a failure", async () => {
    const action: ActionEntry = {
      ...makeWriteAction(),
      timeoutMs: 20,
      run: vi.fn(
        () => new Promise((resolve) => setTimeout(() => resolve("late"), 200)),
      ),
    };
    const events: any[] = [];

    await runAgentLoop({
      engine: singleToolEngine("save-data", { content: "x" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: { "save-data": action },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    const toolDone = events.find((e: any) => e.type === "tool_done");
    expect(toolDone?.isError).toBe(true);
    expect(toolDone?.result).toContain("timed out after");
    expect(toolDone?.result).not.toContain("Interrupted before");
  });

  it("never consults the ledger for read-only tools", async () => {
    readLedgerMock.mockResolvedValue({
      result: "should-not-be-used",
      artifacts: [],
    });

    const action = makeReadAction();
    const events: any[] = [];

    await runAgentLoop({
      engine: singleToolEngine("get-data", { id: "123" }),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "read this" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "ro-1",
              name: "get-data",
              input: { id: "123" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "ro-1",
              toolName: "get-data",
              toolInput: '{"id":"123"}',
              content: "Interrupted before this tool returned a result.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${AGENT_INTERNAL_CONTINUE_PROMPT}\n\nInternal note: retry`,
            },
          ],
        },
      ],
      actions: { "get-data": action },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      threadId: "thread-read-only",
    });

    expect(readLedgerMock).not.toHaveBeenCalled();

    expect(action.run).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "get-data",
        result: expect.stringContaining("Skipped duplicate read-only call"),
      }),
    );
  });
});
