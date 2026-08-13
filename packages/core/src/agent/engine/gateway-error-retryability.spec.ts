import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLAUDE_SONNET_MODEL_ID } from "../model-config.js";
import { isRetryableError } from "../production-agent.js";
import { createBuilderEngine } from "./builder-engine.js";
import { GATEWAY_UNAVAILABLE_VISITOR_MESSAGE } from "./credential-errors.js";
import { EngineError, type EngineStreamOptions } from "./types.js";

/**
 * The contract between the Builder engine's terminal stop events and
 * production-agent's `isRetryableError`. It lives in its own file because it is
 * the only engine spec that needs the agent's real predicate rather than a
 * restatement of it — a mirrored copy of the retry rules here would pass while
 * production retried nothing.
 */

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
  model: CLAUDE_SONNET_MODEL_ID,
  systemPrompt: "You are helpful.",
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  tools: [],
  abortSignal: new AbortController().signal,
};

describe("Builder gateway error retryability", () => {
  beforeEach(() => {
    credentialState.lane = "identity";
    vi.stubEnv("BUILDER_GATEWAY_BASE_URL", "https://test.example/gateway/v1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Every gateway-error emission path, run through the real predicate on both
  // lanes. The visitor rewrite replaces the message `isRetryableError` used to
  // keyword-match, so a branch that keeps its retry decision in the message
  // reads as terminal on credits sites alone — enumerated rather than
  // spot-checked because that is how the last one was missed.
  //
  // The list covers the emissions with no HTTP response behind them too
  // (transport failure, unparseable JSONL, a stream that stopped early). Those
  // three built their own stop events and so skipped the rewrite entirely: the
  // visitor read "reduce the prompt size or try again when the gateway is less
  // busy" about someone else's Builder org.
  describe("retryability is structural on every gateway-error branch", () => {
    const branches: Array<{
      label: string;
      response?: () => Response;
      /** Reject the fetch — the transport-failure emissions. */
      rejectWith?: () => unknown;
      /** Full control, for the branch that needs the abort deadline to fire. */
      fetchImpl?: () => (url: string, init?: RequestInit) => Promise<Response>;
      env?: Record<string, string>;
      retryable: boolean;
    }> = [
      {
        label: "402 credits limit",
        response: () =>
          jsonErrorResponse(402, {
            code: "credits-limit-reached",
            message: "You have used all AI credits for this month",
          }),
        retryable: false,
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
        // Terminal at the turn level on purpose: the timeout spent the whole
        // request budget, so recovery is a fresh invocation, not an in-call
        // retry. `isRetryableError` hard-excludes the code.
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
        // Also terminal at the turn level: the partial turn is real, and an
        // in-loop retry would `clear` it and re-run the whole call. The client
        // continues it instead, off `builder_gateway_stream_ended`.
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
          // The other half of the same guarantee: whatever the branch decided,
          // a visitor is told one line and nothing else.
          if (lane === "gateway-deploy") {
            expect(stop.error).toBe(GATEWAY_UNAVAILABLE_VISITOR_MESSAGE);
            expect(stop.upgradeUrl).toBeUndefined();
          } else {
            expect(stop.error).not.toBe(GATEWAY_UNAVAILABLE_VISITOR_MESSAGE);
          }
          const engineError = new EngineError(stop.error ?? "", {
            errorCode: stop.errorCode,
            statusCode: stop.statusCode,
            providerRetryable: stop.providerRetryable,
          });
          expect(isRetryableError(engineError)).toBe(branch.retryable);
        });
      }
    }

    // The table above can only cover branches someone remembered to add to it.
    // This covers the next one: `gatewayErrorStop` is the single place allowed
    // to build a terminal error stop in this module, so a new branch that writes
    // its own literal — the way all three transport paths did — fails here
    // instead of shipping owner copy to a visitor.
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

    // The daily cap shares 429 with the transient throttle, so it must carry no
    // retry field at all: a bare status is a retry signal on its own.
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
