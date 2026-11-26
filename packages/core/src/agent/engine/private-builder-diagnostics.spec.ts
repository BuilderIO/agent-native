import { inspect } from "node:util";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import * as captureErrorModule from "../../server/capture-error.js";
import { resolveBuilderGatewayCredentialsDetailed } from "../../server/credential-provider.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import {
  createBuilderEngine,
  BUILDER_DEFAULT_MODEL,
} from "./builder-engine.js";
import { PRIVATE_COMPLETION_ERROR_MESSAGE } from "./private-completion-error.js";
import { PrivateCompletionError } from "./private-completion-error.js";
import type { EngineStreamOptions } from "./types.js";

/**
 * A synthetic marker standing in for a selected email body a provider might
 * echo back. If it survives into an engine event, a thrown error, a console
 * line, a capture tag, or a settings row, the private-content contract broke.
 */
const EMAIL_BODY_CANARY = "canary-selected-email-body-4c7d1e";
const PARTIAL_CONTENT_CANARY = "canary-partial-content-8b2a0f";

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
  clearCalls: vi.fn(async () => {}),
  isConfigured: vi.fn(() => false),
  baseUrl: vi.fn(() => "https://gateway.test.invalid/gateway/v1"),
  sendCredit: vi.fn(async () => {}),
  clearCredit: vi.fn(async () => {}),
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
  clearBuilderCreditLimitNotice: (...args: unknown[]) =>
    builderCredState.clearCredit(...args),
  sendBuilderCreditLimitNotice: (...args: unknown[]) =>
    builderCredState.sendCredit(...args),
}));

// Partial mock: the credential write sink stays REAL so the test observes the
// sanitized row that persists. Only the Builder credential seams are replaced.
vi.mock("../../server/credential-provider.js", async (loadActual) => {
  const actual =
    (await loadActual()) as typeof import("../../server/credential-provider.js");
  return {
    ...actual,
    readDeployCredentialEnv: () => undefined,
    resolveBuilderGatewayCredentialsDetailed: vi.fn(),
    clearBuilderGatewayAuthFailure: (...args: unknown[]) =>
      builderCredState.clearCalls(...args),
    isBuilderGatewayDeployConfigured: () => builderCredState.isConfigured(),
    getBuilderGatewayBaseUrl: () => builderCredState.baseUrl(),
    recordBuilderGatewayAuthFailure: async (details?: {
      status?: number;
      code?: string;
      message?: string;
    }) => {
      await actual.recordProviderCredentialAuthFailure({
        key: "BUILDER_GATEWAY_TOKEN",
        value: "synthetic-key",
        ...details,
      });
    },
  };
});

vi.mock("../../settings/store.js", async (loadActual) => ({
  ...(await loadActual<typeof import("../../settings/store.js")>()),
  getSetting: (...args: unknown[]) =>
    settingsState.getSetting(...(args as [string])),
  putSetting: (...args: unknown[]) =>
    settingsState.putSetting(...(args as [string, Record<string, unknown>])),
  deleteSetting: (...args: unknown[]) =>
    settingsState.deleteSetting(...(args as [string])),
}));

let consoleLog: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;
let captureSpy: ReturnType<typeof vi.spyOn>;

function builderEngine() {
  return createBuilderEngine({
    credentials: {
      privateKey: "bpk-synthetic-builder",
      publicKey: "space-synthetic-builder",
      userId: null,
      orgName: "synthetic-org",
      lane: "identity",
    },
  });
}

const BASE_OPTS: EngineStreamOptions = {
  model: BUILDER_DEFAULT_MODEL,
  systemPrompt: "You are helpful.",
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: `Forward this: ${EMAIL_BODY_CANARY}` }],
    },
  ],
  tools: [],
  abortSignal: new AbortController().signal,
};

function jsonlResponse(lines: unknown[]): Response {
  const body = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/jsonl" },
  });
}

function rawStreamResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/jsonl" },
  });
}

function jsonErrorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

/** No provider-echoed canary may reach any throwable/observable surface. */
function expectPrivateClean(result: { events: any[]; thrown: unknown }) {
  expect(
    inspect(
      [
        consoleLog.mock.calls,
        consoleWarn.mock.calls,
        consoleError.mock.calls,
        captureSpy.mock.calls,
      ],
      { depth: 12 },
    ),
  ).not.toContain(EMAIL_BODY_CANARY);
  expect(JSON.stringify(result.events)).not.toContain(EMAIL_BODY_CANARY);
  expect(errorSurface(result.thrown)).not.toContain(EMAIL_BODY_CANARY);
  expect(JSON.stringify(consoleLog.mock.calls)).not.toContain(
    EMAIL_BODY_CANARY,
  );
  expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(
    EMAIL_BODY_CANARY,
  );
  expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
    EMAIL_BODY_CANARY,
  );
  expect(JSON.stringify(captureSpy.mock.calls)).not.toContain(
    EMAIL_BODY_CANARY,
  );
  expect(JSON.stringify([...settingsState.store.entries()])).not.toContain(
    EMAIL_BODY_CANARY,
  );
}

describe("Builder private-content diagnostics", () => {
  it("stops malformed tool input without returning it in an error event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonlResponse([
          {
            type: "tool-call-delta",
            id: "tool-1",
            name: "readSelected",
            delta: '{"body":"' + EMAIL_BODY_CANARY,
          },
          { type: "stop", reason: "tool_use" },
        ]),
      ),
    );
    const result = await drain(
      builderEngine().stream({ ...BASE_OPTS, privateContent: true }),
    );
    expect(result.thrown).toBeInstanceOf(PrivateCompletionError);
    expect(result.events.some((e) => e.type === "tool-call-error")).toBe(false);
    expect(
      JSON.stringify(result.events.filter((e) => e.type === "stop")),
    ).not.toContain(EMAIL_BODY_CANARY);
    expect(errorSurface(result.thrown)).not.toContain(EMAIL_BODY_CANARY);
  });
  it("retypes credential lookup errors before request construction", async () => {
    vi.mocked(resolveBuilderGatewayCredentialsDetailed).mockRejectedValueOnce(
      new Error(EMAIL_BODY_CANARY),
    );
    const result = await drain(
      createBuilderEngine().stream({ ...BASE_OPTS, privateContent: true }),
    );
    expect(result.thrown).toBeInstanceOf(PrivateCompletionError);
    expectPrivateClean(result);
  });

  it("does not log notice-cleanup failures after a private successful turn", async () => {
    vi.mocked(getRequestUserEmail).mockReturnValue("reader@example.test");
    builderCredState.clearCredit.mockRejectedValueOnce(
      new Error(EMAIL_BODY_CANARY),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonlResponse([{ type: "stop", reason: "end_turn" }])),
    );
    const result = await drain(
      builderEngine().stream({ ...BASE_OPTS, privateContent: true }),
    );
    expect(result.thrown).toBeUndefined();
    vi.mocked(getRequestUserEmail).mockReturnValue(undefined);
    expect(builderCredState.clearCredit).toHaveBeenCalled();
    expectPrivateClean(result);
  });

  beforeEach(() => {
    settingsState.store.clear();
    settingsState.getSetting.mockClear();
    settingsState.putSetting.mockClear();
    settingsState.deleteSetting.mockClear();
    builderCredState.clearCalls.mockClear();
    builderCredState.isConfigured.mockReset().mockReturnValue(false);
    builderCredState.baseUrl
      .mockReset()
      .mockReturnValue("https://gateway.test.invalid/gateway/v1");
    builderCredState.sendCredit.mockClear();
    builderCredState.clearCredit.mockClear();
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    captureSpy = vi
      .spyOn(captureErrorModule, "captureError")
      .mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("advertises private-content support only after audited handling", () => {
    expect(builderEngine().supportsPrivateContent).toBe(true);
  });

  it.each([
    { status: 400, code: "http_400" },
    { status: 403, code: "http_403" },
    { status: 429, code: "http_429" },
    { status: 500, code: "http_500" },
  ])(
    "keeps a private HTTP $status error free of provider content",
    async ({ status, code }) => {
      const response = jsonErrorResponse(status, {
        code: `provider_code_${EMAIL_BODY_CANARY}`,
        message: `provider echoed ${EMAIL_BODY_CANARY}`,
        errorCode: `provider_error_${EMAIL_BODY_CANARY}`,
        requestId: EMAIL_BODY_CANARY,
        upgradeUrl: `https://provider.invalid/${EMAIL_BODY_CANARY}`,
      });
      const textSpy = vi.spyOn(response, "text");
      const jsonSpy = vi.spyOn(response, "json");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );

      const { events, thrown } = await drain(
        builderEngine().stream({ ...BASE_OPTS, privateContent: true }),
      );

      expect(thrown).toBeUndefined();
      // The body is cancelled without being read on the private path.
      expect(textSpy).not.toHaveBeenCalled();
      expect(jsonSpy).not.toHaveBeenCalled();

      const stop = events.find((event) => event.type === "stop");
      expect(stop).toMatchObject({
        type: "stop",
        reason: "error",
        error: PRIVATE_COMPLETION_ERROR_MESSAGE,
        errorCode: code,
        provider: "builder",
        statusCode: status,
      });
      expect(stop.requestId).toBeUndefined();
      expect(stop.upgradeUrl).toBeUndefined();
      expect(stop.requestShape).toBeUndefined();

      expectPrivateClean({ events, thrown });
      expect(captureSpy).not.toHaveBeenCalled();
      expect(builderCredState.sendCredit).not.toHaveBeenCalled();
    },
  );

  it("keeps a private HTTP 401 a canonical auth failure with a sanitized marker", async () => {
    const response = jsonErrorResponse(401, {
      code: "unauthorized",
      message: `Invalid key ${EMAIL_BODY_CANARY}`,
      requestId: EMAIL_BODY_CANARY,
    });
    const textSpy = vi.spyOn(response, "text");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );

    const { events, thrown } = await drain(
      builderEngine().stream({ ...BASE_OPTS, privateContent: true }),
    );

    expect(thrown).toBeUndefined();
    // The 401 body is still cancelled without being read, as before.
    expect(textSpy).not.toHaveBeenCalled();

    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      type: "stop",
      reason: "error",
      error: PRIVATE_COMPLETION_ERROR_MESSAGE,
      errorCode: "builder_auth_error",
      provider: "builder",
      statusCode: 401,
    });
    expect(stop.requestId).toBeUndefined();
    expect(stop.requestShape).toBeUndefined();

    expectPrivateClean({ events, thrown });
    // The canonical auth marker is preserved, and it carries no provider echo.
    expect(settingsState.putSetting).toHaveBeenCalledTimes(1);
    const [, storedValue] = settingsState.putSetting.mock.calls[0];
    expect(JSON.stringify(storedValue)).not.toContain(EMAIL_BODY_CANARY);
    expect(storedValue).toMatchObject({
      provider: "builder",
      code: "builder_auth_error",
      status: 401,
    });
  });

  it.each([
    { reason: "invalid_request", status: 400 },
    { reason: "error", status: 500 },
    { reason: "rate_limited", status: 429 },
    { reason: "unexpected_stop_reason", status: 500 },
  ])(
    "keeps a private streamed $reason stop out of the error surface",
    async ({ reason, status }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonlResponse([
            {
              type: "stop",
              reason,
              error: `provider echoed ${EMAIL_BODY_CANARY}`,
              errorCode: `provider_code_${EMAIL_BODY_CANARY}`,
              requestId: EMAIL_BODY_CANARY,
              upgradeUrl: `https://provider.invalid/${EMAIL_BODY_CANARY}`,
            },
          ]),
        ),
      );

      const { events, thrown } = await drain(
        builderEngine().stream({ ...BASE_OPTS, privateContent: true }),
      );

      expect(thrown).toBeUndefined();
      const stop = events.find((event) => event.type === "stop");
      expect(stop).toMatchObject({
        type: "stop",
        reason: "error",
        error: PRIVATE_COMPLETION_ERROR_MESSAGE,
        errorCode: `http_${status}`,
        provider: "builder",
        statusCode: status,
      });
      expect(stop.requestId).toBeUndefined();
      expect(stop.upgradeUrl).toBeUndefined();
      expect(stop.requestShape).toBeUndefined();
      expect(events.some((event) => event.type === "assistant-content")).toBe(
        false,
      );

      expectPrivateClean({ events, thrown });
    },
  );

  it("does not flush buffered partial content before a private stream error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonlResponse([
          { type: "text-delta", text: PARTIAL_CONTENT_CANARY },
          {
            type: "stop",
            reason: "error",
            error: `provider echoed ${EMAIL_BODY_CANARY}`,
            errorCode: EMAIL_BODY_CANARY,
            requestId: EMAIL_BODY_CANARY,
          },
        ]),
      ),
    );

    const { events, thrown } = await drain(
      builderEngine().stream({ ...BASE_OPTS, privateContent: true }),
    );

    expect(thrown).toBeUndefined();
    // The error is emitted before the buffered text is flushed.
    expect(events.some((event) => event.type === "assistant-content")).toBe(
      false,
    );
    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      errorCode: "http_500",
      provider: "builder",
      statusCode: 500,
    });
    // The partial content may sit in the streamed delta, never in diagnostics.
    expect(JSON.stringify(stop)).not.toContain(PARTIAL_CONTENT_CANARY);
    expect(JSON.stringify(consoleLog.mock.calls)).not.toContain(
      PARTIAL_CONTENT_CANARY,
    );
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(
      PARTIAL_CONTENT_CANARY,
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      PARTIAL_CONTENT_CANARY,
    );
    expect(JSON.stringify(captureSpy.mock.calls)).not.toContain(
      PARTIAL_CONTENT_CANARY,
    );
    expect(JSON.stringify([...settingsState.store.entries()])).not.toContain(
      PARTIAL_CONTENT_CANARY,
    );
    expectPrivateClean({ events, thrown });
  });

  it("keeps a private streamed auth failure canonical with a sanitized marker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonlResponse([
          {
            type: "stop",
            reason: "error",
            errorCode: "unauthorized",
            error: `Invalid or inactive personal access token ${EMAIL_BODY_CANARY}`,
            requestId: EMAIL_BODY_CANARY,
          },
        ]),
      ),
    );

    const { events, thrown } = await drain(
      builderEngine().stream({ ...BASE_OPTS, privateContent: true }),
    );

    expect(thrown).toBeUndefined();
    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      type: "stop",
      reason: "error",
      error: PRIVATE_COMPLETION_ERROR_MESSAGE,
      errorCode: "builder_auth_error",
      provider: "builder",
      statusCode: 401,
    });
    expect(stop.requestId).toBeUndefined();
    expect(stop.requestShape).toBeUndefined();

    expectPrivateClean({ events, thrown });
    expect(settingsState.putSetting).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(settingsState.putSetting.mock.calls)).not.toContain(
      EMAIL_BODY_CANARY,
    );
  });

  it("maps private malformed JSONL to a fixed 502 without echoing the line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        rawStreamResponse([`this is not json ${EMAIL_BODY_CANARY}\n`]),
      ),
    );

    const { events, thrown } = await drain(
      builderEngine().stream({ ...BASE_OPTS, privateContent: true }),
    );

    expect(thrown).toBeUndefined();
    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      type: "stop",
      reason: "error",
      error: PRIVATE_COMPLETION_ERROR_MESSAGE,
      errorCode: "http_502",
      provider: "builder",
      statusCode: 502,
    });
    expect(stop.requestShape).toBeUndefined();
    expect(JSON.stringify(stop)).not.toContain(EMAIL_BODY_CANARY);

    expectPrivateClean({ events, thrown });
  });

  it("yields and throws a fixed typed error for a private network failure", async () => {
    const transportError = Object.assign(
      new Error(`network failed ${EMAIL_BODY_CANARY}`),
      {
        cause: new Error(`socket cause ${EMAIL_BODY_CANARY}`),
        status: 502,
      },
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(transportError));

    const { events, thrown } = await drain(
      builderEngine().stream({ ...BASE_OPTS, privateContent: true }),
    );

    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    expect(thrown.provider).toBe("builder");
    expect(thrown.code).toBe("http_502");
    expect(thrown.statusCode).toBe(502);
    expect(thrown).not.toBe(transportError);
    expect(thrown.cause).toBeUndefined();

    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      type: "stop",
      reason: "error",
      error: PRIVATE_COMPLETION_ERROR_MESSAGE,
      errorCode: "http_502",
      provider: "builder",
      statusCode: 502,
    });
    expect(stop.requestShape).toBeUndefined();

    expectPrivateClean({ events, thrown });
  });

  it("yields and throws a fixed typed error when the stream itself throws", async () => {
    let pulled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!pulled) {
          pulled = true;
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({
                type: "text-delta",
                text: PARTIAL_CONTENT_CANARY,
              }) + "\n",
            ),
          );
          return;
        }
        controller.error(new Error(`stream transport ${EMAIL_BODY_CANARY}`));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(stream, {
            status: 200,
            headers: { "Content-Type": "application/jsonl" },
          }),
      ),
    );

    const { events, thrown } = await drain(
      builderEngine().stream({ ...BASE_OPTS, privateContent: true }),
    );

    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    expect(thrown.provider).toBe("builder");
    expect(thrown.code).toBe("http_502");
    expect(thrown.statusCode).toBe(502);

    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      type: "stop",
      reason: "error",
      error: PRIVATE_COMPLETION_ERROR_MESSAGE,
      errorCode: "http_502",
      provider: "builder",
      statusCode: 502,
    });
    expect(stop.requestShape).toBeUndefined();
    expect(events.some((event) => event.type === "assistant-content")).toBe(
      false,
    );

    expectPrivateClean({ events, thrown });
  });

  it("yields and throws a fixed typed timeout with no abort reason leak", async () => {
    vi.stubEnv("AGENT_NATIVE_BUILDER_GATEWAY_TIMEOUT_MS", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new Error(`aborted ${EMAIL_BODY_CANARY}`));
            });
          }),
      ),
    );

    const { events, thrown } = await drain(
      builderEngine().stream({ ...BASE_OPTS, privateContent: true }),
    );

    expect(thrown).toBeInstanceOf(PrivateCompletionError);
    expect(thrown.provider).toBe("builder");
    expect(thrown.code).toBe("http_504");
    expect(thrown.statusCode).toBe(504);

    const stop = events.find((event) => event.type === "stop");
    expect(stop).toMatchObject({
      type: "stop",
      reason: "error",
      error: PRIVATE_COMPLETION_ERROR_MESSAGE,
      errorCode: "http_504",
      provider: "builder",
      statusCode: 504,
    });
    expect(stop.requestShape).toBeUndefined();

    expectPrivateClean({ events, thrown });
  });

  it("leaves the ordinary non-private HTTP error surface unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonErrorResponse(500, {
          code: "provider_error",
          message: `provider echoed ${EMAIL_BODY_CANARY}`,
        }),
      ),
    );

    const { events, thrown } = await drain(builderEngine().stream(BASE_OPTS));

    expect(thrown).toBeUndefined();
    const stop = events.find((event) => event.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(String(stop?.error)).toContain(EMAIL_BODY_CANARY);
  });
});
