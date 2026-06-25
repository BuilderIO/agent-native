import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { EngineError } from "./engine/types.js";
import type { EngineMessage } from "./engine/types.js";
import {
  AGENT_INTERNAL_CONTINUE_PROMPT,
  appendAgentLoopContinuation,
  isResumableEngineError,
  continuationReasonForResumableError,
  runAgentLoop,
} from "./production-agent.js";
import {
  runAgentLoopDirectWithSoftTimeout,
  MAX_RUN_LOOP_CONTINUATIONS,
  RUN_BUDGET_EXHAUSTED_ERROR_CODE,
  RUN_BUDGET_EXHAUSTED_MESSAGE,
} from "./run-loop-with-resume.js";
import { getCurrentTurnEventsForThread } from "./run-store.js";
import type { AgentChatEvent } from "./types.js";

vi.mock("./production-agent.js", async () => {
  const actual = await vi.importActual<typeof import("./production-agent.js")>(
    "./production-agent.js",
  );
  return {
    ...actual,
    runAgentLoop: vi.fn(),
  };
});

// The journal reads the durable run-event ledger. Mock just the read-only
// helper used on the resume path so tests don't need a live DB; keep the rest
// of run-store real (run-manager pulls several other exports from it).
vi.mock("./run-store.js", async () => {
  const actual =
    await vi.importActual<typeof import("./run-store.js")>("./run-store.js");
  return {
    ...actual,
    getCurrentTurnEventsForThread: vi.fn(async () => [] as AgentChatEvent[]),
  };
});

const mockRunAgentLoop = vi.mocked(runAgentLoop);
const mockGetCurrentTurnEventsForThread = vi.mocked(
  getCurrentTurnEventsForThread,
);

function makeOpts(
  messages: EngineMessage[],
  signal: AbortSignal,
  send?: (event: import("./types.js").AgentChatEvent) => void,
  threadId?: string,
): Parameters<typeof runAgentLoopDirectWithSoftTimeout>[0] {
  return {
    // The wrapper only inspects messages, signal, model, and threadId. Cast the
    // rest — the mocked runAgentLoop ignores them.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engine: {} as any,
    model: "test-model",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    systemPrompt: "system" as any,
    tools: [],
    messages,
    actions: {},
    send: send ?? (() => {}),
    signal,
    ...(threadId ? { threadId } : {}),
  } as Parameters<typeof runAgentLoopDirectWithSoftTimeout>[0];
}

describe("isResumableEngineError", () => {
  it("recognizes the Builder gateway timeout error code", () => {
    const err = new EngineError("Builder gateway timed out", {
      errorCode: "builder_gateway_timeout",
    });
    expect(isResumableEngineError(err)).toBe(true);
  });

  it("recognizes the Builder gateway network error code", () => {
    const err = new EngineError("Builder gateway network error", {
      errorCode: "builder_gateway_network_error",
    });
    expect(isResumableEngineError(err)).toBe(true);
  });

  it("recognizes 5xx HTTP gateway responses as resumable", () => {
    for (const code of ["http_502", "http_503", "http_504"]) {
      const err = new EngineError("upstream error", { errorCode: code });
      expect(isResumableEngineError(err)).toBe(true);
    }
  });

  it("recognizes raw transport errors by message", () => {
    const cases = [
      "socket hang up",
      "ECONNRESET",
      "fetch failed",
      "connection reset by peer",
      "stream closed unexpectedly",
      "Inactivity timeout",
      "gateway timeout",
      "function timeout exceeded",
    ];
    for (const message of cases) {
      expect(isResumableEngineError(new Error(message))).toBe(true);
    }
  });

  it("inspects nested cause chains for transport markers", () => {
    const inner = new Error("ECONNRESET while streaming");
    const outer = new Error("wrapper error");
    (outer as Error & { cause?: unknown }).cause = inner;
    expect(isResumableEngineError(outer)).toBe(true);
  });

  it("returns false for terminal user-facing errors", () => {
    expect(
      isResumableEngineError(
        new EngineError("Conversation has grown too long.", {
          errorCode: "context_length_exceeded",
        }),
      ),
    ).toBe(false);
    expect(
      isResumableEngineError(
        new EngineError("Missing API key", {
          errorCode: "missing_credentials",
        }),
      ),
    ).toBe(false);
    expect(isResumableEngineError(new Error("400 Bad Request"))).toBe(false);
    expect(isResumableEngineError("not an Error object")).toBe(false);
  });
});

describe("continuationReasonForResumableError", () => {
  it("maps Builder gateway timeout error code to gateway_timeout", () => {
    const err = new EngineError("Builder gateway timed out", {
      errorCode: "builder_gateway_timeout",
    });
    expect(continuationReasonForResumableError(err)).toBe("gateway_timeout");
  });

  it("maps message-only timeout signals to gateway_timeout", () => {
    expect(
      continuationReasonForResumableError(new Error("upstream timeout 504")),
    ).toBe("gateway_timeout");
    expect(
      continuationReasonForResumableError(new Error("function timeout")),
    ).toBe("gateway_timeout");
  });

  it("falls back to network_interrupted for non-timeout transport errors", () => {
    expect(
      continuationReasonForResumableError(new Error("socket hang up")),
    ).toBe("network_interrupted");
    expect(continuationReasonForResumableError(new Error("ECONNRESET"))).toBe(
      "network_interrupted",
    );
  });
});

describe("appendAgentLoopContinuation", () => {
  it("appends a user message starting with the standard continue prompt", () => {
    const messages: EngineMessage[] = [];
    appendAgentLoopContinuation(messages, "run_timeout");
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    const text =
      messages[0].content[0].type === "text" ? messages[0].content[0].text : "";
    expect(text.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT)).toBe(true);
  });

  it("includes a gateway-specific note for gateway_timeout", () => {
    const messages: EngineMessage[] = [];
    appendAgentLoopContinuation(messages, "gateway_timeout");
    const text =
      messages[0].content[0].type === "text" ? messages[0].content[0].text : "";
    expect(text).toContain("upstream gateway timeout");
  });

  it("includes a transport-specific note for network_interrupted", () => {
    const messages: EngineMessage[] = [];
    appendAgentLoopContinuation(messages, "network_interrupted");
    const text =
      messages[0].content[0].type === "text" ? messages[0].content[0].text : "";
    expect(text).toContain("transport-level interruption");
  });
});

describe("runAgentLoopDirectWithSoftTimeout", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_RUN_SOFT_TIMEOUT_MS", "60000");
    mockRunAgentLoop.mockReset();
    mockGetCurrentTurnEventsForThread.mockReset();
    mockGetCurrentTurnEventsForThread.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resumes on builder_gateway_timeout and runs another LLM call", async () => {
    let attempts = 0;
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
    ];

    mockRunAgentLoop.mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw new EngineError("Builder gateway timed out after 45s", {
          errorCode: "builder_gateway_timeout",
        });
      }
      return {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 80,
        cacheWriteTokens: 0,
        model: "test-model",
      };
    });

    const usage = await runAgentLoopDirectWithSoftTimeout(
      makeOpts(messages, new AbortController().signal),
      60_000,
    );

    expect(attempts).toBe(2);
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);

    // Resume must have appended a continuation nudge between attempts.
    const continuationMessages = messages.filter(
      (m) =>
        m.role === "user" &&
        m.content.some(
          (c) =>
            c.type === "text" &&
            c.text.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT),
        ),
    );
    expect(continuationMessages).toHaveLength(1);
  });

  it("resumes on raw socket-hang-up errors with a network_interrupted nudge", async () => {
    let attempts = 0;
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
    ];

    mockRunAgentLoop.mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error("socket hang up");
      }
      return {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "test-model",
      };
    });

    await runAgentLoopDirectWithSoftTimeout(
      makeOpts(messages, new AbortController().signal),
      60_000,
    );

    expect(attempts).toBe(2);
    const continuationText = messages
      .map((m) => (m.content[0]?.type === "text" ? m.content[0].text : ""))
      .find((t) => t.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT));
    expect(continuationText).toContain("transport-level interruption");
  });

  it("rethrows non-resumable terminal errors immediately without continuing", async () => {
    let attempts = 0;
    mockRunAgentLoop.mockImplementation(async () => {
      attempts++;
      throw new EngineError("Conversation has grown too long.", {
        errorCode: "context_length_exceeded",
      });
    });

    await expect(
      runAgentLoopDirectWithSoftTimeout(
        makeOpts(
          [{ role: "user", content: [{ type: "text", text: "go" }] }],
          new AbortController().signal,
        ),
        60_000,
      ),
    ).rejects.toThrow("Conversation has grown too long.");

    expect(attempts).toBe(1);
  });

  it("bails out after MAX_RUN_LOOP_CONTINUATIONS to prevent infinite loops", async () => {
    let attempts = 0;
    mockRunAgentLoop.mockImplementation(async () => {
      attempts++;
      throw new Error("socket hang up");
    });

    // After MAX iterations the loop returns the accumulated (empty) usage
    // rather than throwing — matches the existing soft-timeout exit shape and
    // lets the run-manager finalize the run.
    const usage = await runAgentLoopDirectWithSoftTimeout(
      makeOpts(
        [{ role: "user", content: [{ type: "text", text: "go" }] }],
        new AbortController().signal,
      ),
      60_000,
    );

    expect(attempts).toBe(MAX_RUN_LOOP_CONTINUATIONS);
    expect(usage.inputTokens).toBe(0);
  });

  it("emits a loud give-up terminal error when the continuation budget is exhausted mid-step", async () => {
    // Every attempt is a resumable interruption, so the loop keeps continuing
    // and finally hits MAX_RUN_LOOP_CONTINUATIONS without ever finishing. This
    // is the genuinely-silent cutoff case: the run-manager would otherwise
    // report a clean `done`, so the wrapper must surface an explicit terminal.
    const sentEvents: AgentChatEvent[] = [];
    let attempts = 0;
    mockRunAgentLoop.mockImplementation(async () => {
      attempts++;
      throw new Error("socket hang up");
    });

    await runAgentLoopDirectWithSoftTimeout(
      makeOpts(
        [{ role: "user", content: [{ type: "text", text: "go" }] }],
        new AbortController().signal,
        (event) => sentEvents.push(event),
      ),
      60_000,
    );

    expect(attempts).toBe(MAX_RUN_LOOP_CONTINUATIONS);
    const terminal = sentEvents.find((e) => e.type === "error");
    expect(terminal).toBeDefined();
    const err = terminal as Extract<AgentChatEvent, { type: "error" }>;
    expect(err.errorCode).toBe(RUN_BUDGET_EXHAUSTED_ERROR_CODE);
    expect(err.error).toBe(RUN_BUDGET_EXHAUSTED_MESSAGE);
    expect(err.error).toContain("stopped");
    expect(err.error).toContain("nothing was partially saved");
    expect(err.recoverable).toBe(true);
    // The unfinished partial text must be cleared before the terminal so it
    // stands alone instead of trailing a half sentence.
    const clearIndex = sentEvents.findIndex((e) => e.type === "clear");
    const errorIndex = sentEvents.findIndex((e) => e.type === "error");
    expect(clearIndex).toBeGreaterThanOrEqual(0);
    expect(clearIndex).toBeLessThan(errorIndex);
  });

  it("does NOT emit a give-up terminal when the turn finishes cleanly", async () => {
    // A normal completion (no soft-timeout, no resumable error) must never emit
    // the give-up terminal — that would falsely tell the user it stopped early.
    const sentEvents: AgentChatEvent[] = [];
    mockRunAgentLoop.mockResolvedValue({
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: "test-model",
    });

    await runAgentLoopDirectWithSoftTimeout(
      makeOpts(
        [{ role: "user", content: [{ type: "text", text: "go" }] }],
        new AbortController().signal,
        (event) => sentEvents.push(event),
      ),
      60_000,
    );

    expect(sentEvents.some((e) => e.type === "error")).toBe(false);
  });

  it("does NOT emit a give-up terminal when the user aborts mid-loop", async () => {
    // User pressed Stop: the loop exits because upstreamSignal aborted, not
    // because the budget ran out. Staying silent here avoids a spurious
    // "stopped before finishing" on an intentional cancellation.
    const upstream = new AbortController();
    const sentEvents: AgentChatEvent[] = [];
    let attempts = 0;
    mockRunAgentLoop.mockImplementation(async () => {
      attempts++;
      // First attempt errors with a resumable error but ALSO aborts upstream,
      // so the continuation branch is skipped and the loop exits via the
      // while-condition rather than the budget.
      upstream.abort();
      throw new Error("socket hang up");
    });

    await expect(
      runAgentLoopDirectWithSoftTimeout(
        makeOpts(
          [{ role: "user", content: [{ type: "text", text: "go" }] }],
          upstream.signal,
          (event) => sentEvents.push(event),
        ),
        60_000,
      ),
    ).rejects.toThrow("socket hang up");

    expect(attempts).toBe(1);
    expect(sentEvents.some((e) => e.type === "error")).toBe(false);
  });

  it("stops resuming when the upstream signal aborts mid-loop", async () => {
    // When the upstream signal aborts during a recovery attempt, the error
    // is rethrown rather than swallowed: a caller cancellation should
    // surface, not be hidden behind a transient transport error.
    const upstream = new AbortController();
    let attempts = 0;
    mockRunAgentLoop.mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        upstream.abort();
        throw new EngineError("Builder gateway timed out", {
          errorCode: "builder_gateway_timeout",
        });
      }
      throw new Error("should not reach second attempt");
    });

    await expect(
      runAgentLoopDirectWithSoftTimeout(
        makeOpts(
          [{ role: "user", content: [{ type: "text", text: "go" }] }],
          upstream.signal,
        ),
        60_000,
      ),
    ).rejects.toThrow("Builder gateway timed out");

    expect(attempts).toBe(1);
  });

  it("returns success straight through when no error and no soft timeout", async () => {
    mockRunAgentLoop.mockResolvedValue({
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      model: "test-model",
    });

    const usage = await runAgentLoopDirectWithSoftTimeout(
      makeOpts(
        [{ role: "user", content: [{ type: "text", text: "go" }] }],
        new AbortController().signal,
      ),
      60_000,
    );

    expect(mockRunAgentLoop).toHaveBeenCalledTimes(1);
    expect(usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      model: "test-model",
    });
  });

  // Fix 4: emit 'clear' before resumable-error continuation
  it("emits a clear event before resuming after a resumable engine error", async () => {
    // The partial text was already streamed to the client but the model needs
    // to re-generate from the beginning of the sentence. Without 'clear' the
    // fold duplicates the streamed text inside one assistant message.
    const sentEvents: import("./types.js").AgentChatEvent[] = [];
    let attempts = 0;

    mockRunAgentLoop.mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw new EngineError("Builder gateway timed out after 45s", {
          errorCode: "builder_gateway_timeout",
        });
      }
      return {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "test-model",
      };
    });

    await runAgentLoopDirectWithSoftTimeout(
      makeOpts(
        [{ role: "user", content: [{ type: "text", text: "go" }] }],
        new AbortController().signal,
        (event) => sentEvents.push(event),
      ),
      60_000,
    );

    expect(attempts).toBe(2);
    // A 'clear' event must have been emitted before the second attempt.
    expect(sentEvents).toContainEqual({ type: "clear" });
    // It must appear before the continuation message is appended (i.e. sent
    // while retrying, not after).
    const clearIndex = sentEvents.findIndex((e) => e.type === "clear");
    expect(clearIndex).toBeGreaterThanOrEqual(0);
  });

  it("does not emit clear when there is no resumable error", async () => {
    const sentEvents: import("./types.js").AgentChatEvent[] = [];

    mockRunAgentLoop.mockResolvedValue({
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: "test-model",
    });

    await runAgentLoopDirectWithSoftTimeout(
      makeOpts(
        [{ role: "user", content: [{ type: "text", text: "go" }] }],
        new AbortController().signal,
        (event) => sentEvents.push(event),
      ),
      60_000,
    );

    expect(sentEvents.filter((e) => e.type === "clear")).toHaveLength(0);
  });

  // ─── Per-turn tool-call journal on resume ─────────────────────────────────

  it("injects a structured journal note on resume listing completed and interrupted tool calls", async () => {
    // Ledger from the interrupted attempt: sendEmail completed, createTicket
    // started but never recorded a result.
    mockGetCurrentTurnEventsForThread.mockResolvedValue([
      { type: "tool_start", tool: "sendEmail", input: { to: "a@example.com" } },
      { type: "tool_done", tool: "sendEmail", result: "Email sent (msg_123)" },
      { type: "tool_start", tool: "createTicket", input: { title: "Bug" } },
    ]);

    let attempts = 0;
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
    ];
    mockRunAgentLoop.mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw new EngineError("Builder gateway timed out", {
          errorCode: "builder_gateway_timeout",
        });
      }
      return {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "test-model",
      };
    });

    await runAgentLoopDirectWithSoftTimeout(
      makeOpts(messages, new AbortController().signal, undefined, "thread-1"),
      60_000,
    );

    expect(attempts).toBe(2);
    expect(mockGetCurrentTurnEventsForThread).toHaveBeenCalledWith("thread-1");

    const journalNote = messages
      .map((m) => (m.content[0]?.type === "text" ? m.content[0].text : ""))
      .find((t) =>
        t.includes("Tool-call journal from the interrupted attempt"),
      );
    expect(journalNote).toBeDefined();
    const text = journalNote as string;
    expect(text).toContain("Already completed");
    expect(text).toContain("do NOT re-run");
    expect(text).toContain("sendEmail");
    expect(text).toContain("Email sent (msg_123)");
    expect(text).toContain("Interrupted / unknown outcome");
    expect(text).toContain("createTicket");

    // The standard continuation nudge must still be present (journal is additive).
    const continuationNote = messages
      .map((m) => (m.content[0]?.type === "text" ? m.content[0].text : ""))
      .find((t) => t.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT));
    expect(continuationNote).toBeDefined();
  });

  it("does not inject a journal note on resume when the turn had no tool calls", async () => {
    // No tool activity in the ledger → no structured note, so resume behavior is
    // unchanged from before this feature.
    mockGetCurrentTurnEventsForThread.mockResolvedValue([
      { type: "text", text: "partial answer" },
    ]);

    let attempts = 0;
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
    ];
    mockRunAgentLoop.mockImplementation(async () => {
      attempts++;
      if (attempts === 1) throw new Error("socket hang up");
      return {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "test-model",
      };
    });

    await runAgentLoopDirectWithSoftTimeout(
      makeOpts(messages, new AbortController().signal, undefined, "thread-2"),
      60_000,
    );

    expect(attempts).toBe(2);
    const journalNote = messages
      .map((m) => (m.content[0]?.type === "text" ? m.content[0].text : ""))
      .find((t) =>
        t.includes("Tool-call journal from the interrupted attempt"),
      );
    expect(journalNote).toBeUndefined();

    // Exactly the standard continuation nudge was appended (one extra message).
    expect(messages).toHaveLength(2);
  });

  it("does not read the journal when no threadId is provided", async () => {
    let attempts = 0;
    mockRunAgentLoop.mockImplementation(async () => {
      attempts++;
      if (attempts === 1) throw new Error("socket hang up");
      return {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "test-model",
      };
    });

    await runAgentLoopDirectWithSoftTimeout(
      makeOpts(
        [{ role: "user", content: [{ type: "text", text: "go" }] }],
        new AbortController().signal,
      ),
      60_000,
    );

    expect(attempts).toBe(2);
    expect(mockGetCurrentTurnEventsForThread).not.toHaveBeenCalled();
  });

  it("still resumes when the journal ledger read throws", async () => {
    mockGetCurrentTurnEventsForThread.mockRejectedValue(
      new Error("db unavailable"),
    );

    let attempts = 0;
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
    ];
    mockRunAgentLoop.mockImplementation(async () => {
      attempts++;
      if (attempts === 1) throw new Error("socket hang up");
      return {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "test-model",
      };
    });

    // A failed ledger read must not break the recovery — the resume still runs.
    await runAgentLoopDirectWithSoftTimeout(
      makeOpts(messages, new AbortController().signal, undefined, "thread-3"),
      60_000,
    );

    expect(attempts).toBe(2);
    const continuationNote = messages
      .map((m) => (m.content[0]?.type === "text" ? m.content[0].text : ""))
      .find((t) => t.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT));
    expect(continuationNote).toBeDefined();
  });
});
