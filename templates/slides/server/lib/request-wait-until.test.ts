import { afterEach, describe, expect, it, vi } from "vitest";

import { requestWaitUntil } from "./request-wait-until";

const STORE_KEY = Symbol.for("@netlify/functions/request-context-store");

describe("requestWaitUntil", () => {
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
  });

  it("prefers the request's own waitUntil", () => {
    const waitUntil = vi.fn();
    requestWaitUntil({ req: { waitUntil } } as never)?.(Promise.resolve());
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("falls back to the Netlify function context when the request has none", () => {
    const waitUntil = vi.fn();
    (globalThis as Record<symbol, unknown>)[STORE_KEY] = {
      getStore: () => ({ context: { waitUntil } }),
    };
    requestWaitUntil({ req: {} } as never)?.(Promise.resolve());
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when neither is available", () => {
    expect(requestWaitUntil({ req: {} } as never)).toBeUndefined();
  });
});
