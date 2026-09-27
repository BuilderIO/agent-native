import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isPersistenceReloadFrameworkGetReset,
  isRetryableSessionReadErrorMessage,
  isTransientCommittedNavigationResponse,
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

  it("retries committed responses only for known cold-start failures", () => {
    assert.equal(
      isTransientCommittedNavigationResponse(503, "Vite is starting"),
      true,
    );
    assert.equal(
      isTransientCommittedNavigationResponse(504, "Outdated optimize dep"),
      true,
    );
    assert.equal(
      isTransientCommittedNavigationResponse(500, "Error: socket hang up"),
      true,
    );
    assert.equal(
      isTransientCommittedNavigationResponse(
        500,
        "Error: database migration failed",
      ),
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

describe("standalone chat persistence reload framework errors", () => {
  it("ignores reset responses only for in-flight framework GETs", () => {
    assert.equal(
      isPersistenceReloadFrameworkGetReset(
        500,
        "GET",
        "/_agent-native/poll",
        "Error: read ECONNRESET",
        true,
      ),
      true,
    );
    assert.equal(
      isPersistenceReloadFrameworkGetReset(
        500,
        "GET",
        "/_agent-native/application-state",
        "",
        true,
      ),
      true,
    );
    assert.equal(
      isPersistenceReloadFrameworkGetReset(
        500,
        "GET",
        "/_agent-native/agent-chat/threads",
        "Error: read ECONNRESET",
        true,
      ),
      true,
    );
    assert.equal(
      isPersistenceReloadFrameworkGetReset(
        500,
        "GET",
        "/_agent-native/application-state",
        "Error: read ECONNRESET",
        true,
      ),
      true,
    );
    assert.equal(
      isPersistenceReloadFrameworkGetReset(
        500,
        "GET",
        "/_agent-native/poll",
        "Error: read ECONNRESET",
        false,
      ),
      false,
    );
    assert.equal(
      isPersistenceReloadFrameworkGetReset(
        500,
        "GET",
        "/_agent-native/application-state",
        "",
        false,
      ),
      false,
    );
    assert.equal(
      isPersistenceReloadFrameworkGetReset(
        500,
        "GET",
        "/_agent-native/poll",
        "Error: database migration failed",
        true,
      ),
      false,
    );
    assert.equal(
      isPersistenceReloadFrameworkGetReset(
        502,
        "GET",
        "/_agent-native/poll",
        "Error: read ECONNRESET",
        true,
      ),
      false,
    );
    assert.equal(
      isPersistenceReloadFrameworkGetReset(
        500,
        "POST",
        "/_agent-native/poll",
        "Error: read ECONNRESET",
        true,
      ),
      false,
    );
    assert.equal(
      isPersistenceReloadFrameworkGetReset(
        500,
        "GET",
        "/api/unrelated",
        "Error: read ECONNRESET",
        true,
      ),
      false,
    );
  });
});
