import { expect, it } from "vitest";

import { ActionError, actionTransportError } from "./action-error.js";

it.each([
  [{}, "request_failed"],
  [{ status: 500 }, "request_failed"],
  [{ status: 408, timedOut: true }, "timeout"],
  [{ code: "action_method_mismatch", status: 405 }, "action_method_mismatch"],
  [
    { code: "transport", errorCode: "validation_error", status: 422 },
    "validation_error",
  ],
])(
  "preserves the machine-readable error classification for %j",
  (fields, code) => {
    const cause = Object.assign(
      new Error("Action private-operation failed: diagnostic"),
      fields,
    );
    const error = new ActionError(cause);
    expect(error.code).toBe(code);
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain("private-operation");
    expect(error.userMessage).toBe(error.message);
  },
);

it("marks transport failures explicitly while preserving cancellation", () => {
  for (const cause of [new TypeError("Failed to fetch"), "Connection lost"]) {
    const error = new ActionError(actionTransportError(cause));
    expect(error.code).toBe("network_error");
  }
  const abort = new DOMException("Aborted", "AbortError");
  expect(actionTransportError(abort)).toMatchObject({
    name: "AbortError",
    code: "network_error",
    cause: abort,
  });
});

it.each([200, 403])(
  "preserves response metadata and HTTP refusal priority for status %i",
  (status) => {
    const response = new Response("partial", {
      status,
      headers:
        status === 200 ? { "x-agent-native-request-id": "stream-1" } : {},
    });
    const error = new ActionError(
      actionTransportError(new TypeError("Interrupted stream"), response),
    );
    expect(error).toMatchObject({
      status,
      code: status === 200 ? "network_error" : "request_failed",
    });
    expect(error.requestId).toBe(status === 200 ? "stream-1" : undefined);
  },
);
