import { inspect } from "node:util";

import { streamText } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { privateLanguageModelV3 } from "./private-ai-sdk-model.js";
import { PrivateCompletionError } from "./private-completion-error.js";

/** A synthetic selected-email-body stand-in; never a real provider payload. */
const PRIVATE_CANARY = "priv-sdk-canary-3d91";

const providerState = vi.hoisted(() => ({
  model: undefined as unknown,
  resolved: 0,
  throwError: undefined as unknown,
}));

const credentialState = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
}));

// The provider factory is mocked so no provider package/network is touched.
// The `ai` package is deliberately NOT mocked: the diagnostics assertions run
// against the real SDK.
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => (_modelId: string) => {
    providerState.resolved += 1;
    if (providerState.throwError) throw providerState.throwError;
    return providerState.model;
  },
}));

vi.mock("../../server/credential-provider.js", () => ({
  readDeployCredentialEnv: () => undefined,
  recordProviderCredentialAuthFailure: async (
    details: Record<string, unknown>,
  ) => {
    credentialState.records.push(details);
  },
  clearProviderCredentialAuthFailure: async () => {},
}));

import { createAISDKEngine } from "./ai-sdk-engine.js";

const baseUsage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

type StreamPart = Record<string, unknown>;

function makeModel(parts: StreamPart[]): MockLanguageModelV3 {
  const model = new MockLanguageModelV3({
    provider: "openai",
    modelId: "mock-openai-1",
    doStream: async () => ({
      request: { body: { echo: PRIVATE_CANARY } },
      response: { headers: { "x-echo": PRIVATE_CANARY } },
      stream: convertArrayToReadableStream(parts as never[]),
    }),
  });
  providerState.model = model;
  return model;
}

async function drain(
  iterable: AsyncIterable<unknown>,
): Promise<{ events: any[]; thrown: unknown }> {
  const events: any[] = [];
  let thrown: unknown;
  try {
    for await (const event of iterable) events.push(event);
  } catch (error) {
    thrown = error;
  }
  return { events, thrown };
}

async function drainFullStream(result: { fullStream: AsyncIterable<unknown> }) {
  for await (const _ of result.fullStream) {
    // consume the real SDK stream
  }
}

function engineOptions(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    model: "gpt-5.5",
    systemPrompt: `You are careful. ${PRIVATE_CANARY}`,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: `Summarize ${PRIVATE_CANARY}` }],
      },
    ],
    tools: [],
    abortSignal: new AbortController().signal,
    ...extra,
  };
}

function spyConsole() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  return {
    warn,
    error,
    info,
    allCalls() {
      return inspect(
        [...warn.mock.calls, ...error.mock.calls, ...info.mock.calls],
        { depth: 12 },
      );
    },
    restore() {
      warn.mockRestore();
      error.mockRestore();
      info.mockRestore();
    },
  };
}

function clearTelemetryRegistry() {
  delete (globalThis as Record<string, unknown>).AI_SDK_TELEMETRY_INTEGRATIONS;
}

beforeEach(() => {
  providerState.resolved = 0;
  providerState.model = undefined;
  providerState.throwError = undefined;
  credentialState.records = [];
  clearTelemetryRegistry();
});

afterEach(() => {
  clearTelemetryRegistry();
  vi.restoreAllMocks();
});

describe("real ai streamText -- diagnostics sinks", () => {
  it("baseline: the raw model still leaks a provider warning/error to the console", async () => {
    const model = makeModel([
      {
        type: "stream-start",
        warnings: [{ type: "other", message: PRIVATE_CANARY }],
      },
      { type: "raw", rawValue: PRIVATE_CANARY },
      { type: "error", error: new Error(PRIVATE_CANARY) },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "ok" },
      { type: "text-end", id: "t" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: baseUsage,
      },
    ]);
    const spy = spyConsole();
    try {
      const result = streamText({ model, prompt: "hi", maxRetries: 0 });
      await drainFullStream(result as never);
      expect(spy.allCalls()).toContain(PRIVATE_CANARY);
    } finally {
      spy.restore();
    }
  });

  it("private wrapper: the real SDK never writes the canary to the console", async () => {
    const model = makeModel([
      {
        type: "stream-start",
        warnings: [{ type: "other", message: PRIVATE_CANARY }],
      },
      { type: "raw", rawValue: PRIVATE_CANARY },
      { type: "error", error: new Error(PRIVATE_CANARY) },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "ok" },
      { type: "text-end", id: "t" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: baseUsage,
      },
    ]);
    const spy = spyConsole();
    try {
      const result = streamText({
        model: privateLanguageModelV3(model, { provider: "openai" }),
        prompt: "hi",
        maxRetries: 0,
        onError: () => {},
        experimental_telemetry: {
          isEnabled: false,
          recordInputs: false,
          recordOutputs: false,
        },
      });
      await drainFullStream(result as never);
      expect(spy.allCalls()).not.toContain(PRIVATE_CANARY);
    } finally {
      spy.restore();
    }
  });
});

describe("engine private content -- global telemetry guard", () => {
  it("fails closed before dispatch and fires zero global telemetry callbacks", async () => {
    const telemetryCalls: unknown[] = [];
    (globalThis as Record<string, unknown>).AI_SDK_TELEMETRY_INTEGRATIONS = [
      {
        onStart: (event: unknown) => telemetryCalls.push(event),
        onStepFinish: (event: unknown) => telemetryCalls.push(event),
        onFinish: (event: unknown) => telemetryCalls.push(event),
      },
    ];
    const model = makeModel([
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "leak" },
      { type: "text-end", id: "t" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: baseUsage,
      },
    ]);
    const engine = createAISDKEngine("openai", { apiKey: "sk-synthetic" });

    const { events, thrown } = await drain(
      engine.stream(engineOptions({ privateContent: true }) as never),
    );

    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    expect(events).toHaveLength(0);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(telemetryCalls).toHaveLength(0);
    expect(credentialState.records).toHaveLength(0);
  });

  it("fails closed on a malformed non-null registry", async () => {
    (globalThis as Record<string, unknown>).AI_SDK_TELEMETRY_INTEGRATIONS = {
      malformed: true,
    };
    const model = makeModel([
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: baseUsage,
      },
    ]);
    const engine = createAISDKEngine("openai", { apiKey: "sk-synthetic" });

    const { thrown } = await drain(
      engine.stream(engineOptions({ privateContent: true }) as never),
    );

    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(credentialState.records).toHaveLength(0);
  });

  it("documents that the ordinary path still hands prompt content to a registered integration", async () => {
    const telemetryCalls: unknown[] = [];
    (globalThis as Record<string, unknown>).AI_SDK_TELEMETRY_INTEGRATIONS = [
      {
        onStart: (event: unknown) => telemetryCalls.push(event),
        onStepFinish: (event: unknown) => telemetryCalls.push(event),
        onFinish: (event: unknown) => telemetryCalls.push(event),
      },
    ];
    const model = makeModel([
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "ok" },
      { type: "text-end", id: "t" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: baseUsage,
      },
    ]);
    const engine = createAISDKEngine("openai", { apiKey: "sk-synthetic" });
    const spy = spyConsole();
    try {
      await drain(engine.stream(engineOptions() as never));
    } finally {
      spy.restore();
    }

    expect(model.doStreamCalls.length).toBeGreaterThan(0);
    expect(telemetryCalls.length).toBeGreaterThan(0);
    expect(JSON.stringify(telemetryCalls)).toContain(PRIVATE_CANARY);
  });
});

describe("engine private content -- diagnostics and errors", () => {
  it("stops malformed tool arguments through the real SDK with fixed error metadata", async () => {
    makeModel([
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "readSelected",
        input: '{"body":"' + PRIVATE_CANARY,
      },
      {
        type: "finish",
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage: baseUsage,
      },
    ]);
    const engine = createAISDKEngine("openai", { apiKey: "sk-synthetic" });
    const spy = spyConsole();
    try {
      const result = await drain(
        engine.stream(
          engineOptions({
            privateContent: true,
            tools: [
              {
                name: "readSelected",
                description: "Read the selection",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          }) as never,
        ),
      );
      expect(result.thrown).toBeInstanceOf(PrivateCompletionError);
      expect(result.events.some((e) => e.type === "tool-call-error")).toBe(
        false,
      );
      expect(
        JSON.stringify(result.events.filter((e) => e.type === "stop")),
      ).not.toContain(PRIVATE_CANARY);
      expect(spy.allCalls()).not.toContain(PRIVATE_CANARY);
    } finally {
      spy.restore();
    }
  });
  it("refuses an unaudited provider even for direct stream callers", async () => {
    const engine = createAISDKEngine("openrouter", {
      apiKey: "synthetic",
      allowEnvFallback: false,
    });
    const factory = vi
      .spyOn(
        engine as unknown as {
          createProviderModel: (model: string) => Promise<unknown>;
        },
        "createProviderModel",
      )
      .mockResolvedValue(makeModel([]));
    const result = await drain(
      engine.stream(engineOptions({ privateContent: true })),
    );
    expect(result.thrown).toBeInstanceOf(PrivateCompletionError);
    expect(factory).not.toHaveBeenCalled();
  });
  it("emits text but never writes provider warnings or raw bodies to the console", async () => {
    const model = makeModel([
      {
        type: "stream-start",
        warnings: [{ type: "other", message: PRIVATE_CANARY }],
      },
      { type: "raw", rawValue: PRIVATE_CANARY },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "private ok" },
      { type: "text-end", id: "t" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: baseUsage,
      },
    ]);
    const engine = createAISDKEngine("openai", { apiKey: "sk-synthetic" });
    const spy = spyConsole();
    let events: any[] = [];
    try {
      ({ events } = await drain(
        engine.stream(engineOptions({ privateContent: true }) as never),
      ));
      expect(spy.allCalls()).not.toContain(PRIVATE_CANARY);
    } finally {
      spy.restore();
    }

    expect(
      events.some(
        (event) => event.type === "text-delta" && event.text === "private ok",
      ),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain(PRIVATE_CANARY);
  });

  it("uses the noop onError and canonicalizes an error after partial text", async () => {
    makeModel([
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "partial" },
      { type: "text-end", id: "t" },
      {
        type: "error",
        error: Object.assign(new Error(`echo ${PRIVATE_CANARY}`), {
          statusCode: 500,
          requestId: `req_${PRIVATE_CANARY}`,
          cause: new Error(`cause ${PRIVATE_CANARY}`),
        }),
      },
      {
        type: "finish",
        finishReason: { unified: "error", raw: "error" },
        usage: baseUsage,
      },
    ]);
    const engine = createAISDKEngine("openai", { apiKey: "sk-synthetic" });
    const spy = spyConsole();
    let events: any[] = [];
    let thrown: unknown;
    try {
      ({ events, thrown } = await drain(
        engine.stream(engineOptions({ privateContent: true }) as never),
      ));
      // The SDK's default onError would call console.error here; the private
      // path passes an explicit noop instead.
      expect(spy.error).not.toHaveBeenCalled();
      expect(spy.allCalls()).not.toContain(PRIVATE_CANARY);
    } finally {
      spy.restore();
    }

    expect(
      events.some(
        (event) => event.type === "text-delta" && event.text === "partial",
      ),
    ).toBe(true);
    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      reason: "error",
      error: "The private completion failed.",
    });
    expect(JSON.stringify(events)).not.toContain(PRIVATE_CANARY);
    // A streamed error part is surfaced as a canonical stop, not a throw.
    expect(thrown).toBeUndefined();
  });

  it("canonicalizes a custom-model/factory error before it escapes", async () => {
    providerState.throwError = Object.assign(
      new Error(`bad custom model ${PRIVATE_CANARY}`),
      {
        statusCode: 400,
        requestId: `req_${PRIVATE_CANARY}`,
        cause: new Error(`cause ${PRIVATE_CANARY}`),
      },
    );
    const engine = createAISDKEngine("openai", { apiKey: "sk-synthetic" });
    const { events, thrown } = await drain(
      engine.stream(engineOptions({ privateContent: true }) as never),
    );

    // createProviderModel failure is yielded predispatch, not thrown raw.
    expect(thrown).toBeUndefined();
    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      reason: "error",
      error: "The private completion failed.",
      errorCode: "http_400",
    });
    expect(JSON.stringify(events)).not.toContain(PRIVATE_CANARY);
  });

  it("keeps a private 401 typed and records one sanitized credential marker", async () => {
    makeModel([
      {
        type: "error",
        error: Object.assign(new Error(`unauthorized ${PRIVATE_CANARY}`), {
          statusCode: 401,
          requestId: `req_${PRIVATE_CANARY}`,
        }),
      },
      {
        type: "finish",
        finishReason: { unified: "error", raw: "error" },
        usage: baseUsage,
      },
    ]);
    const engine = createAISDKEngine("openai", { apiKey: "sk-synthetic" });
    const spy = spyConsole();
    let events: any[] = [];
    let thrown: unknown;
    try {
      ({ events, thrown } = await drain(
        engine.stream(engineOptions({ privateContent: true }) as never),
      ));
      expect(spy.allCalls()).not.toContain(PRIVATE_CANARY);
    } finally {
      spy.restore();
    }

    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      reason: "error",
      errorCode: "http_401",
      provider: "openai",
      statusCode: 401,
    });
    expect(JSON.stringify(events)).not.toContain(PRIVATE_CANARY);
    // The streamed 401 is terminal and surfaced as a typed stop, matching the
    // ordinary engine's sticky auth-failure behavior.
    expect(thrown).toBeUndefined();

    expect(credentialState.records).toHaveLength(1);
    expect(credentialState.records[0]).toMatchObject({
      key: "OPENAI_API_KEY",
      provider: "openai",
      code: "http_401",
      status: 401,
    });
    expect(JSON.stringify(credentialState.records)).not.toContain(
      PRIVATE_CANARY,
    );
  });

  it("does not record a credential strike when a handler blocks the dispatch", async () => {
    const beforeModelDispatch = vi.fn(async () => {
      throw Object.assign(new Error(`blocked ${PRIVATE_CANARY}`), {
        statusCode: 401,
      });
    });
    const model = makeModel([
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: baseUsage,
      },
    ]);
    const engine = createAISDKEngine("openai", { apiKey: "sk-synthetic" });

    const { thrown } = await drain(
      engine.stream(
        engineOptions({ privateContent: true, beforeModelDispatch }) as never,
      ),
    );

    expect(beforeModelDispatch).toHaveBeenCalledTimes(1);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(credentialState.records).toHaveLength(0);
    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    expect((thrown as PrivateCompletionError).code).toBe("http_401");
  });
});
