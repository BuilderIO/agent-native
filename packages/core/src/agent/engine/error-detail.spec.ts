import { describe, expect, it } from "vitest";

import {
  classifyTerminalErrorCode,
  describeErrorWithCauses,
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
      classifyTerminalErrorCode(
        "Builder gateway stream ended without a stop event",
      ),
    ).toBe("builder_gateway_network_error");
  });

  // Promoting a deterministic failure to a recoverable code buys a retry
  // spiral, not a fix — these must stay unclassified so the chat stops.
  it("leaves deterministic failures unclassified", () => {
    expect(classifyTerminalErrorCode("Missing Authentication header")).toBe(
      undefined,
    );
    expect(
      classifyTerminalErrorCode(
        "Function tools with reasoning_effort are not supported for gpt-5.6-luna in /v1/chat/completions.",
      ),
    ).toBe(undefined);
    expect(classifyTerminalErrorCode(undefined)).toBe(undefined);
    // A bare "429"/"529" inside a request id must not promote the failure.
    expect(
      classifyTerminalErrorCode("Bad request (request_id: req_a529b429c)"),
    ).toBe(undefined);
  });

  it("finds the transport failure on the cause chain", () => {
    const err = new Error("stream failed", {
      cause: new Error("Connection error."),
    });
    expect(isProviderConnectionError(err)).toBe(true);
    expect(isProviderConnectionError(new Error("bad request"))).toBe(false);
  });
});
