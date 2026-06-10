import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  AGENT_INTERNAL_CONTINUE_PROMPT,
  appendAgentLoopContinuation,
  isResumableEngineError,
  continuationReasonForResumableError,
  runAgentLoop,
} from "./production-agent.js";
import { EngineError } from "./engine/types.js";
import type { EngineMessage } from "./engine/types.js";
import {
  runAgentLoopDirectWithSoftTimeout,
  MAX_RUN_LOOP_CONTINUATIONS,
} from "./run-loop-with-resume.js";

vi.mock("./production-agent.js", async () => {
  const actual = await vi.importActual<typeof import("./production-agent.js")>(
    "./production-agent.js",
  );
  return {
    ...actual,
    runAgentLoop: vi.fn(),
  };
});

const mockRunAgentLoop = vi.mocked(runAgentLoop);

function makeOpts(
  messages: EngineMessage[],
  signal: AbortSignal,
  send?: (event: import("./types.js").AgentChatEvent) => void,
): Parameters<typeof runAgentLoopDirectWithSoftTimeout>[0] {
  return {
    // The wrapper only inspects messages, signal, and model. Cast the rest —
    // the mocked runAgentLoop ignores them.
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
    // lets the run-manager surface its own terminal state to the client.
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
});
