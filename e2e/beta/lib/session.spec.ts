import assert from "node:assert/strict";
import test from "node:test";

import { sessionTokenFor, shouldRetrySessionExchange } from "./session";

test("retries transient gateway failures but not final or client responses", () => {
  assert.equal(shouldRetrySessionExchange(502, 1), true);
  assert.equal(shouldRetrySessionExchange(504, 2), true);
  assert.equal(shouldRetrySessionExchange(502, 3), false);
  assert.equal(shouldRetrySessionExchange(500, 1), false);
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
