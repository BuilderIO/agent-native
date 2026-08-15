import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { EngineError } from "./engine/types.js";
import type { EngineMessage } from "./engine/types.js";
import {
  AGENT_INTERNAL_CONTINUE_PROMPT,
  appendAgentLoopContinuation,
  isResumableEngineError,
  isTransientProviderRateLimitError,
  continuationReasonForResumableError,
  runAgentLoop,
  type AgentLoopOutcome,
} from "./production-agent.js";
import {
  AGENT_INTERNAL_CONTINUATION_CHECKPOINT_PROMPT,
  runAgentLoopDirectWithSoftTimeout,
  BACKGROUND_RATE_LIMIT_CONTINUATION_DELAY_MS,
  MAX_BACKGROUND_RATE_LIMIT_CONTINUATIONS,
  MAX_BACKGROUND_RUN_LOOP_CONTINUATIONS,
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
  outcomes?: AgentLoopOutcome[],
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
    ...(outcomes
      ? { onOutcome: (outcome: AgentLoopOutcome) => outcomes.push(outcome) }
      : {}),
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

  it("recognizes Anthropic bare 'Connection error.' as resumable", () => {
    expect(isResumableEngineError(new Error("Connection error."))).toBe(true);
    expect(
      isResumableEngineError(
        new EngineError("Connection error.", {
          errorCode: "provider_network_error",
        }),
      ),
    ).toBe(true);
  });

  it("recognizes retry-wrapped OpenAI TLS failures as resumable", () => {
    expect(
      isResumableEngineError(
        new Error(
          "Failed after 2 attempts. Last error: Cannot connect to API: " +
            "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR tlsv1 alert internal error",
        ),
      ),
    ).toBe(true);
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

describe("isTransientProviderRateLimitError", () => {
  it("recognizes structured transient provider limits", () => {
    expect(
      isTransientProviderRateLimitError(
        new EngineError("rate limited", { statusCode: 429 }),
      ),
    ).toBe(true);
    expect(
      isTransientProviderRateLimitError(
        new EngineError("overloaded", { errorCode: "http_529" }),
      ),
    ).toBe(true);
    expect(
      isTransientProviderRateLimitError(new Error("429 status code (no body)")),
    ).toBe(false);
  });

  it("does not turn a hard daily cap into a continuation loop", () => {
    expect(
      isTransientProviderRateLimitError(
        new EngineError("Daily gateway request cap reached", {
          errorCode: "rate_limit_exceeded",
          statusCode: 429,
        }),
      ),
    ).toBe(false);
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
    const seenRequestTexts: Array<string | undefined> = [];
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
    ];

    mockRunAgentLoop.mockImplementation(async (opts) => {
      attempts++;
      seenRequestTexts.push(opts.finalResponseGuardRequestText);
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
    expect(seenRequestTexts).toEqual(["go", "go"]);
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

  it("carries an interrupted streamed prefix into the resume context", async () => {
    let attempts = 0;
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "make a list" }] },
    ];

    mockRunAgentLoop.mockImplementation(async (opts) => {
      attempts++;
      if (attempts === 1) {
        opts.send({ type: "text", text: "Here are the first three items: " });
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

    await runAgentLoopDirectWithSoftTimeout(
      makeOpts(messages, new AbortController().signal),
      60_000,
    );

    const checkpoint = messages.find(
      (message) =>
        message.role === "assistant" &&
        message.content.some(
          (part) =>
            part.type === "text" &&
            part.text.startsWith(AGENT_INTERNAL_CONTINUATION_CHECKPOINT_PROMPT),
        ),
    );
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Here are the first three items:"),
    });
    expect(
      messages.some(
        (message) =>
          message.role === "user" &&
          message.content.some(
            (part) =>
              part.type === "text" &&
              part.text.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT),
          ),
      ),
    ).toBe(true);
  });

  it("includes unfinished action-preparation guidance on foreground resume", async () => {
    let attempts = 0;
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
    ];
    mockGetCurrentTurnEventsForThread.mockResolvedValue([]);

    mockRunAgentLoop.mockImplementation(async (opts) => {
      attempts++;
      if (attempts === 1) {
        opts.send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "tool-1",
          progressBytes: 0,
        });
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

    await runAgentLoopDirectWithSoftTimeout(
      makeOpts(messages, new AbortController().signal, undefined, "thread-1"),
      60_000,
    );

    expect(attempts).toBe(2);
    const continuationText = messages
      .map((m) => (m.content[0]?.type === "text" ? m.content[0].text : ""))
      .find((t) => t.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT));
    expect(continuationText).toContain("upstream gateway timeout");
    expect(continuationText).toContain(
      "preparing the `edit-design` action input",
    );
    expect(continuationText).toContain("smaller `edit-design` payload");
  });

  it("continues internally when runAgentLoop checkpoints for no-progress action preparation", async () => {
    let attempts = 0;
    const sentEvents: AgentChatEvent[] = [];
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
    ];
    mockGetCurrentTurnEventsForThread.mockResolvedValue([]);

    mockRunAgentLoop.mockImplementation(async (opts) => {
      attempts++;
      if (attempts === 1) {
        opts.send({
          type: "text",
          text: "partial lead-in",
        });
        opts.send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "tool-1",
          progressBytes: 0,
        });
        opts.send({
          type: "auto_continue",
          reason: "no_progress",
        });
        return {
          inputTokens: 7,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "test-model",
        };
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
      makeOpts(
        messages,
        new AbortController().signal,
        (event) => sentEvents.push(event),
        "thread-1",
      ),
      60_000,
    );

    expect(attempts).toBe(2);
    expect(usage.inputTokens).toBe(107);
    const autoContinueIndex = sentEvents.findIndex(
      (event) => event.type === "auto_continue",
    );
    const clearIndex = sentEvents.findIndex((event) => event.type === "clear");
    expect(autoContinueIndex).toBeGreaterThanOrEqual(0);
    expect(clearIndex).toBeGreaterThan(autoContinueIndex);
    const continuationText = messages
      .map((m) => (m.content[0]?.type === "text" ? m.content[0].text : ""))
      .find((t) => t.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT));
    expect(continuationText).toContain(
      "stopped producing progress events while the connection stayed open",
    );
    expect(continuationText).toContain(
      "preparing the `edit-design` action input",
    );
    expect(continuationText).toContain("smaller `edit-design` payload");
    expect(
      messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content.some(
            (part) =>
              part.type === "text" && part.text.includes("partial lead-in"),
          ),
      ),
    ).toBe(true);
  });

  it("does not report an unmeasured run as a measured empty one", async () => {
    mockRunAgentLoop.mockResolvedValue({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: "test-model",
    });

    const usage = await runAgentLoopDirectWithSoftTimeout(
      makeOpts(
        [{ role: "user", content: [{ type: "text", text: "go" }] }],
        new AbortController().signal,
      ),
      60_000,
    );

    expect(usage.usageReported).toBeFalsy();
    expect(usage.firstEngineEventAtMs).toBeUndefined();
  });

  it("keeps a reported attempt's usage flag and first-event timing across a continuation", async () => {
    let attempts = 0;
    mockRunAgentLoop.mockImplementation(async (opts) => {
      attempts++;
      if (attempts === 1) {
        opts.send({ type: "auto_continue", reason: "no_progress" });
        return {
          inputTokens: 7,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "test-model",
          usageReported: true,
          firstEngineEventAtMs: 1234,
        };
      }
      return {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "test-model",
      };
    });

    const usage = await runAgentLoopDirectWithSoftTimeout(
      makeOpts(
        [{ role: "user", content: [{ type: "text", text: "go" }] }],
        new AbortController().signal,
        () => {},
        "thread-1",
      ),
      60_000,
    );

    expect(attempts).toBe(2);
    expect(usage.usageReported).toBe(true);
    expect(usage.firstEngineEventAtMs).toBe(1234);
  });

  it("allows direct callers to use the background-function timeout regime", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("NETLIFY", "true");
      vi.stubEnv("AGENT_RUN_SOFT_TIMEOUT_MS", "900000");
      let seenSignal: AbortSignal | null = null;
      const outcomes: AgentLoopOutcome[] = [];
      const upstream = new AbortController();
      mockRunAgentLoop.mockImplementation(async (opts) => {
        seenSignal = opts.signal;
        return new Promise((resolve) => {
          opts.signal.addEventListener("abort", () =>
            resolve({
              inputTokens: 1,
              outputTokens: 1,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              model: "test-model",
            }),
          );
        });
      });

      const usagePromise = runAgentLoopDirectWithSoftTimeout(
        makeOpts(
          [{ role: "user", content: [{ type: "text", text: "go" }] }],
          upstream.signal,
          undefined,
          undefined,
          outcomes,
        ),
        undefined,
        { backgroundFunction: true },
      );

      await vi.advanceTimersByTimeAsync(40_000);
      expect(seenSignal?.aborted).toBe(false);
      upstream.abort();
      const usage = await usagePromise;

      expect(usage.inputTokens).toBe(1);
      expect(mockRunAgentLoop).toHaveBeenCalledOnce();
      expect(outcomes).toEqual([
        { state: "canceled", message: "Agent run was aborted." },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a proven background delegated run finish after the foreground continuation cap", async () => {
    const sentEvents: AgentChatEvent[] = [];
    const outcomes: AgentLoopOutcome[] = [];
    let attempts = 0;
    mockRunAgentLoop.mockImplementation(async (opts) => {
      attempts++;
      if (attempts <= MAX_RUN_LOOP_CONTINUATIONS) {
        opts.send({ type: "auto_continue", reason: "stream_ended" });
        return {
          inputTokens: 1,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "test-model",
        };
      }
      opts.send({ type: "text", text: "finished" });
      opts.onOutcome?.({ state: "completed" });
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
        (event) => sentEvents.push(event),
        undefined,
        outcomes,
      ),
      60_000,
      { backgroundFunction: true },
    );

    expect(attempts).toBe(MAX_RUN_LOOP_CONTINUATIONS + 1);
    expect(attempts).toBeLessThan(MAX_BACKGROUND_RUN_LOOP_CONTINUATIONS);
    expect(sentEvents.some((event) => event.type === "error")).toBe(false);
    expect(outcomes).toEqual([{ state: "completed" }]);
  });

  it("stops early instead of gambling a 2nd in-process round past the elapsed budget", async () => {
    // A hosted A2A/MCP call is one serverless invocation; timeoutMs is sized
    // to survive ONCE. If round 1 genuinely consumes the whole window, round
    // 2 must not get a fresh full window on top of it — it must see there's
    // no safe budget left and give up cleanly instead of risking a platform
    // hard-kill mid-stream. Round 1 uses the full budget (matches prior
    // behavior); a would-be round 2 is skipped because 10_000 - 10_000 = 0 <
    // SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS (8_000).
    vi.useFakeTimers();
    try {
      const sentEvents: AgentChatEvent[] = [];
      let attempts = 0;
      mockRunAgentLoop.mockImplementation(async (opts) => {
        attempts++;
        return new Promise((resolve) => {
          opts.signal.addEventListener("abort", () =>
            resolve({
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              model: "test-model",
            }),
          );
        });
      });

      const usagePromise = runAgentLoopDirectWithSoftTimeout(
        makeOpts(
          [{ role: "user", content: [{ type: "text", text: "go" }] }],
          new AbortController().signal,
          (event) => sentEvents.push(event),
        ),
        10_000,
      );

      await vi.advanceTimersByTimeAsync(10_000);
      await usagePromise;

      expect(attempts).toBe(1);
      const terminal = sentEvents.find((e) => e.type === "error");
      expect(terminal).toMatchObject({
        type: "error",
        errorCode: RUN_BUDGET_EXHAUSTED_ERROR_CODE,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("still allows the full MAX_RUN_LOOP_CONTINUATIONS rounds when rounds finish fast (plenty of budget left each time)", async () => {
    // The common real-world case: most rounds finish well under the soft
    // timeout, so cumulative elapsed time stays low and every attempt keeps
    // its full per-round budget — unchanged from before this fix.
    let attempts = 0;
    mockRunAgentLoop.mockImplementation(async () => {
      attempts++;
      throw new Error("socket hang up");
    });

    await runAgentLoopDirectWithSoftTimeout(
      makeOpts(
        [{ role: "user", content: [{ type: "text", text: "go" }] }],
        new AbortController().signal,
      ),
      60_000,
    );

    expect(attempts).toBe(MAX_RUN_LOOP_CONTINUATIONS);
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

  it("gives a background delegated run one cooled-down continuation after exhausted provider 429 retries", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const outcomes: AgentLoopOutcome[] = [];
      const messages: EngineMessage[] = [
        { role: "user", content: [{ type: "text", text: "go" }] },
      ];
      mockRunAgentLoop.mockImplementation(async (opts) => {
        attempts++;
        if (attempts === 1) {
          throw new EngineError("429 status code (no body)", {
            errorCode: "http_429",
            statusCode: 429,
          });
        }
        opts.onOutcome?.({ state: "completed" });
        return {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "test-model",
        };
      });

      const run = runAgentLoopDirectWithSoftTimeout(
        makeOpts(
          messages,
          new AbortController().signal,
          undefined,
          undefined,
          outcomes,
        ),
        60_000,
        { backgroundFunction: true },
      );
      await vi.advanceTimersByTimeAsync(
        BACKGROUND_RATE_LIMIT_CONTINUATION_DELAY_MS,
      );
      await run;

      expect(attempts).toBe(2);
      expect(outcomes).toEqual([{ state: "completed" }]);
      const continuationText = messages
        .map((message) =>
          message.content[0]?.type === "text" ? message.content[0].text : "",
        )
        .find((text) => text.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT));
      expect(continuationText).toContain("temporarily rate limited");
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps background provider-rate-limit continuation instead of storming requests", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      mockRunAgentLoop.mockImplementation(async () => {
        attempts++;
        throw new EngineError("429 status code (no body)", {
          errorCode: "http_429",
          statusCode: 429,
        });
      });

      const run = runAgentLoopDirectWithSoftTimeout(
        makeOpts(
          [{ role: "user", content: [{ type: "text", text: "go" }] }],
          new AbortController().signal,
        ),
        60_000,
        { backgroundFunction: true },
      );
      const rejected = expect(run).rejects.toThrow("429 status code (no body)");
      await vi.advanceTimersByTimeAsync(
        BACKGROUND_RATE_LIMIT_CONTINUATION_DELAY_MS,
      );
      await rejected;

      expect(attempts).toBe(MAX_BACKGROUND_RATE_LIMIT_CONTINUATIONS + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not spend foreground delegated budget on a provider-rate-limit continuation", async () => {
    let attempts = 0;
    mockRunAgentLoop.mockImplementation(async () => {
      attempts++;
      throw new EngineError("429 status code (no body)", {
        errorCode: "http_429",
        statusCode: 429,
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
    ).rejects.toThrow("429 status code (no body)");

    expect(attempts).toBe(1);
  });

  it("rethrows non-resumable terminal errors immediately without continuing", async () => {
    let attempts = 0;
    const outcomes: AgentLoopOutcome[] = [];
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
          undefined,
          undefined,
          outcomes,
        ),
        60_000,
      ),
    ).rejects.toThrow("Conversation has grown too long.");

    expect(attempts).toBe(1);
    expect(outcomes).toEqual([
      {
        state: "failed",
        code: "context_length_exceeded",
        retryable: false,
        message: "Conversation has grown too long.",
      },
    ]);
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
    const outcomes: AgentLoopOutcome[] = [];
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
        undefined,
        outcomes,
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
    expect(err.error).toContain("Check any completed tool cards");
    expect(err.recoverable).toBe(false);
    // The unfinished partial text must be cleared before the terminal so it
    // stands alone instead of trailing a half sentence.
    const clearIndex = sentEvents.findIndex((e) => e.type === "clear");
    const errorIndex = sentEvents.findIndex((e) => e.type === "error");
    expect(clearIndex).toBeGreaterThanOrEqual(0);
    expect(clearIndex).toBeLessThan(errorIndex);
    expect(outcomes).toEqual([
      {
        state: "failed",
        code: RUN_BUDGET_EXHAUSTED_ERROR_CODE,
        retryable: false,
        message: RUN_BUDGET_EXHAUSTED_MESSAGE,
      },
    ]);
  });

  it("preserves completed tool cards when the continuation budget is exhausted after a side effect", async () => {
    const sentEvents: AgentChatEvent[] = [];
    let attempts = 0;
    mockGetCurrentTurnEventsForThread.mockResolvedValue([
      { type: "tool_start", tool: "generate-design", input: { id: "d1" } },
      {
        type: "tool_done",
        tool: "generate-design",
        input: { id: "d1" },
        result: '{"designId":"d1"}',
        completedSideEffect: true,
      },
    ]);
    mockRunAgentLoop.mockImplementation(async (opts) => {
      attempts++;
      if (attempts === 1) {
        opts.send({
          type: "tool_start",
          tool: "generate-design",
          input: { id: "d1" },
        });
        opts.send({
          type: "tool_done",
          tool: "generate-design",
          input: { id: "d1" },
          result: '{"designId":"d1"}',
          completedSideEffect: true,
        });
      }
      throw new Error("socket hang up");
    });

    await runAgentLoopDirectWithSoftTimeout(
      makeOpts(
        [{ role: "user", content: [{ type: "text", text: "go" }] }],
        new AbortController().signal,
        (event) => sentEvents.push(event),
        "thread-1",
      ),
      60_000,
    );

    expect(attempts).toBe(MAX_RUN_LOOP_CONTINUATIONS);
    const terminal = sentEvents.find((e) => e.type === "error");
    expect(terminal).toMatchObject({
      type: "error",
      errorCode: RUN_BUDGET_EXHAUSTED_ERROR_CODE,
    });
    expect(sentEvents.some((event) => event.type === "clear")).toBe(false);
    expect(sentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_done",
          tool: "generate-design",
          completedSideEffect: true,
        }),
      ]),
    );
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
    const outcomes: AgentLoopOutcome[] = [];
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
          undefined,
          outcomes,
        ),
        60_000,
      ),
    ).rejects.toThrow("socket hang up");

    expect(attempts).toBe(1);
    expect(sentEvents.some((e) => e.type === "error")).toBe(false);
    expect(outcomes).toEqual([
      { state: "canceled", message: "Agent run was aborted." },
    ]);
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
    const outcomes: AgentLoopOutcome[] = [];
    mockRunAgentLoop.mockImplementation(async (opts) => {
      opts.onOutcome?.({ state: "completed" });
      return {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        model: "test-model",
      };
    });

    const usage = await runAgentLoopDirectWithSoftTimeout(
      makeOpts(
        [{ role: "user", content: [{ type: "text", text: "go" }] }],
        new AbortController().signal,
        undefined,
        undefined,
        outcomes,
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
    expect(outcomes).toEqual([{ state: "completed" }]);
  });

  it("overrides an inner completed outcome for an unfinished direct auto-continuation", async () => {
    const outcomes: AgentLoopOutcome[] = [];
    mockRunAgentLoop.mockImplementation(async (opts) => {
      opts.send({ type: "auto_continue", reason: "stream_ended" });
      opts.onOutcome?.({ state: "completed" });
      return {
        inputTokens: 1,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "test-model",
      };
    });

    await runAgentLoopDirectWithSoftTimeout(
      makeOpts(
        [{ role: "user", content: [{ type: "text", text: "go" }] }],
        new AbortController().signal,
        undefined,
        undefined,
        outcomes,
      ),
      0,
    );

    expect(outcomes).toEqual([
      {
        state: "failed",
        code: "stream_ended",
        retryable: false,
        message: "Agent stopped before finishing (stream_ended).",
      },
    ]);
  });

  it("classifies terminal failures even when continuation recovery is disabled", async () => {
    const outcomes: AgentLoopOutcome[] = [];
    mockRunAgentLoop.mockRejectedValue(
      new EngineError("Missing API key", {
        errorCode: "missing_credentials",
      }),
    );

    await expect(
      runAgentLoopDirectWithSoftTimeout(
        makeOpts(
          [{ role: "user", content: [{ type: "text", text: "go" }] }],
          new AbortController().signal,
          undefined,
          undefined,
          outcomes,
        ),
        0,
      ),
    ).rejects.toThrow("Missing API key");

    expect(outcomes).toEqual([
      {
        state: "failed",
        code: "missing_credentials",
        retryable: false,
        message: "Missing API key",
      },
    ]);
  });

  it("classifies cancellation even when continuation recovery is disabled", async () => {
    const upstream = new AbortController();
    const outcomes: AgentLoopOutcome[] = [];
    mockRunAgentLoop.mockImplementation(async () => {
      upstream.abort();
      throw new Error("aborted");
    });

    await expect(
      runAgentLoopDirectWithSoftTimeout(
        makeOpts(
          [{ role: "user", content: [{ type: "text", text: "go" }] }],
          upstream.signal,
          undefined,
          undefined,
          outcomes,
        ),
        0,
      ),
    ).rejects.toThrow("aborted");

    expect(outcomes).toEqual([
      { state: "canceled", message: "Agent run was aborted." },
    ]);
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

  it("keeps user-visible output when the ledger read fails mid-recovery", async () => {
    // `clear` WIPES what the user already sees. A ledger blip must not be read
    // as "no completed side effect", which is what made it wipe tool cards.
    mockGetCurrentTurnEventsForThread.mockRejectedValue(
      new Error("neon: connection lost"),
    );
    const sentEvents: import("./types.js").AgentChatEvent[] = [];
    let attempts = 0;
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
      makeOpts(
        [{ role: "user", content: [{ type: "text", text: "go" }] }],
        new AbortController().signal,
        (event) => sentEvents.push(event),
        "thread-1",
      ),
      60_000,
    );

    expect(attempts).toBe(2);
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
    expect(mockGetCurrentTurnEventsForThread).toHaveBeenCalledWith(
      "thread-1",
      undefined,
    );

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

  it("keeps completed tool nextRequiredAction guidance visible on resume", async () => {
    mockGetCurrentTurnEventsForThread.mockResolvedValue([
      {
        type: "tool_start",
        tool: "get-design-snapshot",
        input: { designId: "design-1", fileId: "file-1" },
      },
      {
        type: "tool_done",
        tool: "get-design-snapshot",
        input: { designId: "design-1", fileId: "file-1" },
        result: JSON.stringify({
          files: [{ id: "file-1", content: "x".repeat(2000) }],
          nextRequiredAction:
            "Call edit-design exactly once with designId design-1 and fileId file-1. Do not call get-design-snapshot again.",
        }),
      },
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
    const journalNote = messages
      .map((m) => (m.content[0]?.type === "text" ? m.content[0].text : ""))
      .find((t) =>
        t.includes("Tool-call journal from the interrupted attempt"),
      );
    expect(journalNote).toContain("Next required action from result");
    expect(journalNote).toContain("Call edit-design exactly once");
    expect(journalNote).toContain("Do not call get-design-snapshot again");
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
