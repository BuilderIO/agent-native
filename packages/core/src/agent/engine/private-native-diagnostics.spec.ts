import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createAnthropicEngine,
  ANTHROPIC_DEFAULT_MODEL,
} from "./anthropic-engine.js";
import { PrivateCompletionError } from "./private-completion-error.js";
import { ProviderAuthenticationError } from "./provider-auth-error.js";
import type { EngineStreamOptions } from "./types.js";

/**
 * Synthetic stand-in for a selected email body that a provider might echo back
 * in an error message, cause, response body, or log line. Nothing derived from
 * a provider response may survive the private boundary.
 */
const CANARY = "canary-private-native-9f2c7a";
// guard:allow-secret-literal — fake credential-shaped test fixture
const SYNTHETIC_KEY = "sk-ant-synthetic-native-private";

const sdkState = vi.hoisted(() => ({
  constructorOptions: [] as any[],
  constructorError: undefined as unknown,
  stream: vi.fn(),
}));

// Only the SDK surface is faked; no provider, network, or fetch call is made.
// The constructor records the exact options so the private silent logger can be
// observed (and the ordinary constructor can be shown untouched).
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { stream: sdkState.stream };

    constructor(options?: unknown) {
      if (sdkState.constructorError !== undefined) {
        throw sdkState.constructorError;
      }
      sdkState.constructorOptions.push(options);
    }
  },
}));

const credentialState = vi.hoisted(() => ({
  records: [] as any[],
  clears: [] as any[],
}));

// The credential sink is replaced with an in-memory recorder so the test can
// observe the sanitized marker without touching settings storage. Reading the
// deploy env is neutralized so no environment secret is involved.
vi.mock("../../server/credential-provider.js", () => ({
  readDeployCredentialEnv: () => undefined,
  recordProviderCredentialAuthFailure: async (details: any) => {
    credentialState.records.push(details);
  },
  clearProviderCredentialAuthFailure: async (details: any) => {
    credentialState.clears.push(details);
  },
}));

function privateOptions(
  extra: Partial<EngineStreamOptions> = {},
): EngineStreamOptions {
  return {
    model: ANTHROPIC_DEFAULT_MODEL,
    systemPrompt: "You are a careful assistant.",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: `Summarize this: ${CANARY}` }],
      },
    ],
    tools: [],
    abortSignal: new AbortController().signal,
    privateContent: true,
    ...extra,
  };
}

function ordinaryOptions(): EngineStreamOptions {
  return {
    model: ANTHROPIC_DEFAULT_MODEL,
    systemPrompt: "You are a careful assistant.",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: `Summarize this: ${CANARY}` }],
      },
    ],
    tools: [],
    abortSignal: new AbortController().signal,
  };
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

function errorSurface(error: unknown): string {
  const err = error as { message?: unknown; stack?: unknown; cause?: unknown };
  return [
    String(err?.message ?? ""),
    String(err?.stack ?? ""),
    String(err?.cause ?? ""),
    JSON.stringify(error),
  ].join("\n");
}

function successfulStream() {
  return {
    [Symbol.asyncIterator]: async function* () {},
    finalMessage: async () => ({ content: [], stop_reason: "end_turn" }),
  };
}

/** A fake SDK stream that yields `chunks` and then throws `error`. */
function rejectingStream(error: unknown, chunks: any[] = []) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
      throw error;
    },
    finalMessage: vi.fn(),
  };
}

function providerError(
  status: number | undefined,
  message = `provider echoed ${CANARY}`,
): any {
  const error = Object.assign(new Error(message), {
    response: {
      status,
      body: { error: { message: `body echoed ${CANARY}` } },
    },
    cause: new Error(`transport cause ${CANARY}`),
  });
  if (status !== undefined) error.status = status;
  return error;
}

function stopEvent(events: any[]): any {
  return events.find((event) => event.type === "stop");
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
let consoleInfo: ReturnType<typeof vi.spyOn>;
let consoleLog: ReturnType<typeof vi.spyOn>;

describe("private native Anthropic diagnostics", () => {
  it("stops malformed tool input without exposing it as an error event", async () => {
    sdkState.stream.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool-1",
            name: "readSelected",
          },
        };
        yield {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: '{"body":"' + CANARY,
          },
        };
      },
      finalMessage: async () => ({ content: [], stop_reason: "tool_use" }),
    }));
    const result = await drain(
      createAnthropicEngine({ apiKey: SYNTHETIC_KEY }).stream(privateOptions()),
    );
    expect(result.thrown).toBeInstanceOf(PrivateCompletionError);
    expect(result.events.some((e) => e.type === "tool-call-error")).toBe(false);
    expect(
      JSON.stringify(result.events.filter((e) => e.type === "stop")),
    ).not.toContain(CANARY);
    expect(errorSurface(result.thrown)).not.toContain(CANARY);
  });
  it("does not log a provider-defined unknown final content type", async () => {
    sdkState.stream.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () {},
      finalMessage: async () => ({
        content: [{ type: CANARY }],
        stop_reason: "end_turn",
      }),
    }));
    const engine = createAnthropicEngine({ apiKey: SYNTHETIC_KEY });
    const result = await drain(engine.stream(privateOptions()));
    expect(result.thrown).toBeUndefined();
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(CANARY);
    expect(JSON.stringify(result.events)).not.toContain(CANARY);
  });

  it("reconstructs a forged authentication class from SDK construction", async () => {
    sdkState.constructorError = Object.assign(
      Object.create(ProviderAuthenticationError.prototype),
      {
        message: CANARY,
        stack: CANARY,
        provider: CANARY,
        status: 401,
      },
    );
    const engine = createAnthropicEngine({ apiKey: SYNTHETIC_KEY });
    const result = await drain(engine.stream(privateOptions()));
    expect(result.thrown).toBeInstanceOf(ProviderAuthenticationError);
    expect(errorSurface(result.thrown)).not.toContain(CANARY);
    expect(credentialState.records).toHaveLength(0);
  });

  beforeEach(() => {
    sdkState.constructorOptions.length = 0;
    sdkState.constructorError = undefined;
    sdkState.stream.mockReset();
    credentialState.records.length = 0;
    credentialState.clears.length = 0;
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    consoleInfo.mockRestore();
    consoleLog.mockRestore();
  });

  it.each([{ status: 400 }, { status: 403 }, { status: 429 }, { status: 500 }])(
    "echoes no canary for an HTTP $status native failure and yields a fixed stop",
    async ({ status }) => {
      sdkState.stream.mockImplementation(() =>
        rejectingStream(providerError(status)),
      );
      const engine = createAnthropicEngine({ apiKey: SYNTHETIC_KEY });
      const { events, thrown } = await drain(engine.stream(privateOptions()));

      expect(sdkState.stream).toHaveBeenCalledTimes(1);
      expect(stopEvent(events)).toMatchObject({
        type: "stop",
        reason: "error",
        errorCode: `http_${status}`,
        provider: "anthropic",
        statusCode: status,
      });
      expect(JSON.stringify(events)).not.toContain(CANARY);

      expect(thrown).toBeInstanceOf(PrivateCompletionError);
      expect(thrown.code).toBe(`http_${status}`);
      expect(thrown.provider).toBe("anthropic");
      expect(thrown.statusCode).toBe(status);
      expect(errorSurface(thrown)).not.toContain(CANARY);

      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(CANARY);
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(CANARY);
      expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain(CANARY);
      expect(JSON.stringify(consoleLog.mock.calls)).not.toContain(CANARY);

      // A non-401 private failure is never a credential strike.
      expect(credentialState.records).toHaveLength(0);
      expect(credentialState.clears).toHaveLength(0);
    },
  );

  it("wraps a private network failure with no status as fixed copy", async () => {
    sdkState.stream.mockImplementation(() =>
      rejectingStream(
        Object.assign(new Error(`connection error. ${CANARY}`), {
          cause: new Error(`network cause ${CANARY}`),
        }),
      ),
    );
    const engine = createAnthropicEngine({ apiKey: SYNTHETIC_KEY });
    const { events, thrown } = await drain(engine.stream(privateOptions()));

    expect(stopEvent(events)).toMatchObject({
      type: "stop",
      reason: "error",
      errorCode: "private_completion_error",
      provider: "anthropic",
    });
    expect(stopEvent(events).statusCode).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain(CANARY);

    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    expect(thrown.code).toBe("private_completion_error");
    expect(thrown.provider).toBe("anthropic");
    expect(thrown.statusCode).toBeUndefined();
    expect(errorSurface(thrown)).not.toContain(CANARY);
    expect(credentialState.records).toHaveLength(0);
  });

  it("sanitizes a private failure thrown after partial streamed text", async () => {
    sdkState.stream.mockImplementation(() =>
      rejectingStream(providerError(500), [
        {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "partial answer" },
        },
      ]),
    );
    const engine = createAnthropicEngine({ apiKey: SYNTHETIC_KEY });
    const { events, thrown } = await drain(engine.stream(privateOptions()));

    expect(events.some((event) => event.type === "text-delta")).toBe(true);
    expect(stopEvent(events)).toMatchObject({
      type: "stop",
      reason: "error",
      errorCode: "http_500",
      provider: "anthropic",
      statusCode: 500,
    });
    expect(JSON.stringify(events)).not.toContain(CANARY);

    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    expect(thrown.code).toBe("http_500");
    expect(errorSurface(thrown)).not.toContain(CANARY);
    expect(credentialState.records).toHaveLength(0);
  });

  it("keeps the canonical 401 auth marker and never leaks the raw rejection", async () => {
    sdkState.stream.mockImplementation(() =>
      rejectingStream(providerError(401)),
    );
    const engine = createAnthropicEngine({ apiKey: SYNTHETIC_KEY });
    const { events, thrown } = await drain(engine.stream(privateOptions()));

    expect(stopEvent(events)).toMatchObject({
      type: "stop",
      reason: "error",
      errorCode: "http_401",
      provider: "anthropic",
      statusCode: 401,
    });
    expect(JSON.stringify(events)).not.toContain(CANARY);

    // The canonical 401 helper is retained as-is for direct stream callers.
    expect(thrown).toBeInstanceOf(ProviderAuthenticationError);
    expect(thrown).not.toBeInstanceOf(PrivateCompletionError);
    expect(thrown.provider).toBe("anthropic");
    expect(thrown.code).toBe("http_401");
    expect(thrown.statusCode).toBe(401);
    expect(errorSurface(thrown)).not.toContain(CANARY);

    // Exactly one canonical, sanitized strike marker; never the canary.
    expect(credentialState.records).toHaveLength(1);
    expect(credentialState.records[0]).toMatchObject({
      key: "ANTHROPIC_API_KEY",
      provider: "anthropic",
      code: "http_401",
      status: 401,
    });
    expect(JSON.stringify(credentialState.records)).not.toContain(CANARY);
    expect(credentialState.clears).toHaveLength(0);
  });

  it("does not strike when a private beforeModelDispatch 401 fails before the SDK factory", async () => {
    const hookError = providerError(401, `hook rejected ${CANARY}`);
    const beforeModelDispatch = vi.fn(async () => {
      throw hookError;
    });
    const engine = createAnthropicEngine({ apiKey: SYNTHETIC_KEY });
    const { events, thrown } = await drain(
      engine.stream(privateOptions({ beforeModelDispatch })),
    );

    expect(beforeModelDispatch).toHaveBeenCalledTimes(1);
    expect(sdkState.stream).not.toHaveBeenCalled();
    expect(stopEvent(events)).toMatchObject({
      type: "stop",
      reason: "error",
      errorCode: "http_401",
      provider: "anthropic",
      statusCode: 401,
    });
    expect(thrown).toBeInstanceOf(ProviderAuthenticationError);
    expect(errorSurface(thrown)).not.toContain(CANARY);
    expect(credentialState.records).toHaveLength(0);
    expect(credentialState.clears).toHaveLength(0);
  });

  it("ignores a hostile status accessor in the private path instead of throwing it raw", async () => {
    const hostile = new Error(`hostile rejection ${CANARY}`);
    Object.defineProperty(hostile, "status", {
      get() {
        throw new Error(`status getter ${CANARY}`);
      },
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(hostile, "cause", {
      get() {
        throw new Error(`cause getter ${CANARY}`);
      },
      enumerable: true,
      configurable: true,
    });
    sdkState.stream.mockImplementation(() => rejectingStream(hostile));

    const engine = createAnthropicEngine({ apiKey: SYNTHETIC_KEY });
    const { thrown } = await drain(engine.stream(privateOptions()));

    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    expect(thrown.code).toBe("private_completion_error");
    expect(errorSurface(thrown)).not.toContain(CANARY);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(CANARY);
  });

  it("wraps a pre-try SDK construction failure only on the private path", async () => {
    sdkState.constructorError = providerError(500, `construct ${CANARY}`);
    const engine = createAnthropicEngine({ apiKey: SYNTHETIC_KEY });

    const privateResult = await drain(engine.stream(privateOptions()));
    expect(privateResult.thrown).toBeInstanceOf(PrivateCompletionError);
    expect(privateResult.thrown.code).toBe("http_500");
    expect(errorSurface(privateResult.thrown)).not.toContain(CANARY);

    // The ordinary path is untouched: the same construction failure keeps its
    // incoming identity rather than being retyped.
    const raw = sdkState.constructorError;
    sdkState.constructorError = raw;
    const ordinaryResult = await drain(engine.stream(ordinaryOptions()));
    expect(ordinaryResult.thrown).toBe(raw);
  });

  it("constructs the SDK silently for private content and leaves the ordinary constructor untouched", async () => {
    sdkState.stream.mockImplementation(() => successfulStream());
    const engine = createAnthropicEngine({ apiKey: SYNTHETIC_KEY });

    await drain(engine.stream(privateOptions()));
    const privateConstruct = sdkState.constructorOptions.at(-1)!;
    expect(privateConstruct.logLevel).toBe("off");
    expect(privateConstruct.logger).toBeTypeOf("object");
    for (const level of ["error", "warn", "info", "debug"]) {
      expect(typeof privateConstruct.logger[level]).toBe("function");
    }
    // The private logger is a genuine no-op: even provider-controlled text
    // passed straight to it reaches no console sink.
    privateConstruct.logger.error(CANARY);
    privateConstruct.logger.warn(CANARY);
    privateConstruct.logger.info(CANARY);
    privateConstruct.logger.debug(CANARY);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(CANARY);
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(CANARY);
    expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain(CANARY);
    expect(JSON.stringify(consoleLog.mock.calls)).not.toContain(CANARY);

    await drain(engine.stream(ordinaryOptions()));
    const ordinaryConstruct = sdkState.constructorOptions.at(-1)!;
    expect(ordinaryConstruct).not.toBe(privateConstruct);
    expect("logLevel" in ordinaryConstruct).toBe(false);
    expect("logger" in ordinaryConstruct).toBe(false);

    // Success still clears any recorded credential failure on both paths.
    expect(credentialState.clears.length).toBe(2);
    expect(credentialState.records).toHaveLength(0);
  });
});
