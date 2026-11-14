import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveOwnerEngineApiKey: vi.fn(),
}));

vi.mock("../agent/production-agent.js", () => ({
  resolveOwnerEngineApiKey: mocks.resolveOwnerEngineApiKey,
}));

import type {
  AgentEngine,
  EngineStreamOptions,
} from "../agent/engine/index.js";
import { PrivateCompletionError } from "../agent/engine/private-completion-error.js";
import { ProviderAuthenticationError } from "../agent/engine/provider-auth-error.js";
import {
  startModelDispatch,
  type BeforeModelDispatch,
} from "../agent/engine/types.js";
import { completeText } from "./complete-text.js";

function createFakeEngine(
  stream: (opts: EngineStreamOptions) => AsyncIterable<any>,
): AgentEngine {
  return {
    name: "fake",
    label: "Fake",
    defaultModel: "fake-default",
    supportedModels: ["fake-default", "fake-override"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    stream,
  };
}

describe("completeText", () => {
  it("preserves failures while resolving the active engine setting", async () => {
    const error = new Error("Unable to read the active agent engine setting");
    mocks.resolveOwnerEngineApiKey.mockRejectedValueOnce(error);

    await expect(
      completeText({
        engine: createFakeEngine(async function* () {
          yield { type: "stop", reason: "end_turn" };
        }),
        input: "Summarize this.",
      }),
    ).rejects.toBe(error);
  });

  it("runs one tool-free engine call and returns final assistant text", async () => {
    const calls: EngineStreamOptions[] = [];
    const engine = createFakeEngine(async function* (opts) {
      calls.push(opts);
      yield { type: "text-delta", text: "draft" };
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "final" }],
      };
      yield {
        type: "usage",
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8,
      };
      yield { type: "stop", reason: "end_turn" };
    });

    const result = await completeText({
      engine,
      model: "fake-override",
      systemPrompt: "Be terse.",
      input: "Summarize this.",
      apiKey: "test-key",
      maxOutputTokens: 128,
      temperature: 0,
    });

    expect(result).toMatchObject({
      text: "final",
      engine: "fake",
      model: "fake-override",
      stopReason: "end_turn",
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "fake-override",
      systemPrompt: "Be terse.",
      tools: [],
      maxOutputTokens: 128,
      temperature: 0,
    });
    expect(calls[0]?.messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Summarize this." }],
      },
    ]);
  });

  it("falls back to streamed text when no assistant-content arrives", async () => {
    const engine = createFakeEngine(async function* () {
      yield { type: "text-delta", text: "hello " };
      yield { type: "text-delta", text: "world" };
      yield { type: "stop", reason: "end_turn" };
    });

    const result = await completeText({
      engine,
      input: "Say hi.",
      apiKey: "test-key",
    });

    expect(result.text).toBe("hello world");
    expect(result.content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("appends input after explicit messages", async () => {
    const calls: EngineStreamOptions[] = [];
    const engine = createFakeEngine(async function* (opts) {
      calls.push(opts);
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "ok" }],
      };
      yield { type: "stop", reason: "end_turn" };
    });

    await completeText({
      engine,
      messages: [
        { role: "user", content: "Classify this." },
        { role: "assistant", content: "Ready." },
      ],
      input: "urgent",
      apiKey: "test-key",
    });

    expect(calls[0]?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Classify this." }] },
      { role: "assistant", content: [{ type: "text", text: "Ready." }] },
      { role: "user", content: [{ type: "text", text: "urgent" }] },
    ]);
  });

  it("leaves the provider untouched when beforeModelDispatch denies after a delayed resolution", async () => {
    const order: string[] = [];
    const providerCalls: string[] = [];
    const scope = { admitted: true };

    const engine = createFakeEngine(async function* (opts) {
      // Real generic dispatch wrapper: the fake provider only runs when the
      // forwarded hook admits the dispatch.
      const dispatch = await startModelDispatch(opts, () => {
        order.push("dispatch");
        providerCalls.push("called");
        return "provider-result";
      });
      if (!dispatch.started) {
        order.push("denied");
        return;
      }
      order.push("started");
      yield { type: "text-delta", text: "partial" };
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "final" }],
      };
      yield { type: "stop", reason: "end_turn" };
    });

    const beforeModelDispatch: BeforeModelDispatch = async (dispatch) => {
      order.push("hook");
      // Delayed resolution: the scope changes while the guard is pending.
      await new Promise((resolve) => setTimeout(resolve, 0));
      scope.admitted = false;
      if (!scope.admitted) return { started: false };
      return { started: true, value: dispatch() };
    };

    const result = await completeText({
      engine,
      input: "Summarize this.",
      apiKey: "test-key",
      beforeModelDispatch,
    });

    expect(order).toEqual(["hook", "denied"]);
    expect(providerCalls).toEqual([]);
    expect(result.text).toBe("");
    expect(result.content).toEqual([{ type: "text", text: "" }]);
    expect(result.stopReason).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });

  it("rechecks scope after delayed credential resolution before dispatch", async () => {
    const order: string[] = [];
    let releaseOwner!: () => void;
    const ownerReady = new Promise<void>((resolve) => {
      releaseOwner = resolve;
    });
    mocks.resolveOwnerEngineApiKey.mockImplementationOnce(async () => {
      order.push("owner:pending");
      await ownerReady;
      order.push("owner:resolved");
      return { apiKey: "test-key", apiKeyEnvVar: "ANTHROPIC_API_KEY" };
    });
    let selected = true;
    const provider = vi.fn(() => "unexpected dispatch");
    const started = vi.fn();
    const engine = createFakeEngine(async function* (opts) {
      const decision = await startModelDispatch(opts, provider);
      if (!decision.started) return;
      yield { type: "text-delta", text: "unexpected partial output" };
      yield { type: "stop", reason: "end_turn" };
    });
    const beforeModelDispatch: BeforeModelDispatch = async (dispatch) => {
      order.push("guard");
      return selected
        ? { started: true, value: dispatch() }
        : { started: false };
    };
    const pending = completeText({
      engine,
      model: "fake-default",
      input: "Synthetic selected content",
      beforeModelDispatch,
      onModelDispatchStarted: started,
    });
    await Promise.resolve();
    expect(order).toEqual(["owner:pending"]);
    selected = false;
    releaseOwner();
    const result = await pending;
    expect(order).toEqual(["owner:pending", "owner:resolved", "guard"]);
    expect(provider).not.toHaveBeenCalled();
    expect(started).not.toHaveBeenCalled();
    expect(result.text).toBe("");
    expect(result.content).toEqual([{ type: "text", text: "" }]);
  });

  it("orders hook resolution, provider dispatch, and started notification like startModelDispatch", async () => {
    const order: string[] = [];

    const engine = createFakeEngine(async function* (opts) {
      const dispatch = await startModelDispatch(opts, () => {
        order.push("dispatch");
        return "provider-result";
      });
      if (!dispatch.started) {
        order.push("denied");
        return;
      }
      order.push(`value:${dispatch.value}`);
      yield { type: "stop", reason: "end_turn" };
    });

    const beforeModelDispatch: BeforeModelDispatch = async (dispatch) => {
      order.push("hook:start");
      await Promise.resolve();
      order.push("hook:resolve");
      return { started: true, value: dispatch() };
    };
    const onModelDispatchStarted = vi.fn(() => {
      order.push("started");
    });

    await completeText({
      engine,
      input: "go",
      apiKey: "test-key",
      beforeModelDispatch,
      onModelDispatchStarted,
    });

    expect(order).toEqual([
      "hook:start",
      "hook:resolve",
      "dispatch",
      "started",
      "value:provider-result",
    ]);
    expect(onModelDispatchStarted).toHaveBeenCalledOnce();
  });

  it("propagates a beforeModelDispatch failure before any provider dispatch", async () => {
    const provider = vi.fn(() => "provider-result");
    const onModelDispatchStarted = vi.fn();
    const hookError = new Error("dispatch denied by guard");

    const engine = createFakeEngine(async function* (opts) {
      const dispatch = await startModelDispatch(opts, provider);
      if (!dispatch.started) return;
      yield { type: "stop", reason: "end_turn" };
    });

    const beforeModelDispatch: BeforeModelDispatch = async () => {
      throw hookError;
    };

    await expect(
      completeText({
        engine,
        input: "go",
        apiKey: "test-key",
        beforeModelDispatch,
        onModelDispatchStarted,
      }),
    ).rejects.toBe(hookError);

    expect(provider).not.toHaveBeenCalled();
    expect(onModelDispatchStarted).not.toHaveBeenCalled();
  });

  it("does not add hook keys to engine options when hooks are absent", async () => {
    let seen: EngineStreamOptions | undefined;
    const engine = createFakeEngine(async function* (opts) {
      seen = opts;
      yield { type: "stop", reason: "end_turn" };
    });

    await completeText({ engine, input: "go", apiKey: "test-key" });

    expect(seen).toBeDefined();
    expect("beforeModelDispatch" in (seen as EngineStreamOptions)).toBe(false);
    expect("onModelDispatchStarted" in (seen as EngineStreamOptions)).toBe(
      false,
    );
  });

  it("throws structured engine errors from stop(error)", async () => {
    const engine = createFakeEngine(async function* () {
      yield {
        type: "stop",
        reason: "error",
        error: "quota exceeded",
        errorCode: "credits-limit-monthly",
        statusCode: 402,
      };
    });

    await expect(
      completeText({ engine, input: "Try.", apiKey: "test-key" }),
    ).rejects.toMatchObject({
      name: "EngineError",
      message: "quota exceeded",
      errorCode: "credits-limit-monthly",
      statusCode: 402,
    });
  });

  it("labels its own timeout with a stable error code", async () => {
    const engine = createFakeEngine(async function* (opts) {
      await new Promise<never>((_resolve, reject) => {
        opts.abortSignal.addEventListener(
          "abort",
          () => reject(opts.abortSignal.reason),
          { once: true },
        );
      });
    });

    await expect(
      completeText({
        engine,
        input: "Try.",
        apiKey: "test-key",
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({
      name: "EngineError",
      message: "completeText timed out after 1ms",
      errorCode: "complete_text_timeout",
    });
  });

  it("rejects partial output when the stream ends normally after timeout", async () => {
    const engine = createFakeEngine(async function* (opts) {
      const aborted = new Promise<void>((resolve) => {
        opts.abortSignal.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
      yield { type: "text-delta", text: "partial" };
      await aborted;
    });

    await expect(
      completeText({
        engine,
        input: "Try.",
        apiKey: "test-key",
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({
      name: "EngineError",
      message: "completeText timed out after 1ms",
      errorCode: "complete_text_timeout",
    });
  });

  it("requires input or messages", async () => {
    const engine = createFakeEngine(async function* () {
      yield { type: "stop", reason: "end_turn" };
    });

    await expect(completeText({ engine, apiKey: "test-key" })).rejects.toThrow(
      /requires `input` or at least one message/,
    );
  });
});

/** A synthetic selected body echoed by a hostile provider failure. */
const PRIVATE_CANARY = "canary-private-email-body-9c2f";

function errorSurface(error: unknown): string {
  const err = error as { message?: unknown; stack?: unknown; cause?: unknown };
  return [
    String(err?.message ?? ""),
    String(err?.stack ?? ""),
    String(err?.cause ?? ""),
    JSON.stringify(error),
  ].join("\n");
}

function createPrivateEngine(
  stream: (opts: EngineStreamOptions) => AsyncIterable<any>,
): AgentEngine {
  return { ...createFakeEngine(stream), supportsPrivateContent: true };
}

describe("completeText private content", () => {
  it("preserves the gateway authentication code from an error stop without retaining its body", async () => {
    const engine = {
      ...createPrivateEngine(async function* () {
        yield {
          type: "stop" as const,
          reason: "error" as const,
          errorCode: "builder_auth_error",
          provider: PRIVATE_CANARY,
          statusCode: 401,
          error: PRIVATE_CANARY,
          requestId: PRIVATE_CANARY,
        };
      }),
      name: "builder",
    };
    let failure: unknown;
    try {
      await completeText({
        engine,
        input: PRIVATE_CANARY,
        apiKey: "synthetic",
        privateContent: true,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "builder_auth_error",
      provider: "builder",
      statusCode: 401,
    });
    expect(errorSurface(failure)).not.toContain(PRIVATE_CANARY);
  });
  it("fails closed before dispatch when the engine does not support private content", async () => {
    const dispatched: string[] = [];
    const engine = createFakeEngine(async function* () {
      dispatched.push("called");
      yield { type: "stop", reason: "end_turn" };
    });

    await expect(
      completeText({
        engine,
        input: "Sensitive selected content.",
        apiKey: "test-key",
        privateContent: true,
      }),
    ).rejects.toBeInstanceOf(PrivateCompletionError);

    expect(dispatched).toEqual([]);
  });

  it("does not add privateContent to engine options when it is absent", async () => {
    let seen: EngineStreamOptions | undefined;
    const engine = createFakeEngine(async function* (opts) {
      seen = opts;
      yield { type: "stop", reason: "end_turn" };
    });

    await completeText({ engine, input: "go", apiKey: "test-key" });

    expect(seen).toBeDefined();
    expect("privateContent" in (seen as EngineStreamOptions)).toBe(false);
  });

  it("forwards privateContent only when supplied and the engine advertises support", async () => {
    const seen: EngineStreamOptions[] = [];
    const engine = createPrivateEngine(async function* (opts) {
      seen.push(opts);
      yield { type: "text-delta", text: "generated privately" };
      yield { type: "stop", reason: "end_turn" };
    });

    const result = await completeText({
      engine,
      input: "Sensitive selected content.",
      apiKey: "test-key",
      privateContent: true,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.privateContent).toBe(true);
    expect(result.text).toBe("generated privately");
  });

  it("forwards an explicit false without changing the success result", async () => {
    const seen: EngineStreamOptions[] = [];
    const engine = createPrivateEngine(async function* (opts) {
      seen.push(opts);
      yield { type: "stop", reason: "end_turn" };
    });

    const result = await completeText({
      engine,
      input: "go",
      apiKey: "test-key",
      privateContent: false,
    });

    expect(seen[0]?.privateContent).toBe(false);
    expect(result.text).toBe("");
  });

  it("wraps a credential-resolution failure before the engine name is known", async () => {
    const raw = Object.assign(new Error(`resolution echo ${PRIVATE_CANARY}`), {
      statusCode: 401,
      errorCode: `code_${PRIVATE_CANARY}`,
      requestId: `req_${PRIVATE_CANARY}`,
      upgradeUrl: `https://example.invalid/${PRIVATE_CANARY}`,
      cause: new Error(`cause ${PRIVATE_CANARY}`),
      response: { body: PRIVATE_CANARY },
    });
    mocks.resolveOwnerEngineApiKey.mockRejectedValueOnce(raw);

    let thrown: unknown;
    try {
      await completeText({
        engine: createPrivateEngine(async function* () {
          yield { type: "stop", reason: "end_turn" };
        }),
        input: "Sensitive selected content.",
        privateContent: true,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    const err = thrown as PrivateCompletionError;
    expect(err.provider).toBe("model");
    expect(err.code).toBe("http_401");
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe("The private completion failed.");
    expect((err as { cause?: unknown }).cause).toBeUndefined();
    expect((err as { requestId?: unknown }).requestId).toBeUndefined();
    expect((err as { upgradeUrl?: unknown }).upgradeUrl).toBeUndefined();
    expect(errorSurface(err)).not.toContain(PRIVATE_CANARY);
  });

  it("wraps a stream failure after partial text with no canary retained", async () => {
    const engine = createPrivateEngine(async function* () {
      yield { type: "text-delta", text: PRIVATE_CANARY };
      throw Object.assign(new Error(`stream echo ${PRIVATE_CANARY}`), {
        statusCode: 502,
        errorCode: `ec_${PRIVATE_CANARY}`,
        cause: new Error(PRIVATE_CANARY),
      });
    });

    let thrown: unknown;
    try {
      await completeText({
        engine,
        input: "Sensitive selected content.",
        apiKey: "test-key",
        privateContent: true,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    const err = thrown as PrivateCompletionError;
    expect(err.code).toBe("http_502");
    expect(err.statusCode).toBe(502);
    expect(err.provider).toBe("model");
    expect(errorSurface(err)).not.toContain(PRIVATE_CANARY);
  });

  it("wraps a yielded stop error that echoed prompt metadata", async () => {
    const engine = createPrivateEngine(async function* () {
      yield { type: "text-delta", text: "partial" };
      yield {
        type: "stop",
        reason: "error",
        error: `provider said ${PRIVATE_CANARY}`,
        errorCode: `bad_${PRIVATE_CANARY}`,
        requestId: `req_${PRIVATE_CANARY}`,
        upgradeUrl: `https://example.invalid/${PRIVATE_CANARY}`,
        statusCode: 429,
      };
    });

    let thrown: unknown;
    try {
      await completeText({
        engine,
        input: "Sensitive selected content.",
        apiKey: "test-key",
        privateContent: true,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    const err = thrown as PrivateCompletionError;
    expect(err.code).toBe("http_429");
    expect(err.statusCode).toBe(429);
    expect(errorSurface(err)).not.toContain(PRIVATE_CANARY);
  });

  it("canonicalizes a simulated provider 401 with a synthetic canary and no external call", async () => {
    const engine = createPrivateEngine(async function* () {
      yield {
        type: "stop",
        reason: "error",
        error: `provider rejected ${PRIVATE_CANARY}`,
        errorCode: `http_401_${PRIVATE_CANARY}`,
        requestId: `req_${PRIVATE_CANARY}`,
        statusCode: 401,
      };
    });

    let thrown: unknown;
    try {
      await completeText({
        engine,
        input: "Sensitive selected content.",
        apiKey: "test-key",
        privateContent: true,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    const err = thrown as PrivateCompletionError;
    expect(err.code).toBe("http_401");
    expect(err.statusCode).toBe(401);
    expect(err.provider).toBe("model");
    expect(errorSurface(err)).not.toContain(PRIVATE_CANARY);
  });

  it("retypes the canonical provider 401 while preserving code, provider, and status", async () => {
    const engine = createPrivateEngine(async function* () {
      throw new ProviderAuthenticationError("builder", 401);
    });

    let thrown: unknown;
    try {
      await completeText({
        engine,
        input: "Sensitive selected content.",
        apiKey: "test-key",
        privateContent: true,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    const err = thrown as PrivateCompletionError;
    expect(err.provider).toBe("builder");
    expect(err.code).toBe("builder_auth_error");
    expect(err.statusCode).toBe(401);
  });

  it("leaves incoming errors untouched when privateContent is absent or false", async () => {
    const raw = new Error(`plain failure ${PRIVATE_CANARY}`);
    const engine = createPrivateEngine(async function* () {
      throw raw;
    });

    await expect(
      completeText({ engine, input: "x", apiKey: "test-key" }),
    ).rejects.toBe(raw);
    await expect(
      completeText({
        engine,
        input: "x",
        apiKey: "test-key",
        privateContent: false,
      }),
    ).rejects.toBe(raw);
  });

  it("labels a private timeout with fixed copy and no abort-reason leak", async () => {
    const engine = createPrivateEngine(async function* (opts) {
      await new Promise<never>((_resolve, reject) => {
        opts.abortSignal.addEventListener(
          "abort",
          () => reject(opts.abortSignal.reason),
          { once: true },
        );
      });
    });

    let thrown: unknown;
    try {
      await completeText({
        engine,
        input: "Sensitive selected content.",
        apiKey: "test-key",
        privateContent: true,
        timeoutMs: 1,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    const err = thrown as PrivateCompletionError;
    expect(err.message).toBe("The private completion failed.");
    expect(errorSurface(err)).not.toContain(PRIVATE_CANARY);
  });
});
