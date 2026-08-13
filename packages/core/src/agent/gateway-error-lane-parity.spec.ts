import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBuilderEngine } from "./engine/builder-engine.js";
import { GATEWAY_UNAVAILABLE_VISITOR_MESSAGE } from "./engine/credential-errors.js";
import { classifyTerminalErrorCode } from "./engine/error-detail.js";
import { EngineError, type EngineStreamOptions } from "./engine/types.js";
import { CLAUDE_SONNET_MODEL_ID } from "./model-config.js";
import {
  continuationReasonForResumableError,
  isContextTooLongError,
  isRecoverableContinuationError,
  isResumableEngineError,
  isRetryableError,
  isTransientProviderRateLimitError,
} from "./production-agent.js";

/**
 * A Builder-credits deployment answers every gateway rejection with one visitor
 * line, so any verdict a downstream classifier left in the message text is gone
 * on those sites and only on those sites. Three separate predicates shipped that
 * way on this branch — retryability, background continuation, and the
 * context-overflow trim-and-retry — so this file asserts the property rather
 * than the three fixes: every classifier of a gateway failure reaches the same
 * verdict on both lanes, and a new one that does not is a test failure rather
 * than a production report.
 *
 * Verdicts are ALSO pinned absolutely. Parity alone passes when both lanes are
 * equally wrong, which is exactly how a "the gateway lane matches" assertion
 * would have hidden the context-overflow bug in reverse.
 */

const credentialState = vi.hoisted(() => ({
  lane: "identity" as "identity" | "gateway-deploy" | null,
}));

vi.mock("../server/credential-provider.js", async (importOriginal) => {
  const original =
    (await importOriginal()) as typeof import("../server/credential-provider.js");
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

const BASE_OPTS: EngineStreamOptions = {
  model: CLAUDE_SONNET_MODEL_ID,
  systemPrompt: "You are helpful.",
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  tools: [],
  abortSignal: new AbortController().signal,
};

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

interface GatewayFailure {
  label: string;
  response?: () => Response;
  rejectWith?: () => unknown;
  fetchImpl?: () => (url: string, init?: RequestInit) => Promise<Response>;
  env?: Record<string, string>;
  /** Verdicts pinned on BOTH lanes, so parity can never pass vacuously. */
  expect?: Partial<Record<keyof typeof PARITY_CHECKED, unknown>>;
}

const FAILURES: GatewayFailure[] = [
  {
    // The gateway reports a context overflow as an ordinary 400, so the prose
    // was the only carrier — and the visitor line replaced it.
    label: "400 prompt too long",
    response: () =>
      jsonErrorResponse(400, {
        code: "invalid_request_error",
        message: "prompt is too long: 214000 tokens > 200000 maximum",
      }),
    expect: { isContextTooLongError: true, isRetryableError: false },
  },
  {
    label: "in-stream invalid_request prompt too long",
    response: () =>
      jsonlResponse([
        {
          type: "stop",
          reason: "invalid_request",
          error: "prompt is too long: 214000 tokens > 200000 maximum",
        },
      ]),
    expect: { isContextTooLongError: true, isRetryableError: false },
  },
  {
    label: "in-stream invalid_request on broken history",
    response: () =>
      jsonlResponse([
        {
          type: "stop",
          reason: "invalid_request",
          error:
            "messages.3: tool_use block must have a corresponding tool_result",
        },
      ]),
    expect: { isContextTooLongError: false, isRetryableError: false },
  },
  {
    // The BLOCKER: a truncated stream is continued, not retried, and the code is
    // the only thing that says so once the sentence is replaced.
    label: "stream ended without a stop event",
    response: () => jsonlResponse([{ type: "text-delta", text: "partial" }]),
    expect: {
      isRetryableError: false,
      isResumableEngineError: true,
      isRecoverableContinuationError: true,
    },
  },
  {
    label: "503 temporarily unavailable with no body code",
    response: () =>
      jsonErrorResponse(503, { message: "Service temporarily unavailable" }),
    expect: {
      isRetryableError: true,
      isRecoverableContinuationError: true,
    },
  },
  {
    label: "504 upstream gateway timeout with no body code",
    response: () =>
      jsonErrorResponse(504, { message: "Upstream gateway timeout" }),
    expect: {
      isRecoverableContinuationError: true,
      continuationReasonForResumableError: "gateway_timeout",
    },
  },
  {
    label: "429 org concurrency cap",
    response: () =>
      jsonErrorResponse(429, {
        code: "too_many_concurrent_requests",
        message:
          "Too many concurrent gateway requests for this organization (cap: 500).",
      }),
    expect: {
      isRetryableError: true,
      isTransientProviderRateLimitError: true,
    },
  },
  {
    label: "429 daily creator cap",
    response: () =>
      jsonErrorResponse(429, {
        code: "rate_limit_exceeded",
        message: "Daily gateway request cap reached",
      }),
    expect: {
      isRetryableError: false,
      isTransientProviderRateLimitError: false,
      isRecoverableContinuationError: false,
    },
  },
  {
    label: "402 credits limit",
    response: () =>
      jsonErrorResponse(402, {
        code: "credits-limit-reached",
        message: "You have used all AI credits for this month",
      }),
    expect: { isRetryableError: false, isRecoverableContinuationError: false },
  },
  {
    label: "401 unauthorized",
    response: () =>
      jsonErrorResponse(401, { code: "unauthorized", message: "Bad key" }),
    expect: { isRetryableError: false, isRecoverableContinuationError: false },
  },
  {
    label: "in-stream upstream overloaded with no code",
    response: () =>
      jsonlResponse([{ type: "stop", reason: "error", error: "Overloaded" }]),
    expect: { isRetryableError: true },
  },
  {
    label: "in-stream unknown stop reason",
    response: () =>
      jsonlResponse([{ type: "stop", reason: "provider_exploded" }]),
    expect: { isRetryableError: false, isRecoverableContinuationError: false },
  },
  {
    label: "unparseable JSONL",
    response: () =>
      new Response("this is not JSONL\n", {
        status: 200,
        headers: { "Content-Type": "application/jsonl" },
      }),
    expect: { isRetryableError: true, isResumableEngineError: true },
  },
  {
    label: "transport dropped the connection",
    rejectWith: () => new Error("socket hang up"),
    expect: { isRetryableError: true, isResumableEngineError: true },
  },
  {
    label: "transport failed with no recognizable signature",
    rejectWith: () => new TypeError("Invalid URL"),
    expect: { isRetryableError: false, isResumableEngineError: false },
  },
  {
    label: "gateway timed out",
    env: { AGENT_NATIVE_BUILDER_GATEWAY_TIMEOUT_MS: "1" },
    fetchImpl: () => (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason ?? new Error("aborted"));
        });
      }),
    expect: {
      isRetryableError: false,
      isResumableEngineError: true,
      isRecoverableContinuationError: true,
      continuationReasonForResumableError: "gateway_timeout",
    },
  },
];

/**
 * The classifiers exercised on both lanes. `run` receives exactly what the layer
 * it lives in receives: an `EngineError` rebuilt from the stop event (the agent
 * loop's `throw`) or the SSE error event run-manager sends from it.
 */
const PARITY_CHECKED = {
  isRetryableError: ({ engineError }: ClassifierInput) =>
    isRetryableError(engineError),
  isContextTooLongError: ({ engineError }: ClassifierInput) =>
    isContextTooLongError(engineError),
  isResumableEngineError: ({ engineError }: ClassifierInput) =>
    isResumableEngineError(engineError),
  isTransientProviderRateLimitError: ({ engineError }: ClassifierInput) =>
    isTransientProviderRateLimitError(engineError),
  continuationReasonForResumableError: ({ engineError }: ClassifierInput) =>
    continuationReasonForResumableError(engineError),
  isRecoverableContinuationError: ({ errorEvent }: ClassifierInput) =>
    isRecoverableContinuationError(errorEvent),
};

/**
 * Gateway-failure classifiers that are not called here, each with the reason and
 * where the guarantee is proved instead. An entry is a decision a reviewer
 * should see — the completeness check below fails on a classifier that is in
 * neither map, so silence is not an option.
 */
const COVERED_ELSEWHERE: Record<string, string> = {
  maxRetriesForError:
    "Reads only `errorCode`, which the structural invariant below proves is lane-identical.",
  errorSearchText:
    "The text extractor the classifiers share. It reaches no verdict of its own.",
  getRunErrorCode:
    "Returns the engine's own code, and the invariant below proves every gateway stop carries one, so it never falls through to the message.",
  shouldCaptureRunError:
    "Needs run-manager's SQL mocks; proved in run-manager.spec.ts ('keeps a truncated gateway stream out of Sentry').",
  startRun:
    "Its `classifyTerminalErrorCode` is the persistence fallback for an error event with NO code, which the invariant below forbids for a gateway stop.",
};

interface ClassifierInput {
  engineError: EngineError;
  errorEvent: { type: "error"; error: string; errorCode?: string };
}

interface LaneOutcome {
  stop: any;
  persistedErrorCode: string;
  verdicts: Record<string, unknown>;
}

async function runLane(
  failure: GatewayFailure,
  lane: "identity" | "gateway-deploy",
): Promise<LaneOutcome> {
  credentialState.lane = lane;
  vi.stubEnv("BUILDER_GATEWAY_BASE_URL", "https://test.example/gateway/v1");
  if (lane === "gateway-deploy") {
    vi.stubEnv("BUILDER_GATEWAY_TOKEN", "btk-site-token");
  }
  for (const [key, value] of Object.entries(failure.env ?? {})) {
    vi.stubEnv(key, value);
  }
  vi.stubGlobal(
    "fetch",
    failure.fetchImpl
      ? vi.fn(failure.fetchImpl())
      : failure.rejectWith
        ? vi.fn().mockRejectedValue(failure.rejectWith())
        : vi.fn().mockResolvedValue(failure.response!()),
  );

  const events: any[] = [];
  for await (const event of createBuilderEngine().stream(BASE_OPTS)) {
    events.push(event);
  }
  const stop = events.find((e) => e.type === "stop" && e.reason === "error");
  expect(
    stop,
    `${failure.label} on ${lane} produced no error stop`,
  ).toBeDefined();

  const engineError = new EngineError(stop.error ?? "", {
    errorCode: stop.errorCode,
    statusCode: stop.statusCode,
    providerRetryable: stop.providerRetryable,
    contextOverflow: stop.contextOverflow,
  });
  // run-manager builds the error event from the same stop: the message it sends
  // is the engine's, and the code is the engine's whenever there is one.
  const errorEvent = {
    type: "error" as const,
    error: stop.error ?? "",
    ...(stop.errorCode ? { errorCode: stop.errorCode } : {}),
  };
  const input: ClassifierInput = { engineError, errorEvent };

  const verdicts: Record<string, unknown> = {};
  for (const [name, run] of Object.entries(PARITY_CHECKED)) {
    verdicts[name] = run(input);
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  return {
    stop,
    // `startRun`'s chain: the engine's code, else the code recovered from the
    // delivered message, else "unknown".
    persistedErrorCode:
      stop.errorCode ?? classifyTerminalErrorCode(stop.error) ?? "unknown",
    verdicts,
  };
}

describe("gateway failures classify identically on both lanes", () => {
  beforeEach(() => {
    credentialState.lane = "identity";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  for (const failure of FAILURES) {
    it(`${failure.label}`, async () => {
      const identity = await runLane(failure, "identity");
      const credits = await runLane(failure, "gateway-deploy");

      // The premise: the credits lane really did replace the message, so a
      // matching verdict below is evidence and not a no-op.
      expect(credits.stop.error).toBe(GATEWAY_UNAVAILABLE_VISITOR_MESSAGE);
      expect(identity.stop.error).not.toBe(GATEWAY_UNAVAILABLE_VISITOR_MESSAGE);

      // Everything a downstream layer may read has to survive that rewrite —
      // including the code run persistence settles on, which falls back to
      // classifying the message and so lands on `unknown` for a signal the engine
      // left in prose (`startRun`, run-manager.ts).
      expect(credits.persistedErrorCode).toBe(identity.persistedErrorCode);
      expect(credits.stop.errorCode).toBe(identity.stop.errorCode);
      expect(credits.stop.statusCode).toBe(identity.stop.statusCode);
      expect(credits.stop.providerRetryable).toBe(
        identity.stop.providerRetryable,
      );
      expect(credits.stop.contextOverflow).toBe(identity.stop.contextOverflow);

      expect(credits.verdicts).toStrictEqual(identity.verdicts);
      for (const [name, expected] of Object.entries(failure.expect ?? {})) {
        expect(identity.verdicts[name], `${name} on the identity lane`).toBe(
          expected,
        );
        expect(credits.verdicts[name], `${name} on the credits lane`).toBe(
          expected,
        );
      }
    });
  }

  // The table above only covers classifiers someone remembered to list. This
  // covers the next one: a function in either file that decides anything about a
  // gateway failure must be exercised above or carry a written reason why not.
  it("registers every gateway-failure classifier in these two modules", () => {
    const MARKERS = [
      "builder_gateway",
      "credits-limit",
      "rate_limit_exceeded",
      "too_many_concurrent_requests",
      "gateway_not_enabled",
      "daily gateway request cap",
      "isContextOverflowMessage",
      "isContextOverflowCode",
      "classifyTerminalErrorCode",
      "errorSearchText",
      "PROVIDER_NETWORK_ERROR_CODE",
      "PROVIDER_RATE_LIMITED_ERROR_CODE",
    ];
    const discovered = new Set<string>();
    for (const file of ["./production-agent.ts", "./run-manager.ts"]) {
      const lines = readFileSync(new URL(file, import.meta.url), "utf8").split(
        "\n",
      );
      for (let i = 0; i < lines.length; i++) {
        const declaration = /^(?:export )?(?:async )?function (\w+)[(<]/.exec(
          lines[i],
        );
        if (!declaration) continue;
        let end = i + 1;
        while (end < lines.length && lines[end] !== "}") end++;
        const body = lines
          .slice(i, end)
          .join("\n")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/[^\n]*/g, "");
        if (MARKERS.some((marker) => body.includes(marker))) {
          discovered.add(declaration[1]);
        }
      }
    }

    expect([...discovered].sort()).toStrictEqual(
      [
        ...Object.keys(PARITY_CHECKED),
        ...Object.keys(COVERED_ELSEWHERE),
      ].sort(),
    );
  });
});
