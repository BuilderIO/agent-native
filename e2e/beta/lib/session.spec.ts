import assert from "node:assert/strict";
import test from "node:test";

import {
  hasSessionCredentials,
  sessionFailureReason,
  sessionTokenFor,
  shouldRetrySessionExchange,
} from "./session";

test("retries transient server failures but not final or client responses", () => {
  assert.equal(shouldRetrySessionExchange(502, 1), true);
  assert.equal(shouldRetrySessionExchange(504, 2), true);
  assert.equal(shouldRetrySessionExchange(500, 1), true);
  assert.equal(shouldRetrySessionExchange(502, 3), false);
  assert.equal(shouldRetrySessionExchange(401, 1), false);
});

test("prefers a per-app token over the fleet token map", () => {
  const previousMap = process.env.BETA_E2E_SESSION_TOKENS;
  const previousAppToken = process.env.BETA_E2E_SESSION_TOKEN_MACROS;
  process.env.BETA_E2E_SESSION_TOKENS = JSON.stringify({ macros: "fleet" });
  process.env.BETA_E2E_SESSION_TOKEN_MACROS = "app-specific";
  try {
    assert.equal(sessionTokenFor("macros"), "app-specific");
  } finally {
    if (previousMap === undefined) delete process.env.BETA_E2E_SESSION_TOKENS;
    else process.env.BETA_E2E_SESSION_TOKENS = previousMap;
    if (previousAppToken === undefined)
      delete process.env.BETA_E2E_SESSION_TOKEN_MACROS;
    else process.env.BETA_E2E_SESSION_TOKEN_MACROS = previousAppToken;
  }
});

test("recognizes a per-app token as an authenticated credential", () => {
  const previousMap = process.env.BETA_E2E_SESSION_TOKENS;
  const previousAppToken = process.env.BETA_E2E_SESSION_TOKEN_MACROS;
  const previousStorageState = process.env.BETA_E2E_STORAGE_STATE;
  const previousStorageStateFile = process.env.BETA_E2E_STORAGE_STATE_FILE;
  delete process.env.BETA_E2E_SESSION_TOKENS;
  delete process.env.BETA_E2E_STORAGE_STATE;
  delete process.env.BETA_E2E_STORAGE_STATE_FILE;
  process.env.BETA_E2E_SESSION_TOKEN_MACROS = "app-specific";
  try {
    assert.equal(hasSessionCredentials(), true);
  } finally {
    if (previousMap === undefined) delete process.env.BETA_E2E_SESSION_TOKENS;
    else process.env.BETA_E2E_SESSION_TOKENS = previousMap;
    if (previousAppToken === undefined)
      delete process.env.BETA_E2E_SESSION_TOKEN_MACROS;
    else process.env.BETA_E2E_SESSION_TOKEN_MACROS = previousAppToken;
    if (previousStorageState === undefined)
      delete process.env.BETA_E2E_STORAGE_STATE;
    else process.env.BETA_E2E_STORAGE_STATE = previousStorageState;
    if (previousStorageStateFile === undefined)
      delete process.env.BETA_E2E_STORAGE_STATE_FILE;
    else process.env.BETA_E2E_STORAGE_STATE_FILE = previousStorageStateFile;
  }
});

test("classifies session failures without guessing that a credential expired", () => {
  assert.match(
    sessionFailureReason({
      status: 503,
      body: '{"error":"Session lookup timed out"}',
      tokenProvided: true,
    }),
    /endpoint was unavailable/,
  );
  assert.match(
    sessionFailureReason({
      status: 200,
      body: '{"error":"Not authenticated"}',
      tokenProvided: true,
    }),
    /did not honor/,
  );
  assert.match(
    sessionFailureReason({
      status: 200,
      body: "not json",
      tokenProvided: false,
    }),
    /unreadable/,
  );
  assert.doesNotMatch(
    sessionFailureReason({
      status: 200,
      body: '{"error":"Not authenticated"}',
      tokenProvided: true,
    }),
    /expire|30 days/i,
  );
});
