import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isRetryableSessionReadErrorMessage,
  isTransientStartupPollResponse,
} from "./qa-standalone-chat-dev-smoke-readiness";

describe("standalone chat startup poll readiness", () => {
  it("retries the known Vite startup responses", () => {
    assert.equal(isTransientStartupPollResponse(503, "starting"), true);
    assert.equal(
      isTransientStartupPollResponse(
        500,
        '<script>const error = {"message":"socket hang up"}</script>',
      ),
      true,
    );
    assert.equal(
      isTransientStartupPollResponse(500, "Error: read ECONNRESET"),
      true,
    );
  });

  it("does not hide unrelated server errors", () => {
    assert.equal(
      isTransientStartupPollResponse(500, "Error: database migration failed"),
      false,
    );
    assert.equal(
      isTransientStartupPollResponse(502, "Error: socket hang up"),
      false,
    );
  });

  it("retries only startup-related session read failures", () => {
    assert.equal(
      isRetryableSessionReadErrorMessage(
        "apiRequestContext.get: Timeout 5000ms exceeded.",
      ),
      true,
    );
    assert.equal(
      isRetryableSessionReadErrorMessage(
        "expected authenticated session, got null",
      ),
      true,
    );
    assert.equal(
      isRetryableSessionReadErrorMessage("session JSON is malformed"),
      false,
    );
  });
});
