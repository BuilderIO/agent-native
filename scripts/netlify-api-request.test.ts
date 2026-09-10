import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { requestNetlifyApi } from "./netlify-api-request.ts";

describe("requestNetlifyApi", () => {
  it("retries a rate-limited request before returning success", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, {
            status: 429,
            headers: { "retry-after": "0" },
          })
        : new Response("ok", { status: 200 });
    };

    try {
      const response = await requestNetlifyApi("https://example.test");
      assert.equal(response.status, 200);
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns the final rate-limit response after bounded retries", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(null, {
        status: 429,
        headers: { "retry-after": "0" },
      });
    };

    try {
      const response = await requestNetlifyApi("https://example.test");
      assert.equal(response.status, 429);
      assert.equal(calls, 6);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
