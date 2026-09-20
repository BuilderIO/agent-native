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
      return new Response(calls === 6 ? "final rate limit details" : null, {
        status: 429,
        headers: { "retry-after": "0" },
      });
    };

    try {
      const response = await requestNetlifyApi("https://example.test");
      assert.equal(response.status, 429);
      assert.equal(calls, 6);
      assert.equal(await response.text(), "final rate limit details");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retries transient server errors for idempotent deletes", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      assert.equal(options?.method, "DELETE");
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 500 })
        : new Response(null, { status: 204 });
    };

    try {
      const response = await requestNetlifyApi("https://example.test", {
        method: "DELETE",
      });
      assert.equal(response.status, 204);
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retries transient transport errors for idempotent deletes", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      assert.equal(options?.method, "DELETE");
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response(null, { status: 204 });
    };

    try {
      const response = await requestNetlifyApi("https://example.test", {
        method: "DELETE",
      });
      assert.equal(response.status, 204);
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves the final delete error body after bounded retries", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response("Netlify delete details", { status: 502 });
    };

    try {
      const response = await requestNetlifyApi("https://example.test", {
        method: "DELETE",
      });
      assert.equal(response.status, 502);
      assert.equal(calls, 3);
      assert.equal(await response.text(), "Netlify delete details");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not retry server errors for non-idempotent requests", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(null, { status: 500 });
    };

    try {
      const response = await requestNetlifyApi("https://example.test", {
        method: "POST",
      });
      assert.equal(response.status, 500);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
