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

const { runAgentLoop } = await import("./production-agent.js");
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

  it("never short-circuits a read-only tool via the journal", async () => {
    currentTurnEventsMock.mockResolvedValue(
      completedLedger("get-data", { id: "1" }, "old-read"),
    );

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
      actions: { "get-data": readAction },
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-read",
    });

    // Read-only tools are never hard-blocked by the journal; they run.
    expect(readAction.run).toHaveBeenCalledOnce();
  });
});
