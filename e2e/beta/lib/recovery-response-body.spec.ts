import assert from "node:assert/strict";
import test from "node:test";

import { discardRecoveryResponseBody } from "./recovery-response-body";

test("a response without a body is discarded", async () => {
  assert.deepEqual(await discardRecoveryResponseBody(null), {
    kind: "discarded",
  });
});

test("waits for successful cancellation", async () => {
  let cancelled = false;
  const result = await discardRecoveryResponseBody({
    async cancel() {
      cancelled = true;
    },
  });
  assert.equal(cancelled, true);
  assert.deepEqual(result, { kind: "discarded" });
});

test("cancellation failure is unreadable without exposing the private error", async () => {
  const result = await discardRecoveryResponseBody({
    async cancel() {
      throw new Error("PRIVATE_SENTINEL");
    },
  });
  assert.deepEqual(result, { kind: "unreadable" });
  assert.equal(JSON.stringify(result).includes("PRIVATE_SENTINEL"), false);
});
