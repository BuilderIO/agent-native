/**
 * Specs for the Observational Memory (OM) wiring in the agent loop:
 *
 *   1. PRODUCER - after a clean turn the post-turn compaction hook
 *      (`maybeCompactThread`) is invoked for a thread, fire-and-forget.
 *   2. CONSUMER (long thread) - when the thread HAS persisted observations /
 *      reflections, the assembled context the engine sees is prefixed with the
 *      serialized OM memory block.
 *   3. CONSUMER (short thread) - when the thread has NO OM entries, the engine
 *      sees the messages unchanged (no OM block injected). Common-path safety.
 *
 * The OM module is mocked end-to-end so neither a real model nor a real DB is
 * touched.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock run-store so DB is never touched.
vi.mock("./run-store.js", () => ({
  writeLedgerEntry: vi.fn(async () => {}),
  readLedgerEntry: vi.fn(async () => null),
  clearLedgerForThread: vi.fn(async () => {}),
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

// Mock the OM module: assert producer + drive the consumer.
const maybeCompactThreadMock = vi.hoisted(() => vi.fn(async () => ({})));
const buildObservationalContextMock = vi.hoisted(() => vi.fn());

const OM_BLOCK_TEXT =
  "[Observational Memory] compacted history\n\n## Reflections (highest-level)\nGoal: ship OM";

vi.mock("./observational-memory/index.js", () => ({
  maybeCompactThread: maybeCompactThreadMock,
  buildObservationalContext: buildObservationalContextMock,
  // Use the real-shaped predicates against the mocked context.
  hasObservationalMemory: (ctx: any) =>
    (ctx?.reflections?.length ?? 0) > 0 || (ctx?.observations?.length ?? 0) > 0,
  serializeObservationalMemoryBlock: (ctx: any) =>
    (ctx?.reflections?.length ?? 0) > 0 || (ctx?.observations?.length ?? 0) > 0
      ? OM_BLOCK_TEXT
      : "",
}));

// Mock context-xray so the OM injection runs on the raw messages unchanged.
vi.mock("./context-xray/directives-store.js", () => ({
  loadContextDirectives: vi.fn(async () => []),
}));
vi.mock("./context-xray/manifest.js", () => ({
  buildManifest: vi.fn(async () => ({})),
  writeContextManifest: vi.fn(async () => {}),
}));
vi.mock("./context-xray/segments.js", () => ({
  computeProtectedSegmentIds: vi.fn(() => new Set<string>()),
}));
vi.mock("./context-xray/apply-directives.js", () => ({
  applyContextDirectives: (messages: any) => ({
    messages,
    appliedStatus: {},
  }),
}));

const { runAgentLoop } = await import("./production-agent.js");
import type {
  AgentEngine,
  EngineEvent,
  EngineMessage,
} from "./engine/types.js";

// Helpers.

/** Engine that records the messages it was streamed, then ends the turn. */
function recordingEngine(captured: EngineMessage[][]): AgentEngine {
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
    async *stream(opts: any): AsyncIterable<EngineEvent> {
      // Snapshot the array at stream time; the loop later mutates the original
      // `messages` reference by pushing the assistant reply.
      captured.push([...(opts.messages as EngineMessage[])]);
      yield {
        type: "assistant-content",
        parts: [{ type: "text" as const, text: "done" }],
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };
}

function blockText(messages: EngineMessage[]): string[] {
  return messages.flatMap((m) =>
    m.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text),
  );
}

const baseMessages: EngineMessage[] = [
  { role: "user", content: [{ type: "text", text: "hello" }] },
];

beforeEach(() => {
  vi.clearAllMocks();
  maybeCompactThreadMock.mockResolvedValue({});
  // Default: short thread (no OM entries).
  buildObservationalContextMock.mockResolvedValue({
    threadId: "t",
    reflections: [],
    observations: [],
    recentMessages: [],
    tokens: { reflections: 0, observations: 0, recentMessages: 0, total: 0 },
  });
});

describe("observational memory wiring", () => {
  it("invokes the post-turn compaction hook for a thread", async () => {
    const captured: EngineMessage[][] = [];
    await runAgentLoop({
      engine: recordingEngine(captured),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [...baseMessages],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-om",
      ownerEmail: "alice@example.com",
    });

    // Fire-and-forget; let the microtask run.
    await Promise.resolve();
    await Promise.resolve();

    expect(maybeCompactThreadMock).toHaveBeenCalledTimes(1);
    const arg = maybeCompactThreadMock.mock.calls[0][0] as any;
    expect(arg.threadId).toBe("thread-om");
    expect(arg.ownerEmail).toBe("alice@example.com");
  });

  it("does NOT run compaction when there is no threadId", async () => {
    const captured: EngineMessage[][] = [];
    await runAgentLoop({
      engine: recordingEngine(captured),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [...baseMessages],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    });
    await Promise.resolve();
    expect(maybeCompactThreadMock).not.toHaveBeenCalled();
  });

  it("does NOT run OM when a thread has no authenticated owner", async () => {
    const captured: EngineMessage[][] = [];
    await runAgentLoop({
      engine: recordingEngine(captured),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [...baseMessages],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-no-owner",
    });
    await Promise.resolve();

    expect(buildObservationalContextMock).not.toHaveBeenCalled();
    expect(maybeCompactThreadMock).not.toHaveBeenCalled();
    expect(blockText(captured[0])).toEqual(["hello"]);
  });

  it("injects the OM memory block into context for a thread WITH entries (long thread)", async () => {
    const recentTail: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "recent turn" }] },
    ];
    buildObservationalContextMock.mockResolvedValue({
      threadId: "thread-long",
      reflections: [{ text: "Goal: ship OM" }],
      observations: [{ text: "did stuff" }],
      recentMessages: recentTail,
      tokens: {
        reflections: 5,
        observations: 5,
        recentMessages: 5,
        total: 15,
      },
    });

    const captured: EngineMessage[][] = [];
    await runAgentLoop({
      engine: recordingEngine(captured),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "old turn" }] },
        { role: "assistant", content: [{ type: "text", text: "old reply" }] },
        { role: "user", content: [{ type: "text", text: "recent turn" }] },
      ],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-long",
      ownerEmail: "alice@example.com",
    });

    expect(captured.length).toBe(1);
    const sent = captured[0];
    const texts = blockText(sent);
    // The serialized OM block must be the leading message.
    expect(texts[0]).toContain("[Observational Memory]");
    expect(sent[0].role).toBe("user");
    // The recent-raw window is preserved verbatim after the block.
    expect(texts).toContain("recent turn");
    // The trimmed-away older prefix is no longer replayed.
    expect(texts).not.toContain("old turn");
  });

  it("leaves context unchanged for a thread with NO entries (short thread)", async () => {
    // Default mock = no reflections/observations.
    const inputMessages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
    ];

    const captured: EngineMessage[][] = [];
    await runAgentLoop({
      engine: recordingEngine(captured),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: inputMessages,
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-short",
      ownerEmail: "alice@example.com",
    });

    const sent = captured[0];
    const texts = blockText(sent);
    // No OM block injected; all original turns intact and in order.
    expect(texts.some((t) => t.includes("[Observational Memory]"))).toBe(false);
    expect(texts).toEqual(["first", "reply", "second"]);
  });
});
