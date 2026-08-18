import { describe, expect, it } from "vitest";

import {
  BUILDER_GATEWAY_INTERNAL_ERROR_CODE,
  classifyProviderError,
  classifyTerminalErrorCode,
  describeErrorWithCauses,
  builderGatewayInternalErrorUserMessage,
  isBuilderGatewayInternalErrorMessage,
  isProviderConnectionError,
  isProviderConnectionErrorMessage,
} from "./error-detail.js";

describe("describeErrorWithCauses", () => {
  it("returns the bare message when there is no cause", () => {
    expect(describeErrorWithCauses(new Error("Connection error."))).toBe(
      "Connection error.",
    );
  });

  it("appends the cause chain with each link's code", () => {
    const socket = Object.assign(new Error("other side closed"), {
      code: "UND_ERR_SOCKET",
    });
    const fetchFailed = new Error("fetch failed", { cause: socket });
    const apiError = new Error("Connection error.", { cause: fetchFailed });

    expect(describeErrorWithCauses(apiError)).toBe(
      "Connection error. (cause: fetch failed <- UND_ERR_SOCKET other side closed)",
    );
  });

  it("bounds the chain and survives a cycle", () => {
    const deepest = new Error("l5");
    let err: Error = deepest;
    for (const label of ["l4", "l3", "l2", "l1"]) {
      err = new Error(label, { cause: err });
    }
    (deepest as Error & { cause?: unknown }).cause = err;

    const described = describeErrorWithCauses(err);
    expect(described).toBe("l1 (cause: l2 <- l3 <- l4 <- l5)");
  });

  it("handles non-Error values", () => {
    expect(describeErrorWithCauses("boom")).toBe("boom");
  });
});

describe("isProviderConnectionErrorMessage", () => {
  // The exact string production throws ~150 times a week. A classifier
  // anchored with `startsWith`/`===` scores this as unclassified, the run
  // persists `error_code = 'unknown'`, and the client — which only
  // auto-recovers known transport codes — ends the user's chat on a blip.
  it("matches the AI SDK RetryError wrapper around a TLS reset", () => {
    const wrapped =
      "Failed after 2 attempts. Last error: Cannot connect to API: " +
      "0029217D3D7F0000:error:0A000438:SSL routines:ssl3_read_bytes:" +
      "tlsv1 alert internal error:ssl/record/rec_layer_s3.c:918:SSL alert number 80";
    expect(isProviderConnectionErrorMessage(wrapped)).toBe(true);
  });

  it("matches the bare provider SDK phrasings", () => {
    expect(isProviderConnectionErrorMessage("Connection error.")).toBe(true);
    expect(
      isProviderConnectionErrorMessage("Cannot connect to API: ECONNRESET"),
    ).toBe(true);
  });

  it("does not match unrelated failures", () => {
    expect(isProviderConnectionErrorMessage("context length exceeded")).toBe(
      false,
    );
    expect(isProviderConnectionErrorMessage("429 status code")).toBe(false);
  });

  it("classifies the terminal codes production actually persisted as unknown", () => {
    expect(
      classifyTerminalErrorCode(
        "Failed after 2 attempts. Last error: Cannot connect to API: tlsv1 alert internal error",
      ),
    ).toBe("provider_network_error");
    expect(
      classifyTerminalErrorCode(
        '{"type":"error","error":{"details":null,"type":"overloaded_error","message":"Overloaded"},"request_id":"req_1"}',
      ),
    ).toBe("overloaded_error");
    expect(
      classifyTerminalErrorCode(
        "Failed after 2 attempts. Last error: Too Many Requests",
      ),
    ).toBe("http_429");
    expect(classifyTerminalErrorCode("Request timed out.")).toBe("timeout");
    expect(
      classifyTerminalErrorCode("ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR"),
    ).toBe("provider_network_error");
    expect(
      classifyTerminalErrorCode(
        "Builder gateway stream ended without a stop event",
      ),
    ).toBe("builder_gateway_network_error");
  });

  // These two were left unclassified so a deterministic failure could not be
  // promoted to a recoverable code and spiral. But unclassified means
  // `unknown`, which the client also never retries AND renders as raw provider
  // text — 41 dead turns/week across the prod app DBs (2026-07-24..31), each at
  // exactly 1.00 runs/turn. Naming a failure and marking it recoverable are
  // separate decisions: these get names, and
  // `sse-event-processor.spec.ts` ("names a deterministic failure without
  // making it recoverable") holds the line that names alone never auto-continue.
  it("names deterministic failures instead of leaving them unknown", () => {
    expect(classifyTerminalErrorCode("Missing Authentication header")).toBe(
      "authentication_error",
    );
    expect(
      classifyTerminalErrorCode(
        "Function tools with reasoning_effort are not supported for gpt-5.6-luna in /v1/chat/completions.",
      ),
    ).toBe("provider_config_error");
    expect(classifyTerminalErrorCode(undefined)).toBe(undefined);
    // A bare "429"/"529" inside a request id must not promote the failure.
    expect(
      classifyTerminalErrorCode("Bad request (request_id: req_a529b429c)"),
    ).toBe(undefined);
  });

  // The Builder gateway answers 200, streams nothing, then emits an error frame
  // whose whole message is its own unhandled-500 envelope. No status, no code,
  // and no keyword any other predicate here matches, so it persisted as
  // `unknown`: 14 Analytics turns in one 100-minute window on 2026-08-17, every
  // one at exactly 1.00 runs/turn, i.e. dead on the first attempt with Builder's
  // internal correlation id shown to the user.
  it("names the Builder gateway internal-error envelope", () => {
    expect(
      classifyTerminalErrorCode(
        "Sorry, we ran into an issue processing your request. ERROR ID: bebaeb5da13441539790834b63ff955a",
      ),
    ).toBe(BUILDER_GATEWAY_INTERNAL_ERROR_CODE);
    expect(
      classifyTerminalErrorCode(
        "Sorry, this was caused by an internal error. ERROR ID: ee0d523bbb22473387d71fd97da220ea",
      ),
    ).toBe(BUILDER_GATEWAY_INTERNAL_ERROR_CODE);
  });

  it("keeps a more specific upstream classification over the envelope", () => {
    expect(
      classifyTerminalErrorCode(
        "Overloaded. ERROR ID: bebaeb5da13441539790834b63ff955a",
      ),
    ).toBe("overloaded_error");
  });

  // "Sorry, we ran into an issue processing your request" is indistinguishable
  // from this app crashing, so it gets reported as lost data. Name the layer,
  // and keep the id the gateway's own logs are searched by.
  it("names the failing layer in the envelope shown to the user", () => {
    const rewritten = builderGatewayInternalErrorUserMessage(
      "Sorry, we ran into an issue processing your request. ERROR ID: bebaeb5da13441539790834b63ff955a",
    );
    expect(rewritten).toContain("AI provider");
    expect(rewritten).toContain("ERROR ID: bebaeb5da13441539790834b63ff955a");
    expect(rewritten).not.toContain("Sorry, we ran into an issue");
    // Run persistence classifies the DELIVERED message, so the rewrite must
    // still read as the envelope or the code degrades to `unknown`.
    expect(classifyTerminalErrorCode(rewritten!)).toBe(
      BUILDER_GATEWAY_INTERNAL_ERROR_CODE,
    );
  });

  it("leaves a message that is not the envelope alone", () => {
    expect(
      builderGatewayInternalErrorUserMessage("Bad request (request id: req_9)"),
    ).toBeNull();
    expect(builderGatewayInternalErrorUserMessage("error id: abc")).toBeNull();
  });

  it("does not read an ordinary id as the envelope", () => {
    expect(
      isBuilderGatewayInternalErrorMessage("Bad request (request id: req_9)"),
    ).toBe(false);
    expect(isBuilderGatewayInternalErrorMessage("error id: abc")).toBe(false);
    expect(classifyTerminalErrorCode("Bad request, no id at all")).toBe(
      undefined,
    );
  });

  // `streamText` reports most provider HTTP failures as a stream part, not a
  // throw. That path discarded statusCode/isRetryable, so every one landed as
  // `unknown` and was retried only if its prose matched a keyword.
  it("classifies a provider error identically however it arrived", () => {
    const apiError = Object.assign(new Error("Rate limit reached"), {
      statusCode: 429,
      isRetryable: true,
    });
    expect(classifyProviderError(apiError)).toEqual({
      errorCode: "http_429",
      statusCode: 429,
      providerRetryable: true,
    });

    // Same error wrapped by the SDK's exhausted-retry RetryError.
    const retryError = Object.assign(
      new Error("Failed after 2 attempts. Last error: Rate limit reached"),
      { lastError: apiError },
    );
    expect(classifyProviderError(retryError)).toEqual({
      errorCode: "http_429",
      statusCode: 429,
      providerRetryable: true,
    });
  });

  it("falls back to the message when the provider error carries no status", () => {
    expect(
      classifyProviderError(
        new Error(
          "Failed after 2 attempts. Last error: Cannot connect to API: reset",
        ),
      ),
    ).toEqual({ errorCode: "provider_network_error", providerRetryable: true });

    expect(
      classifyProviderError(new Error("upstream reported overloaded_error")),
    ).toEqual({ errorCode: "overloaded_error" });
  });

  it("leaves a deterministic provider 400 retryable-free", () => {
    const badRequest = Object.assign(
      new Error(
        "Function tools with reasoning_effort are not supported for gpt-5.6-luna in /v1/chat/completions.",
      ),
      { statusCode: 400, isRetryable: false },
    );
    expect(classifyProviderError(badRequest)).toEqual({
      errorCode: "http_400",
      statusCode: 400,
      providerRetryable: false,
    });
  });

  it("finds the transport failure on the cause chain", () => {
    const err = new Error("stream failed", {
      cause: new Error("Connection error."),
    });
    expect(isProviderConnectionError(err)).toBe(true);
    expect(isProviderConnectionError(new Error("bad request"))).toBe(false);
  });
});
