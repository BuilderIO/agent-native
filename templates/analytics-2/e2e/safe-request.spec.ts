import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { safeRequest } from "./safe-request.js";

describe("safe request diagnostics", () => {
  it("removes secret-bearing transport errors while retaining the operation", async () => {
    for (const name of ["TimeoutError", "Error"]) {
      const failure = new Error("cookie: obviously-fake-secret-token");
      failure.name = name;
      let caught: unknown;
      try {
        await safeRequest(
          "GET /_agent-native/actions/get-project",
          async () => {
            throw failure;
          },
        );
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof Error);
      assert.equal(
        caught.message,
        `GET /_agent-native/actions/get-project: ${name === "TimeoutError" ? "timeout" : "request failed"}`,
      );
      assert.equal("cause" in caught, false);
      assert.doesNotMatch(caught.stack ?? "", /obviously-fake-secret-token/);
    }
  });

  it("returns the original successful response", async () => {
    const response = { status: () => 200 };
    assert.equal(
      await safeRequest("POST /action", async () => response),
      response,
    );
  });
});
