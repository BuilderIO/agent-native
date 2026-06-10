/**
 * Specs for the tool-call result ledger (P1 fix):
 *
 *   1. Late zombie completion writes a ledger entry.
 *   2. Continuation with matching (toolName + inputHash) returns the ledger
 *      result without re-executing the action.
 *   3. Different input executes normally (no ledger match).
 *   4. Read-only tools never consult the ledger.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  AGENT_INTERNAL_CONTINUE_PROMPT,
  runAgentLoop,
  type ActionEntry,
} from "./production-agent.js";
import type { AgentEngine, EngineEvent } from "./engine/types.js";

// ─── Mock run-store so DB is never touched ───────────────────────────────────

const writeLedgerMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const readLedgerMock = vi.hoisted(() =>
  vi.fn<() => Promise<string | null>>(() => Promise.resolve(null)),
);
const clearLedgerMock = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock("./run-store.js", () => ({
  writeLedgerEntry: writeLedgerMock,
  readLedgerEntry: readLedgerMock,
  clearLedgerForThread: clearLedgerMock,
  // Other run-store functions used by production-agent during abort handling:
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
  STALE_RUN_ERROR_EVENT: {
    type: "error",
    error: "stale",
    errorCode: "stale_run",
    recoverable: true,
    details: "",
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/** Engine that emits a single tool call then ends. */
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("tool-call result ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no prior ledger entry
    readLedgerMock.mockResolvedValue(null);
    clearLedgerMock.mockResolvedValue(undefined);
    writeLedgerMock.mockResolvedValue(undefined);
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

    // writeLedgerEntry must have been called with the thread and a key
    // that encodes the tool name + stable input hash.
    expect(writeLedgerMock).toHaveBeenCalledWith(
      "thread-zombie",
      expect.stringContaining("save-data"),
      "zombie-result",
    );
  });

  it("returns the ledger result without re-executing on continuation match", async () => {
    // readLedgerEntry returns a cached result — the action must NOT run again.
    const PRIOR_RESULT = "previously completed result";
    readLedgerMock.mockResolvedValue(PRIOR_RESULT);

    const action = makeWriteAction();
    const events: any[] = [];

    // Build a continuation turn: the same save-data was interrupted once,
    // so priorInterruptions > 0, which triggers the ledger check.
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

    // The action must NOT have been called again — the ledger result was used.
    expect(action.run).not.toHaveBeenCalled();

    // The tool_done event must contain the recovered result.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "save-data",
        result: expect.stringContaining(PRIOR_RESULT),
      }),
    );
    // The result must indicate recovery.
    const toolDone = events.find((e: any) => e.type === "tool_done");
    expect(toolDone?.result).toContain(
      "Recovered from prior interrupted chunk",
    );
  });

  it("executes normally when the ledger has no entry for the tool input", async () => {
    // readLedgerEntry returns null → action must run as usual.
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

    // Action should have run once since ledger returned null (cache miss).
    expect(action.run).toHaveBeenCalledOnce();
  });

  it("never consults the ledger for read-only tools", async () => {
    // Even if readLedger were to return something, read-only tools should
    // bypass the ledger entirely — they have no side effects to protect.
    readLedgerMock.mockResolvedValue("should-not-be-used");

    const action = makeReadAction();
    const events: any[] = [];

    // Simulate a continuation with an "interrupted" read-only tool result
    // (unusual, but the ledger must not be consulted regardless).
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

    // readLedgerEntry must never be called for read-only tools.
    expect(readLedgerMock).not.toHaveBeenCalled();

    // The read-only per-turn cache handles the retry instead of the durable
    // write-tool ledger, so the read action is not re-executed either.
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
