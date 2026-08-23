import assert from "node:assert/strict";
import test from "node:test";

import { shouldRetrySessionExchange } from "./session";

test("retries transient gateway failures but not final or client responses", () => {
  assert.equal(shouldRetrySessionExchange(502, 1), true);
  assert.equal(shouldRetrySessionExchange(504, 2), true);
  assert.equal(shouldRetrySessionExchange(502, 3), false);
  assert.equal(shouldRetrySessionExchange(500, 1), false);
  assert.equal(shouldRetrySessionExchange(401, 1), false);
});
