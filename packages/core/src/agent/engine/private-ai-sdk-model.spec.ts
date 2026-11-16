import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertNoGlobalTelemetryIntegration,
  isUnsafeTelemetryRegistry,
  privateLanguageModelV3,
  toPrivateEngineEvent,
} from "./private-ai-sdk-model.js";
import { PrivateCompletionError } from "./private-completion-error.js";
import { ProviderAuthenticationError } from "./provider-auth-error.js";

/** A synthetic selected-email-body stand-in. Never a real provider payload. */
const PRIVATE_CANARY = "priv-canary-7f3a";

const baseUsage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

type StreamPart = Record<string, unknown>;

async function readParts(
  stream: ReadableStream<unknown>,
): Promise<StreamPart[]> {
  const reader = stream.getReader();
  const parts: StreamPart[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value as StreamPart);
  }
  return parts;
}

function fakeV3(parts: StreamPart[]): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    provider: "mock",
    modelId: "mock-1",
    doStream: async () => ({
      request: { body: { echo: PRIVATE_CANARY } },
      response: { headers: { "x-echo": PRIVATE_CANARY } },
      stream: convertArrayToReadableStream(parts as never[]),
    }),
  });
}

function restoreTelemetryRegistry() {
  delete (globalThis as Record<string, unknown>).AI_SDK_TELEMETRY_INTEGRATIONS;
}

afterEach(() => {
  restoreTelemetryRegistry();
});

describe("privateLanguageModelV3", () => {
  it("drops request/response bodies, empties stream warnings, and drops raw parts", async () => {
    const model = fakeV3([
      {
        type: "stream-start",
        warnings: [{ type: "other", message: PRIVATE_CANARY }],
      },
      { type: "raw", rawValue: PRIVATE_CANARY },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "ok" },
      { type: "text-end", id: "t" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: baseUsage,
      },
    ]);

    const wrapped = privateLanguageModelV3(model, { provider: "openai" });
    const result = await wrapped.doStream({} as never);

    expect(result).not.toHaveProperty("request");
    expect(result).not.toHaveProperty("response");

    const parts = await readParts(result.stream as ReadableStream<unknown>);
    expect(parts.some((part) => part.type === "raw")).toBe(false);
    const streamStart = parts.find((part) => part.type === "stream-start");
    expect(streamStart?.warnings).toEqual([]);
    expect(JSON.stringify(parts)).not.toContain(PRIVATE_CANARY);
  });

  it("canonicalizes error parts before the SDK sees them and keeps typed auth status", async () => {
    const plain = Object.assign(new Error(`echo ${PRIVATE_CANARY}`), {
      statusCode: 500,
      requestId: `req_${PRIVATE_CANARY}`,
      cause: new Error(`cause ${PRIVATE_CANARY}`),
    });
    const auth = new ProviderAuthenticationError("anthropic", 401);

    const model = fakeV3([
      { type: "error", error: plain },
      { type: "error", error: auth },
      {
        type: "finish",
        finishReason: { unified: "error", raw: "error" },
        usage: baseUsage,
      },
    ]);

    const wrapped = privateLanguageModelV3(model, { provider: "openai" });
    const result = await wrapped.doStream({} as never);
    const parts = await readParts(result.stream as ReadableStream<unknown>);
    const errors = parts.filter((part) => part.type === "error");

    expect(errors).toHaveLength(2);
    expect(JSON.stringify(parts)).not.toContain(PRIVATE_CANARY);

    const plainError = errors[0].error as PrivateCompletionError;
    expect(plainError).toBeInstanceOf(PrivateCompletionError);
    expect(plainError.code).toBe("http_500");
    expect(plainError.provider).toBe("openai");

    const authError = errors[1].error as PrivateCompletionError;
    expect(authError).toBeInstanceOf(PrivateCompletionError);
    expect(authError.code).toBe("http_401");
    expect(authError.provider).toBe("anthropic");
    expect(authError.statusCode).toBe(401);
  });

  it("strips finish provider metadata, raw finish reason, and raw usage", async () => {
    const model = fakeV3([
      {
        type: "finish",
        finishReason: { unified: "stop", raw: PRIVATE_CANARY },
        providerMetadata: { openai: { echo: PRIVATE_CANARY } },
        usage: { ...baseUsage, raw: { echo: PRIVATE_CANARY } },
      },
    ]);

    const wrapped = privateLanguageModelV3(model, { provider: "openai" });
    const result = await wrapped.doStream({} as never);
    const parts = await readParts(result.stream as ReadableStream<unknown>);

    const finish = parts.find((part) => part.type === "finish") as {
      finishReason: { unified: string; raw?: unknown };
      providerMetadata?: unknown;
      usage: { raw?: unknown };
    };
    expect(finish.finishReason.raw).toBeUndefined();
    expect(finish.providerMetadata).toBeUndefined();
    expect(finish.usage.raw).toBeUndefined();
    expect(JSON.stringify(finish)).not.toContain(PRIVATE_CANARY);
  });

  it("refuses doGenerate with a fixed typed error instead of forwarding it", () => {
    const model = fakeV3([]);
    const wrapped = privateLanguageModelV3(model, { provider: "openai" });

    expect(() => wrapped.doGenerate({} as never)).toThrow(
      PrivateCompletionError,
    );
    expect(() => wrapped.doGenerate({} as never)).toThrow(
      "The private completion failed.",
    );
  });

  it("fails closed for a non-v3 model without dispatching it", () => {
    const v2 = {
      specificationVersion: "v2",
      provider: "mock",
      modelId: "mock-v2",
    };
    expect(() => privateLanguageModelV3(v2, { provider: "openai" })).toThrow(
      PrivateCompletionError,
    );
  });
});

describe("assertNoGlobalTelemetryIntegration", () => {
  it("treats absent/null registries as safe and any other shape as unsafe", () => {
    expect(isUnsafeTelemetryRegistry(undefined)).toBe(false);
    expect(isUnsafeTelemetryRegistry(null)).toBe(false);
    expect(isUnsafeTelemetryRegistry([])).toBe(false);
    expect(isUnsafeTelemetryRegistry([{ onStart() {} }])).toBe(true);
    expect(isUnsafeTelemetryRegistry({})).toBe(true);
    expect(isUnsafeTelemetryRegistry("nope")).toBe(true);
  });

  it("fails closed on a populated or malformed registry without mutating it", () => {
    const populated = [{ onStart() {} }];
    (globalThis as Record<string, unknown>).AI_SDK_TELEMETRY_INTEGRATIONS =
      populated;

    expect(() => assertNoGlobalTelemetryIntegration("openai")).toThrow(
      PrivateCompletionError,
    );
    expect(
      (globalThis as Record<string, unknown>).AI_SDK_TELEMETRY_INTEGRATIONS,
    ).toBe(populated);

    (globalThis as Record<string, unknown>).AI_SDK_TELEMETRY_INTEGRATIONS = {
      malformed: true,
    };
    expect(() => assertNoGlobalTelemetryIntegration("openai")).toThrow(
      PrivateCompletionError,
    );
  });

  it("allows an absent, null, or empty registry", () => {
    expect(() => assertNoGlobalTelemetryIntegration("openai")).not.toThrow();
    (globalThis as Record<string, unknown>).AI_SDK_TELEMETRY_INTEGRATIONS =
      null;
    expect(() => assertNoGlobalTelemetryIntegration("openai")).not.toThrow();
    (globalThis as Record<string, unknown>).AI_SDK_TELEMETRY_INTEGRATIONS = [];
    expect(() => assertNoGlobalTelemetryIntegration("openai")).not.toThrow();
  });
});

describe("toPrivateEngineEvent", () => {
  it("terminates malformed private tool input without returning its identifiers or text", () => {
    const event = {
      type: "tool-call-error",
      id: PRIVATE_CANARY,
      name: PRIVATE_CANARY,
      input: PRIVATE_CANARY,
      error: PRIVATE_CANARY,
    } as const;
    const safe = toPrivateEngineEvent(event, "openai");
    expect(safe).toMatchObject({
      type: "stop",
      reason: "error",
      errorCode: "private_completion_error",
      provider: "openai",
    });
    expect(JSON.stringify(safe)).not.toContain(PRIVATE_CANARY);
  });
  it("does not trust an authentication code on a provider-controlled error stop", () => {
    const event = {
      type: "stop",
      reason: "error",
      errorCode: "http_401",
      statusCode: 401,
      provider: PRIVATE_CANARY,
      error: PRIVATE_CANARY,
      requestId: PRIVATE_CANARY,
    } as const;
    const safe = toPrivateEngineEvent(event, "openai");
    expect(safe).toMatchObject({
      errorCode: "http_401",
      provider: "openai",
      statusCode: 401,
    });
    expect(JSON.stringify(safe)).not.toContain(PRIVATE_CANARY);
  });
  it("passes every non-error-stop event through by reference", () => {
    const delta = { type: "text-delta", text: "hi" } as const;
    expect(toPrivateEngineEvent(delta, "openai")).toBe(delta);

    const endTurn = { type: "stop", reason: "end_turn" } as const;
    expect(toPrivateEngineEvent(endTurn, "openai")).toBe(endTurn);
  });

  it("strips raw provider strings from a non-401 error stop", () => {
    const rawStop = {
      type: "stop",
      reason: "error",
      error: `provider said ${PRIVATE_CANARY}`,
      errorCode: `code_${PRIVATE_CANARY}`,
      requestId: `req_${PRIVATE_CANARY}`,
      upgradeUrl: `https://example.invalid/${PRIVATE_CANARY}`,
      statusCode: 429,
      providerRetryable: true,
    } as never;

    const safe = toPrivateEngineEvent(rawStop, "openai");
    expect(safe).toMatchObject({
      type: "stop",
      reason: "error",
      error: "The private completion failed.",
      errorCode: "http_429",
      statusCode: 429,
    });
    expect((safe as { requestId?: unknown }).requestId).toBeUndefined();
    expect((safe as { upgradeUrl?: unknown }).upgradeUrl).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain(PRIVATE_CANARY);
  });

  it("preserves the typed authentication stop exactly", () => {
    const authStop = new ProviderAuthenticationError(
      "anthropic",
      401,
    ).stopEvent();
    expect(toPrivateEngineEvent(authStop, "openai")).toBe(authStop);

    const builderStop = new ProviderAuthenticationError(
      "builder",
      401,
    ).stopEvent();
    expect(toPrivateEngineEvent(builderStop, "openai")).toBe(builderStop);
  });
});
