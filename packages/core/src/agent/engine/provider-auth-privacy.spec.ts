import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ProviderAuthenticationError } from "./provider-auth-error.js";
import type { EngineStreamOptions } from "./types.js";

/**
 * A synthetic marker standing in for a selected email body that a provider
 * might echo back inside a 401 payload. If it ever survives into a settings
 * row, an engine event, or a thrown error, the privacy contract is broken.
 */
const EMAIL_BODY_CANARY = "canary-selected-email-body-4c7d1e";

const settingsState = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  return {
    store,
    getSetting: vi.fn(async (key: string) => store.get(key) ?? null),
    putSetting: vi.fn(async (key: string, value: Record<string, unknown>) => {
      store.set(key, value);
    }),
    deleteSetting: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

const builderCredState = vi.hoisted(() => ({
  resolveDetailed: vi.fn(),
  clearCalls: vi.fn(async () => {}),
  isConfigured: vi.fn(() => false),
  baseUrl: vi.fn(() => "https://builder-gateway.invalid/gateway/v1"),
}));

const anthropicState = vi.hoisted(() => ({
  stream: vi.fn(),
}));

// The AI SDK surface is mocked at the module boundary so the credential
// failure path can be driven through the real `AISDKEngine` without a network
// or provider package. The provider factory always succeeds; each test drives
// `streamText` directly.
const aiSdkState = vi.hoisted(() => {
  const streamText = vi.fn();
  const responsesModel = { id: "responses-model" };
  const chatModel = { id: "chat-model" };
  const provider = Object.assign(
    vi.fn(() => responsesModel),
    {
      chat: vi.fn(() => chatModel),
    },
  );
  const createOpenAI = vi.fn(() => provider);
  return { streamText, createOpenAI, provider, responsesModel, chatModel };
});

// Every provider/network/secret surface is mocked. Only the emitted error
// typing may reach the assertion layer.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { stream: anthropicState.stream };
  },
}));

vi.mock("ai", () => ({
  streamText: aiSdkState.streamText,
  jsonSchema: (schema: unknown) => schema,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: aiSdkState.createOpenAI,
}));

vi.mock("../../secrets/storage.js", () => ({
  readAppSecret: vi.fn(async () => null),
  readAppSecrets: vi.fn(async () => new Map()),
  writeAppSecret: vi.fn(async () => {}),
  deleteAppSecret: vi.fn(async () => {}),
}));

vi.mock("../../server/builder-oauth.js", () => ({
  BuilderOAuthScopeError: class MockBuilderOAuthScopeError extends Error {},
  BUILDER_OAUTH_SCOPE: "builder:ai:invoke",
  hasBuilderOAuthSession: vi.fn(async () => false),
  getBuilderOAuthSession: vi.fn(async () => null),
  resolveBuilderOAuthRequestAccessState: vi.fn(async () => ({
    kind: "not_connected" as const,
  })),
  markBuilderOAuthReconnectRequired: vi.fn(async () => {}),
}));

vi.mock("../../server/request-context.js", () => ({
  getRequestContext: vi.fn(() => undefined),
  getRequestUserEmail: vi.fn(() => undefined),
  getRequestOrgId: vi.fn(() => undefined),
  getRequestRunContext: vi.fn(() => undefined),
  getRequestBuilderStorageCredentialOrgId: vi.fn(() => undefined),
}));

vi.mock("../../usage/builder-credit-notice.js", () => ({
  clearBuilderCreditLimitNotice: vi.fn(async () => {}),
  sendBuilderCreditLimitNotice: vi.fn(async () => {}),
}));

// Partial mock: the credential write sink (`recordProviderCredentialAuthFailure`)
// stays REAL so the test observes the actual sanitized row that persists.
// Only the Builder credential resolver/clear/base-url/is-configured seams are
// replaced. `recordBuilderGatewayAuthFailure` is delegated straight to the real
// provider sink with fixed synthetic values, so no credential resolver IO runs.
vi.mock("../../server/credential-provider.js", async (importOriginal) => {
  const original =
    (await importOriginal()) as typeof import("../../server/credential-provider.js");
  return {
    ...original,
    readDeployCredentialEnv: () => undefined,
    resolveBuilderGatewayCredentialsDetailed: (...args: unknown[]) =>
      builderCredState.resolveDetailed(...args),
    clearBuilderGatewayAuthFailure: (...args: unknown[]) =>
      builderCredState.clearCalls(...args),
    isBuilderGatewayDeployConfigured: () => builderCredState.isConfigured(),
    getBuilderGatewayBaseUrl: () => builderCredState.baseUrl(),
    recordBuilderGatewayAuthFailure: async (details?: {
      status?: number;
      code?: string;
      message?: string;
    }) => {
      await original.recordProviderCredentialAuthFailure({
        key: "BUILDER_GATEWAY_TOKEN",
        value: "synthetic-key",
        ...details,
      });
    },
  };
});

vi.mock("../../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../settings/store.js")>()),
  getSetting: (...args: unknown[]) =>
    settingsState.getSetting(...(args as [string])),
  putSetting: (...args: unknown[]) =>
    settingsState.putSetting(...(args as [string, Record<string, unknown>])),
  deleteSetting: (...args: unknown[]) =>
    settingsState.deleteSetting(...(args as [string])),
}));

import {
  getProviderCredentialAuthFailure,
  providerCredentialFingerprint,
  recordProviderCredentialAuthFailure,
} from "../../server/credential-provider.js";
import { createAISDKEngine } from "./ai-sdk-engine.js";
import {
  createAnthropicEngine,
  ANTHROPIC_DEFAULT_MODEL,
} from "./anthropic-engine.js";
import {
  createBuilderEngine,
  BUILDER_DEFAULT_MODEL,
} from "./builder-engine.js";

function serializeSettingsWrites(): string[] {
  return settingsState.putSetting.mock.calls.map(([, value]) =>
    JSON.stringify(value),
  );
}

function expectNoCanary(haystack: string) {
  expect(haystack).not.toContain(EMAIL_BODY_CANARY);
}

async function drain(iterable: AsyncIterable<unknown>): Promise<{
  events: any[];
  thrown: any;
}> {
  const events: any[] = [];
  let thrown: unknown;
  try {
    for await (const event of iterable) events.push(event);
  } catch (error) {
    thrown = error;
  }
  return { events, thrown };
}

function anthropicOptions(): EngineStreamOptions {
  return {
    model: ANTHROPIC_DEFAULT_MODEL,
    systemPrompt: "You are a careful assistant.",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `Summarize this: ${EMAIL_BODY_CANARY}` },
        ],
      },
    ],
    tools: [],
    abortSignal: new AbortController().signal,
  };
}

function openAiOptions(
  extra: Partial<EngineStreamOptions> = {},
): EngineStreamOptions {
  return {
    model: "gpt-5.5",
    systemPrompt: "You are a careful assistant.",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `Summarize this: ${EMAIL_BODY_CANARY}` },
        ],
      },
    ],
    tools: [],
    abortSignal: new AbortController().signal,
    ...extra,
  };
}

describe("provider authentication privacy", () => {
  beforeEach(() => {
    settingsState.store.clear();
    settingsState.getSetting.mockClear();
    settingsState.putSetting.mockClear();
    settingsState.deleteSetting.mockClear();
    builderCredState.resolveDetailed.mockReset();
    builderCredState.clearCalls.mockClear();
    builderCredState.isConfigured.mockReset().mockReturnValue(false);
    builderCredState.baseUrl
      .mockReset()
      .mockReturnValue("https://builder-gateway.invalid/gateway/v1");
    anthropicState.stream.mockReset();
    aiSdkState.streamText.mockReset();
    aiSdkState.createOpenAI.mockReset().mockReturnValue(aiSdkState.provider);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("native Anthropic 401 drops the echoed email body from events, thrown error, and the real settings write", async () => {
    const capturedRequests: any[] = [];
    const rejection = Object.assign(
      new Error(`Anthropic rejected the request: ${EMAIL_BODY_CANARY}`),
      {
        status: 401,
        response: {
          status: 401,
          body: { error: { message: `body echoed ${EMAIL_BODY_CANARY}` } },
        },
        cause: new Error(`raw transport cause ${EMAIL_BODY_CANARY}`),
      },
    );
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        throw rejection;
      },
      finalMessage: vi.fn(),
    };
    anthropicState.stream.mockImplementation((params: any) => {
      capturedRequests.push(params);
      return mockStream;
    });

    const engine = createAnthropicEngine({
      // guard:allow-secret-literal — fake credential-shaped test fixture
      apiKey: "sk-ant-synthetic-native-key",
    });
    const { events, thrown } = await drain(engine.stream(anthropicOptions()));

    // The request itself carries the synthetic body, so a leak canary test on
    // an empty request would prove nothing.
    expect(capturedRequests).toHaveLength(1);
    expect(JSON.stringify(capturedRequests[0])).toContain(EMAIL_BODY_CANARY);

    // Engine event is the typed stop, with fixed application copy only.
    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      type: "stop",
      reason: "error",
      errorCode: "http_401",
      provider: "anthropic",
      statusCode: 401,
    });
    expectNoCanary(JSON.stringify(events));

    // The thrown error is the typed helper, not the raw SDK rejection.
    expect(thrown).toBeInstanceOf(ProviderAuthenticationError);
    expect(thrown.provider).toBe("anthropic");
    expect(thrown.code).toBe("http_401");
    expectNoCanary(String(thrown.message));
    expectNoCanary(String(thrown.stack));
    expectNoCanary(String((thrown as { cause?: unknown }).cause ?? ""));

    // The REAL sink wrote exactly one sanitized marker and never the canary.
    expect(settingsState.putSetting).toHaveBeenCalled();
    const writes = serializeSettingsWrites();
    expect(writes).toHaveLength(1);
    expectNoCanary(writes[0]);
    expect(settingsState.putSetting.mock.calls[0][0]).toMatch(
      /^provider-auth-failure:[a-f0-9]{24}$/,
    );
    expect(settingsState.putSetting.mock.calls[0][1]).toMatchObject({
      key: "ANTHROPIC_API_KEY",
      provider: "anthropic",
      code: "http_401",
      status: 401,
    });
  });

  it("Builder gateway 401 yields a typed builder_auth_error and never reads or persists the response body", async () => {
    const response = new Response(
      JSON.stringify({ code: "unauthorized", message: EMAIL_BODY_CANARY }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
    const textSpy = vi.spyOn(response, "text");
    const fetchSpy = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetchSpy);

    const engine = createBuilderEngine({
      credentials: {
        privateKey: "bpk-synthetic-builder",
        publicKey: "space-synthetic-builder",
        userId: null,
        orgName: "synthetic-org",
        lane: "identity",
      },
    });
    const { events, thrown } = await drain(
      engine.stream({
        model: BUILDER_DEFAULT_MODEL,
        systemPrompt: "You are helpful.",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Forward this: ${EMAIL_BODY_CANARY}` },
            ],
          },
        ],
        tools: [],
        abortSignal: new AbortController().signal,
      }),
    );

    expect(thrown).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 401 short-circuits before the body is read.
    expect(textSpy).not.toHaveBeenCalled();

    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      type: "stop",
      reason: "error",
      errorCode: "builder_auth_error",
      provider: "builder",
      statusCode: 401,
    });
    expectNoCanary(JSON.stringify(events));

    // The real provider sink persisted the deploy-key marker, sanitized.
    expect(settingsState.putSetting).toHaveBeenCalled();
    const writes = serializeSettingsWrites();
    expect(writes).toHaveLength(1);
    expectNoCanary(writes[0]);
    expect(settingsState.putSetting.mock.calls[0][1]).toMatchObject({
      key: "BUILDER_GATEWAY_TOKEN",
      provider: "builder",
      code: "builder_auth_error",
      status: 401,
    });
  });

  it("the real record sink drops a malicious message and code before they reach settings", async () => {
    await recordProviderCredentialAuthFailure({
      key: "OPENAI_API_KEY",
      value: "sk-synthetic-provider-key",
      status: 401,
      code: `leaked_code_${EMAIL_BODY_CANARY}`,
      message: `upstream said ${EMAIL_BODY_CANARY}`,
    });

    expect(settingsState.putSetting).toHaveBeenCalledTimes(1);
    const [settingKey, storedValue] = settingsState.putSetting.mock.calls[0];
    expect(settingKey).toMatch(/^provider-auth-failure:[a-f0-9]{24}$/);
    expect(JSON.stringify(storedValue)).not.toContain(EMAIL_BODY_CANARY);
    expect(storedValue).toMatchObject({
      key: "OPENAI_API_KEY",
      provider: "openai",
      code: "http_401",
      status: 401,
    });
    // The stored message is fixed application copy, never the provider echo.
    expect(storedValue.message).toBe(
      "The model provider rejected the saved API key. Update it in Settings.",
    );
  });

  it("reading a legacy row that echoed the canary returns only safe typed details", async () => {
    const fingerprint = providerCredentialFingerprint(
      "OPENAI_API_KEY",
      "sk-synthetic-provider-key",
    );
    expect(fingerprint).not.toBeNull();
    settingsState.getSetting.mockResolvedValueOnce({
      fingerprint,
      key: EMAIL_BODY_CANARY,
      provider: EMAIL_BODY_CANARY,
      message: `legacy leaked ${EMAIL_BODY_CANARY}`,
      code: `legacy_code_${EMAIL_BODY_CANARY}`,
      status: 401,
      at: Date.now(),
    });

    const failure = await getProviderCredentialAuthFailure({
      key: "OPENAI_API_KEY",
      value: "sk-synthetic-provider-key",
    });

    expect(failure).not.toBeNull();
    expect(JSON.stringify(failure)).not.toContain(EMAIL_BODY_CANARY);
    expect(failure).toMatchObject({
      key: "OPENAI_API_KEY",
      provider: "openai",
      code: "http_401",
      status: 401,
    });
    expect(failure!.message).toBe(
      "The model provider rejected the saved API key. Update it in Settings.",
    );
  });

  it("native Anthropic 401 thrown synchronously by messages.stream is typed, redacted, and still records the marker", async () => {
    // The root dispatch call lives inside the try, so a synchronous SDK throw
    // (before the iterator is ever touched) must still be classified.
    const rejection = Object.assign(
      new Error(`synchronous rejection ${EMAIL_BODY_CANARY}`),
      {
        status: 401,
        cause: new Error(`sync transport cause ${EMAIL_BODY_CANARY}`),
      },
    );
    anthropicState.stream.mockImplementation(() => {
      throw rejection;
    });

    const engine = createAnthropicEngine({
      // guard:allow-secret-literal — fake credential-shaped test fixture
      apiKey: "sk-ant-synthetic-native-key",
    });
    const { events, thrown } = await drain(engine.stream(anthropicOptions()));

    expect(anthropicState.stream).toHaveBeenCalledTimes(1);

    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      type: "stop",
      reason: "error",
      errorCode: "http_401",
      provider: "anthropic",
      statusCode: 401,
    });
    expectNoCanary(JSON.stringify(events));

    expect(thrown).toBeInstanceOf(ProviderAuthenticationError);
    expect(thrown.provider).toBe("anthropic");
    expect(thrown.code).toBe("http_401");
    expectNoCanary(String(thrown.message));
    expectNoCanary(String(thrown.stack));
    expectNoCanary(String((thrown as { cause?: unknown }).cause ?? ""));

    const writes = serializeSettingsWrites();
    expect(writes).toHaveLength(1);
    expectNoCanary(writes[0]);
    expect(settingsState.putSetting.mock.calls[0][1]).toMatchObject({
      key: "ANTHROPIC_API_KEY",
      provider: "anthropic",
      code: "http_401",
      status: 401,
    });
  });

  it("a beforeModelDispatch 401 fails typed and clean before the provider factory with no credential marker", async () => {
    const hookRejection = Object.assign(
      new Error(`hook rejected ${EMAIL_BODY_CANARY}`),
      {
        status: 401,
        cause: new Error(`hook transport cause ${EMAIL_BODY_CANARY}`),
      },
    );
    const beforeModelDispatch = vi.fn(async () => {
      throw hookRejection;
    });

    const engine = createAnthropicEngine({
      // guard:allow-secret-literal — fake credential-shaped test fixture
      apiKey: "sk-ant-synthetic-native-key",
    });
    const { events, thrown } = await drain(
      engine.stream({ ...anthropicOptions(), beforeModelDispatch }),
    );

    // The hook throws before the dispatch thunk runs, so no SDK call happens.
    expect(beforeModelDispatch).toHaveBeenCalledTimes(1);
    expect(anthropicState.stream).not.toHaveBeenCalled();

    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      type: "stop",
      reason: "error",
      errorCode: "http_401",
      provider: "anthropic",
      statusCode: 401,
    });
    expectNoCanary(JSON.stringify(events));

    expect(thrown).toBeInstanceOf(ProviderAuthenticationError);
    expect(thrown.provider).toBe("anthropic");
    expect(thrown.code).toBe("http_401");
    expectNoCanary(String(thrown.message));
    expectNoCanary(String(thrown.stack));

    // providerDispatched is false because the factory never ran, so the
    // credential sink stays untouched even for a real 401.
    expect(settingsState.putSetting).not.toHaveBeenCalled();
    expect(settingsState.deleteSetting).not.toHaveBeenCalled();
  });

  it("AI-SDK wrapper catch of a 401 records one sanitized marker and stops typed", async () => {
    const rejection = Object.assign(
      new Error(`openai rejected ${EMAIL_BODY_CANARY}`),
      {
        statusCode: 401,
        cause: new Error(`openai transport cause ${EMAIL_BODY_CANARY}`),
      },
    );
    aiSdkState.streamText.mockImplementation(() => {
      throw rejection;
    });

    const engine = createAISDKEngine("openai", {
      apiKey: "sk-synthetic-openai-key",
    });
    const { events, thrown } = await drain(engine.stream(openAiOptions()));

    expect(aiSdkState.streamText).toHaveBeenCalledTimes(1);

    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      type: "stop",
      reason: "error",
      errorCode: "http_401",
      provider: "openai",
      statusCode: 401,
    });
    expectNoCanary(JSON.stringify(events));

    expect(thrown).toBeInstanceOf(ProviderAuthenticationError);
    expect(thrown.provider).toBe("openai");
    expect(thrown.code).toBe("http_401");
    expectNoCanary(String(thrown.message));
    expectNoCanary(String(thrown.stack));
    expectNoCanary(String((thrown as { cause?: unknown }).cause ?? ""));

    const writes = serializeSettingsWrites();
    expect(writes).toHaveLength(1);
    expectNoCanary(writes[0]);
    expect(settingsState.putSetting.mock.calls[0][1]).toMatchObject({
      key: "OPENAI_API_KEY",
      provider: "openai",
      code: "http_401",
      status: 401,
    });
  });

  it("a streamed 401 followed by a generic throw keeps the typed failure with one marker and no raw error", async () => {
    const genericThrow = new Error(
      `after-stream transport flake ${EMAIL_BODY_CANARY}`,
    );
    aiSdkState.streamText.mockReturnValue({
      fullStream: (async function* () {
        yield {
          type: "error",
          error: Object.assign(
            new Error(`streamed provider echo ${EMAIL_BODY_CANARY}`),
            { statusCode: 401 },
          ),
        };
        throw genericThrow;
      })(),
    });

    const engine = createAISDKEngine("openai", {
      apiKey: "sk-synthetic-openai-key",
    });
    const { events, thrown } = await drain(engine.stream(openAiOptions()));

    // The streamed 401 was buffered into the typed failure, never surfaced raw.
    expect(JSON.stringify(events)).not.toContain(EMAIL_BODY_CANARY);
    expect(thrown).toBeInstanceOf(ProviderAuthenticationError);
    expect(thrown).not.toBe(genericThrow);
    expect(thrown.provider).toBe("openai");
    expect(thrown.code).toBe("http_401");
    expectNoCanary(String(thrown.message));
    expectNoCanary(String(thrown.stack));

    // The streamed failure already recorded a strike, so the trailing throw
    // must not record a second backoff strike.
    const writes = serializeSettingsWrites();
    expect(writes).toHaveLength(1);
    expectNoCanary(writes[0]);
    expect(settingsState.putSetting.mock.calls[0][1]).toMatchObject({
      key: "OPENAI_API_KEY",
      provider: "openai",
      code: "http_401",
      status: 401,
    });
  });

  it("skipCredentialFailureTracking still redacts a 401 but writes no marker", async () => {
    const rejection = Object.assign(
      new Error(`openai rejected ${EMAIL_BODY_CANARY}`),
      {
        statusCode: 401,
        cause: new Error(`openai transport cause ${EMAIL_BODY_CANARY}`),
      },
    );
    aiSdkState.streamText.mockImplementation(() => {
      throw rejection;
    });

    const engine = createAISDKEngine("openai", {
      apiKey: "sk-synthetic-openai-key",
      skipCredentialFailureTracking: true,
    });
    const { events, thrown } = await drain(engine.stream(openAiOptions()));

    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      type: "stop",
      reason: "error",
      errorCode: "http_401",
      provider: "openai",
      statusCode: 401,
    });
    expectNoCanary(JSON.stringify(events));

    expect(thrown).toBeInstanceOf(ProviderAuthenticationError);
    expect(thrown.provider).toBe("openai");
    expect(thrown.code).toBe("http_401");
    expectNoCanary(String(thrown.message));
    expectNoCanary(String(thrown.stack));

    // Redaction still holds, but tracking is opted out entirely.
    expect(settingsState.putSetting).not.toHaveBeenCalled();
    expect(settingsState.deleteSetting).not.toHaveBeenCalled();
  });
  it("a streamed 401 stays terminal when a later normal finish arrives", async () => {
    aiSdkState.streamText.mockReturnValue({
      fullStream: (async function* () {
        yield {
          type: "error",
          error: Object.assign(new Error(EMAIL_BODY_CANARY), {
            statusCode: 401,
          }),
        };
        yield {
          type: "finish",
          finishReason: "stop",
          totalUsage: { inputTokens: 1, outputTokens: 0 },
        };
      })(),
    });
    const engine = createAISDKEngine("openai", {
      apiKey: "synthetic-openai-key",
    });
    const { events, thrown } = await drain(engine.stream(openAiOptions()));
    expect(thrown).toBeUndefined();
    expect(events.filter((event) => event.type === "stop")).toEqual([
      expect.objectContaining({
        reason: "error",
        errorCode: "http_401",
        provider: "openai",
        statusCode: 401,
      }),
    ]);
    expect(events.at(-1)?.reason).toBe("error");
    expect(events.some((event) => event.type === "assistant-content")).toBe(
      false,
    );
    expect(settingsState.putSetting).toHaveBeenCalledTimes(1);
    expect(settingsState.deleteSetting).not.toHaveBeenCalled();
    expectNoCanary(JSON.stringify(events));
    expectNoCanary(JSON.stringify([...settingsState.store.values()]));
  });

  it.each([
    { reason: "error", errorCode: undefined },
    { reason: "invalid_request", errorCode: "http_401" },
    { reason: "rate_limited", errorCode: "http_401" },
    { reason: "end_turn", errorCode: "http_401" },
  ])(
    "a streamed Builder auth failure stays private for $reason",
    async ({ reason, errorCode }) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const fetchSpy = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              type: "stop",
              reason,
              errorCode,
              error: `Invalid or inactive personal access token ${EMAIL_BODY_CANARY}`,
              requestId: EMAIL_BODY_CANARY,
            }) + "\n",
            { headers: { "Content-Type": "application/x-ndjson" } },
          ),
        );
        vi.stubGlobal("fetch", fetchSpy);
        const { events, thrown } = await drain(
          createBuilderEngine({
            credentials: {
              privateKey: "bpk-synthetic-builder",
              publicKey: "space-synthetic-builder",
              userId: null,
              orgName: "synthetic-org",
              lane: "identity",
            },
          }).stream({
            ...anthropicOptions(),
            model: BUILDER_DEFAULT_MODEL,
          }),
        );
        expect(thrown).toBeUndefined();
        expect(String(fetchSpy.mock.calls[0]?.[1]?.body)).toContain(
          EMAIL_BODY_CANARY,
        );
        const stop = events.find((event) => event.type === "stop");
        expect(stop).toMatchObject({
          reason: "error",
          errorCode: "builder_auth_error",
          provider: "builder",
          providerRetryable: false,
        });
        expect(stop?.requestId).toBeUndefined();
        expect(settingsState.putSetting).toHaveBeenCalledTimes(1);
        expectNoCanary(JSON.stringify(consoleError.mock.calls));
        expectNoCanary(JSON.stringify(consoleWarn.mock.calls));
        expectNoCanary(JSON.stringify(consoleLog.mock.calls));
        expectNoCanary(JSON.stringify(events));
        expectNoCanary(JSON.stringify([...settingsState.store.values()]));
      } finally {
        consoleError.mockRestore();
        consoleWarn.mockRestore();
        consoleLog.mockRestore();
      }
    },
  );
});
