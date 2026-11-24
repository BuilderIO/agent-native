import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BUILDER_CLAUDE_SONNET_MODEL_ID } from "../model-config.js";
import {
  isContextTooLongError,
  isRecoverableContinuationError,
  isResumableEngineError,
  isRetryableError,
  isTransientProviderRateLimitError,
} from "../production-agent.js";
import { createBuilderEngine } from "./builder-engine.js";
import { GATEWAY_UNAVAILABLE_VISITOR_MESSAGE } from "./credential-errors.js";
import { classifyProviderError } from "./error-detail.js";
import { PRIVATE_COMPLETION_ERROR_MESSAGE } from "./private-completion-error.js";
import { EngineError, type EngineStreamOptions } from "./types.js";

const credentialState = vi.hoisted(() => ({
  lane: "identity" as "identity" | "gateway-deploy" | null,
}));

vi.mock("../../server/credential-provider.js", async (importOriginal) => {
  const original =
    (await importOriginal()) as typeof import("../../server/credential-provider.js");
  return {
    ...original,
    resolveBuilderGatewayCredentialsDetailed: vi.fn(async () => ({
      privateKey: "bpk-test",
      publicKey: "space-test",
      userId: null,
      orgName: null,
      orgKind: null,
      subscription: null,
      subscriptionLevel: null,
      subscriptionName: null,
      isEnterprise: null,
      isFreeAccount: null,
      source: "user" as const,
      lookupFailed: false,
      lane: credentialState.lane,
    })),
    clearBuilderGatewayAuthFailure: vi.fn(async () => {}),
    recordBuilderGatewayAuthFailure: vi.fn(async () => {}),
  };
});

async function collectEvents(iterable: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const e of iterable) events.push(e);
  return events;
}

function jsonlResponse(events: unknown[]): Response {
  const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  const encoded = new TextEncoder().encode(body);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "application/jsonl" } },
  );
}

function jsonErrorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE_OPTS: EngineStreamOptions = {
  model: BUILDER_CLAUDE_SONNET_MODEL_ID,
  systemPrompt: "You are helpful.",
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  tools: [],
  abortSignal: new AbortController().signal,
};

describe("Builder gateway error retryability", () => {
  beforeEach(() => {
    credentialState.lane = "identity";
    vi.stubEnv("BUILDER_GATEWAY_BASE_URL", "https://test.example/gateway/v1");
    vi.stubEnv("FUSION_ENVIRONMENT", undefined);
    vi.stubEnv("FUSION_ENV_ORIGIN", undefined);
    vi.stubEnv("VITE_FUSION_ENV_ORIGIN", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("retryability is structural on every gateway-error branch", () => {
    const branches: Array<{
      label: string;
      response?: () => Response;
      rejectWith?: () => unknown;
      fetchImpl?: () => (url: string, init?: RequestInit) => Promise<Response>;
      env?: Record<string, string>;
      upgradeUrl?: boolean;
      expectedErrorCode?: string;
      expectedProviderRetryable?: boolean;
      expectedContextOverflow?: boolean;
      retryable: boolean;
    }> = [
      ...["credits-limit-daily", "credits-limit-monthly"].flatMap((code) => [
        ...[429, 500].map((status) => ({
          label: `${status} nested ${code} with generic top-level code`,
          response: () =>
            jsonErrorResponse(status, {
              code: "gateway_error",
              error: { code, message: "quota exceeded" },
            }),
          retryable: false,
          upgradeUrl: true,
          expectedErrorCode: code,
          expectedProviderRetryable: false,
        })),
        ...[402, 429, 500].map((status) => ({
          label: `${status} ${code} with transient wording`,
          response: () =>
            jsonErrorResponse(status, { code, message: "quota exceeded" }),
          retryable: false,
          upgradeUrl: true,
          expectedErrorCode: code,
          expectedProviderRetryable: false,
        })),
        ...["error", "invalid_request", "rate_limited"].map((reason) => ({
          label: `in-stream ${reason} ${code} with transient wording`,
          response: () =>
            jsonlResponse([
              {
                type: "stop",
                reason,
                code,
                statusCode: 429,
                error: "quota exceeded",
              },
            ]),
          retryable: false,
          upgradeUrl: true,
          expectedErrorCode: code,
          expectedProviderRetryable: false,
        })),
        {
          label: `in-stream ${code} with connection wording`,
          response: () =>
            jsonlResponse([
              {
                type: "stop",
                reason: "error",
                code,
                error: "Connection error",
              },
            ]),
          retryable: false,
          upgradeUrl: true,
          expectedErrorCode: code,
          expectedProviderRetryable: false,
        },
      ]),
      ...["credits-limit-daily", "credits-limit-monthly"].flatMap((code) => [
        {
          label: `in-stream specific ${code} with generic errorCode`,
          response: () =>
            jsonlResponse([
              {
                type: "stop",
                reason: "error",
                errorCode: "gateway_error",
                code,
                error: "quota exceeded",
              },
            ]),
          retryable: false,
          upgradeUrl: true,
          expectedErrorCode: code,
          expectedProviderRetryable: false,
        },
        ...["http", "stream"].map((transport) => ({
          label: `${transport} ${code} with context-overflow wording`,
          response: () =>
            transport === "http"
              ? jsonErrorResponse(429, { code, message: "prompt is too long" })
              : jsonlResponse([
                  {
                    type: "stop",
                    reason: "error",
                    code,
                    error: "prompt is too long",
                  },
                ]),
          retryable: false,
          upgradeUrl: true,
          expectedErrorCode: code,
          expectedProviderRetryable: false,
          expectedContextOverflow: false,
        })),
      ]),
      ...["error", "rate_limited"].map((reason) => ({
        label: `in-stream 402 status with ${reason} reason`,
        response: () =>
          jsonlResponse([
            { type: "stop", reason, statusCode: 402, error: "quota exceeded" },
          ]),
        retryable: false,
        upgradeUrl: true,
        expectedErrorCode: "http_402",
        expectedProviderRetryable: false,
      })),
      {
        label: "in-stream 402 status with context-overflow wording",
        response: () =>
          jsonlResponse([
            {
              type: "stop",
              reason: "error",
              statusCode: 402,
              error: "prompt is too long",
            },
          ]),
        retryable: false,
        upgradeUrl: true,
        expectedErrorCode: "http_402",
        expectedProviderRetryable: false,
        expectedContextOverflow: false,
      },
      {
        label: "in-stream 402 code with transient wording",
        response: () =>
          jsonlResponse([
            {
              type: "stop",
              reason: "error",
              code: "http_402",
              error: "quota exceeded",
            },
          ]),
        retryable: false,
        upgradeUrl: true,
        expectedErrorCode: "http_402",
        expectedProviderRetryable: false,
      },
      {
        label: "429 nested http_402 with rate_limited top-level code",
        response: () =>
          jsonErrorResponse(429, {
            code: "rate_limited",
            error: { code: "http_402", message: "quota exceeded" },
          }),
        retryable: false,
        upgradeUrl: true,
        expectedErrorCode: "http_402",
        expectedProviderRetryable: false,
      },
      {
        label: "429 nested explicit credit code with top-level http_402",
        response: () =>
          jsonErrorResponse(429, {
            code: "http_402",
            error: { code: "credits-limit-monthly", message: "quota exceeded" },
          }),
        retryable: false,
        upgradeUrl: true,
        expectedErrorCode: "credits-limit-monthly",
        expectedProviderRetryable: false,
      },
      {
        label: "429 rate_limited without credit code",
        response: () =>
          jsonErrorResponse(429, {
            code: "rate_limited",
            error: { code: "gateway_error", message: "quota exceeded" },
          }),
        retryable: true,
        expectedErrorCode: "rate_limited",
        expectedProviderRetryable: true,
      },
      {
        label: "402 credits limit",
        response: () =>
          jsonErrorResponse(402, {
            code: "credits-limit-reached",
            message: "You have used all AI credits for this month",
          }),
        retryable: false,
        upgradeUrl: true,
      },
      {
        label: "402 with an unrecognized payment code",
        response: () =>
          jsonErrorResponse(402, {
            code: "payment_required",
            message: "Payment required",
          }),
        retryable: false,
        upgradeUrl: true,
        expectedErrorCode: "http_402",
      },
      {
        label: "403 gateway_not_enabled",
        response: () =>
          jsonErrorResponse(403, {
            code: "gateway_not_enabled",
            message: "Gateway is not enabled for this space",
          }),
        retryable: false,
      },
      {
        label: "401 unauthorized",
        response: () =>
          jsonErrorResponse(401, { code: "unauthorized", message: "Bad key" }),
        retryable: false,
      },
      {
        label: "403 forbidden",
        response: () =>
          jsonErrorResponse(403, { code: "forbidden", message: "Not allowed" }),
        retryable: false,
      },
      {
        label: "429 daily creator cap",
        response: () =>
          jsonErrorResponse(429, {
            code: "rate_limit_exceeded",
            message: "Daily gateway request cap reached",
          }),
        retryable: false,
      },
      {
        label:
          "429 non-credit top-level code takes precedence over nested code",
        response: () =>
          jsonErrorResponse(429, {
            code: "too_many_concurrent_requests",
            error: { code: "other_gateway_error", message: "rate limited" },
          }),
        expectedErrorCode: "too_many_concurrent_requests",
        retryable: true,
      },
      {
        label: "429 org concurrency cap",
        response: () =>
          jsonErrorResponse(429, {
            code: "too_many_concurrent_requests",
            message:
              "Too many concurrent gateway requests for this organization (cap: 500).",
          }),
        retryable: true,
      },
      {
        label: "503 upstream overloaded",
        response: () =>
          jsonErrorResponse(503, { code: "overloaded", message: "Overloaded" }),
        retryable: true,
      },
      {
        label: "504 upstream gave up",
        response: () =>
          jsonErrorResponse(504, {
            code: "upstream_unavailable",
            message: "The upstream provider did not answer",
          }),
        retryable: true,
      },
      {
        label: "400 malformed request",
        response: () =>
          jsonErrorResponse(400, {
            code: "invalid_request_error",
            message: "model is required",
          }),
        retryable: false,
      },
      {
        label: "502 html proxy page",
        response: () =>
          new Response("<html>bad gateway</html>", {
            status: 502,
            headers: { "Content-Type": "text/html" },
          }),
        retryable: true,
      },
      {
        label: "200 with no response body",
        response: () =>
          new Response(null, {
            status: 200,
            headers: { "Content-Type": "application/jsonl" },
          }),
        retryable: true,
      },
      {
        label: "in-stream upstream overloaded",
        response: () =>
          jsonlResponse([
            { type: "stop", reason: "error", error: "Overloaded" },
          ]),
        retryable: true,
      },
      {
        label: "in-stream rate_limited",
        response: () =>
          jsonlResponse([
            {
              type: "stop",
              reason: "rate_limited",
              error: "upstream provider rate limited",
            },
          ]),
        retryable: true,
      },
      {
        label: "in-stream error with no detail",
        response: () => jsonlResponse([{ type: "stop", reason: "error" }]),
        retryable: true,
      },
      {
        label: "in-stream no-detail invalid_request",
        response: () =>
          jsonlResponse([
            {
              type: "stop",
              reason: "error",
              code: "invalid_request",
              requestId: "req_invalid_request",
            },
          ]),
        retryable: false,
        expectedErrorCode: "invalid_request",
      },
      {
        label: "in-stream generic error with invalid_request code",
        response: () =>
          jsonlResponse([
            {
              type: "stop",
              reason: "error",
              code: "invalid_request",
              error: "Internal Server Error",
            },
          ]),
        retryable: true,
        expectedErrorCode: "builder_gateway_internal_error",
      },
      {
        label: "in-stream invalid_request reason with generic server error",
        response: () =>
          jsonlResponse([
            {
              type: "stop",
              reason: "invalid_request",
              code: "invalid_request",
              error: "Internal Server Error",
            },
          ]),
        retryable: true,
        expectedErrorCode: "builder_gateway_internal_error",
      },
      {
        label: "in-stream invalid_request with transient wording",
        response: () =>
          jsonlResponse([
            {
              type: "stop",
              reason: "error",
              code: "invalid_request",
              error: "Request timed out while validating the payload",
            },
          ]),
        retryable: false,
        expectedErrorCode: "invalid_request",
      },
      {
        label: "in-stream gateway internal error envelope",
        response: () =>
          jsonlResponse([
            {
              type: "stop",
              reason: "error",
              error:
                "Sorry, we ran into an issue processing your request. ERROR ID: bebaeb5da13441539790834b63ff955a",
            },
          ]),
        retryable: true,
      },
      {
        label: "in-stream generic Internal Server Error",
        response: () =>
          jsonlResponse([
            { type: "stop", reason: "error", error: "Internal Server Error" },
          ]),
        retryable: true,
        expectedErrorCode: "builder_gateway_internal_error",
      },
      {
        label: "http 500 gateway internal error envelope",
        response: () =>
          jsonErrorResponse(500, {
            message:
              "Sorry, we ran into an issue processing your request. ERROR ID: bebaeb5da13441539790834b63ff955a",
          }),
        retryable: true,
      },
      {
        label: "in-stream credits limit",
        response: () =>
          jsonlResponse([
            {
              type: "stop",
              reason: "error",
              error: "You have used all AI credits for this month",
              code: "credits-limit-reached",
            },
          ]),
        retryable: false,
        upgradeUrl: true,
      },
      {
        label: "in-stream invalid_request",
        response: () =>
          jsonlResponse([
            {
              type: "stop",
              reason: "invalid_request",
              error:
                "messages.3: tool_use block must have a corresponding tool_result",
            },
          ]),
        retryable: false,
      },
      {
        label: "in-stream unknown stop reason",
        response: () =>
          jsonlResponse([{ type: "stop", reason: "provider_exploded" }]),
        retryable: false,
      },
      {
        label: "transport timed out",
        env: { AGENT_NATIVE_BUILDER_GATEWAY_TIMEOUT_MS: "1" },
        fetchImpl: () => (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(init.signal?.reason ?? new Error("aborted"));
            });
          }),
        retryable: false,
      },
      {
        label: "transport dropped the connection",
        rejectWith: () => new Error("socket hang up"),
        retryable: true,
      },
      {
        label: "transport failed with no recognizable signature",
        rejectWith: () => new TypeError("Invalid URL"),
        retryable: false,
      },
      {
        label: "unparseable JSONL",
        response: () =>
          new Response("this is not JSONL\n", {
            status: 200,
            headers: { "Content-Type": "application/jsonl" },
          }),
        retryable: true,
      },
      {
        label: "stream ended without a stop event",
        response: () =>
          jsonlResponse([{ type: "text-delta", text: "partial" }]),
        retryable: false,
      },
    ];

    for (const lane of ["identity", "gateway-deploy"] as const) {
      for (const branch of branches) {
        it(`${branch.label} is ${branch.retryable ? "retryable" : "terminal"} on the ${lane} lane`, async () => {
          credentialState.lane = lane;
          if (lane === "gateway-deploy") {
            vi.stubEnv("BUILDER_GATEWAY_TOKEN", "btk-site-token");
          }
          for (const [key, value] of Object.entries(branch.env ?? {})) {
            vi.stubEnv(key, value);
          }
          vi.stubGlobal(
            "fetch",
            branch.fetchImpl
              ? vi.fn(branch.fetchImpl())
              : branch.rejectWith
                ? vi.fn().mockRejectedValue(branch.rejectWith())
                : vi.fn().mockResolvedValue(branch.response!()),
          );

          const events = await collectEvents(
            createBuilderEngine().stream(BASE_OPTS),
          );
          const stop = events.find(
            (e) => e.type === "stop" && e.reason === "error",
          );

          expect(stop).toBeDefined();
          if (lane === "gateway-deploy") {
            expect(stop.error).toBe(GATEWAY_UNAVAILABLE_VISITOR_MESSAGE);
          } else {
            expect(stop.error).not.toBe(GATEWAY_UNAVAILABLE_VISITOR_MESSAGE);
          }
          expect(stop.upgradeUrl?.includes("builder.io") ?? false).toBe(
            Boolean(branch.upgradeUrl),
          );
          expect(stop.errorCode).toEqual(
            branch.expectedErrorCode ?? stop.errorCode,
          );
          const engineError = new EngineError(stop.error ?? "", {
            errorCode: stop.errorCode,
            statusCode: stop.statusCode,
            providerRetryable: stop.providerRetryable,
            contextOverflow: stop.contextOverflow,
          });
          expect(isRetryableError(engineError)).toBe(branch.retryable);
          const contextOverflow = stop.contextOverflow ?? false;
          const classifiedContextOverflow = isContextTooLongError(engineError);
          expect(contextOverflow).toBe(
            branch.expectedContextOverflow ?? contextOverflow,
          );
          expect(classifiedContextOverflow).toBe(
            branch.expectedContextOverflow ?? classifiedContextOverflow,
          );
          expect(stop.providerRetryable).toBe(
            branch.expectedProviderRetryable ?? stop.providerRetryable,
          );
        });
      }
    }

    it.each(["credits-limit-daily", "credits-limit-monthly"])(
      "does not retry %s despite conflicting retry signals",
      (errorCode) => {
        for (const statusCode of [429, 500]) {
          for (const providerRetryable of [undefined, true]) {
            const error = new EngineError("gateway timeout: quota exceeded", {
              errorCode,
              statusCode,
              providerRetryable,
            });
            expect(isRetryableError(error)).toBe(false);
            expect(isResumableEngineError(error)).toBe(false);
            expect(isTransientProviderRateLimitError(error)).toBe(false);
            expect(
              isRecoverableContinuationError({
                type: "error",
                error: error.message,
                errorCode,
                providerRetryable,
                recoverable: true,
              }),
            ).toBe(false);
          }
        }
      },
    );

    it.each(["credits-limit-daily", "credits-limit-monthly"])(
      "keeps private streamed %s terminal without exposing provider data",
      async (code) => {
        const canary = "synthetic-private-body-canary";
        const logs = ["log", "warn", "error"].map((level) =>
          vi
            .spyOn(console, level as "log" | "warn" | "error")
            .mockImplementation(() => {}),
        );
        for (const reason of ["error", "invalid_request", "rate_limited"]) {
          vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
              jsonlResponse([
                {
                  type: "stop",
                  reason,
                  errorCode: "gateway_error",
                  code,
                  statusCode: 429,
                  error: `prompt is too long ${canary}`,
                  requestId: canary,
                },
              ]),
            ),
          );
          const events = await collectEvents(
            createBuilderEngine().stream({
              ...BASE_OPTS,
              privateContent: true,
            }),
          );
          const stop = events.find((event) => event.type === "stop");
          expect(stop).toMatchObject({
            type: "stop",
            reason: "error",
            error: PRIVATE_COMPLETION_ERROR_MESSAGE,
            errorCode: "private_completion_error",
            provider: "builder",
            providerRetryable: false,
          });
          expect(JSON.stringify(events)).not.toContain(canary);
          expect(JSON.stringify(events)).not.toContain(code);
          const error = new EngineError(stop.error, {
            errorCode: stop.errorCode,
            statusCode: stop.statusCode,
            providerRetryable: stop.providerRetryable,
            contextOverflow: stop.contextOverflow,
          });
          expect(isRetryableError(error)).toBe(false);
          expect(isContextTooLongError(error)).toBe(false);
          expect(isTransientProviderRateLimitError(error)).toBe(false);
          expect(isResumableEngineError(error)).toBe(false);
        }
        expect(JSON.stringify(logs.map((log) => log.mock.calls))).not.toContain(
          canary,
        );
      },
    );

    it.each(["http", "stream"])(
      "keeps private Builder %s 402 terminal",
      async (transport) => {
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue(
            transport === "http"
              ? jsonErrorResponse(402, { message: "private canary" })
              : jsonlResponse([
                  {
                    type: "stop",
                    reason: "error",
                    statusCode: 402,
                    error: "private canary",
                  },
                ]),
          ),
        );
        const events = await collectEvents(
          createBuilderEngine().stream({ ...BASE_OPTS, privateContent: true }),
        );
        const stop = events.find((event) => event.type === "stop");
        expect(stop).toMatchObject({
          error: PRIVATE_COMPLETION_ERROR_MESSAGE,
          errorCode: "http_402",
          statusCode: 402,
          providerRetryable: false,
        });
        expect(JSON.stringify(events)).not.toContain("private canary");
        expect(
          isRetryableError(
            new EngineError(stop.error, {
              errorCode: stop.errorCode,
              statusCode: stop.statusCode,
              providerRetryable: stop.providerRetryable,
            }),
          ),
        ).toBe(false);
      },
    );

    it("keeps a genuine private gateway throttle retryable", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          jsonlResponse([
            {
              type: "stop",
              reason: "rate_limited",
              statusCode: 429,
              error: "private canary",
            },
          ]),
        ),
      );
      const events = await collectEvents(
        createBuilderEngine().stream({ ...BASE_OPTS, privateContent: true }),
      );
      const stop = events.find((event) => event.type === "stop");
      expect(stop).toMatchObject({
        error: PRIVATE_COMPLETION_ERROR_MESSAGE,
        errorCode: "http_429",
        statusCode: 429,
      });
      expect(JSON.stringify(events)).not.toContain("private canary");
      expect(
        isRetryableError(
          new EngineError(stop.error, {
            errorCode: stop.errorCode,
            statusCode: stop.statusCode,
            providerRetryable: stop.providerRetryable,
          }),
        ),
      ).toBe(true);
    });

    it("does not treat explicit credits as context overflow even with a conflicting flag", () => {
      expect(
        isContextTooLongError(
          new EngineError("prompt is too long", {
            errorCode: "credits-limit-daily",
            contextOverflow: true,
          }),
        ),
      ).toBe(false);
    });

    it("honors a non-Builder provider's retryable HTTP 402 classification", () => {
      const classified = classifyProviderError(
        Object.assign(new Error("temporary upstream refusal"), {
          statusCode: 402,
          isRetryable: true,
        }),
      );
      expect(classified).toMatchObject({
        errorCode: "http_402",
        statusCode: 402,
        providerRetryable: true,
      });
      expect(
        isRetryableError(
          new EngineError("temporary upstream refusal", classified),
        ),
      ).toBe(true);
    });

    it("builds every terminal error stop through gatewayErrorStop", () => {
      const source = readFileSync(
        new URL("./builder-engine.ts", import.meta.url),
        "utf8",
      );
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const literals = code.match(/reason:\s*"error"/g) ?? [];

      expect(literals).toHaveLength(1);
      expect(code).toMatch(
        /function gatewayErrorStop\([\s\S]*?reason:\s*"error"/,
      );
    });

    it("gives the daily gateway cap no structured retry signal", async () => {
      credentialState.lane = "gateway-deploy";
      vi.stubEnv("BUILDER_GATEWAY_TOKEN", "btk-site-token");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          jsonErrorResponse(429, {
            code: "rate_limit_exceeded",
            message: "Daily gateway request cap reached",
          }),
        ),
      );

      const events = await collectEvents(
        createBuilderEngine().stream(BASE_OPTS),
      );
      const stop = events.find((e) => e.type === "stop");

      expect(stop?.errorCode).toBe("rate_limit_exceeded");
      expect(stop?.statusCode).toBeUndefined();
      expect(stop?.providerRetryable).toBeUndefined();
    });
  });
});
