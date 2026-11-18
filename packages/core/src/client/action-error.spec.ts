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
  expect(actionTransportError(abort)).toBe(abort);
});
