import { describe, expect, it } from "vitest";

import {
  analyticsRetryDelay,
  createAnalyticsQueryClient,
  isAbortError,
  shouldRetryAnalyticsQuery,
} from "./query-client";

describe("analytics query client retry parity", () => {
  it("never retries AbortError", () => {
    const domAbort = new DOMException("Aborted", "AbortError");
    const errAbort = Object.assign(new Error("Aborted"), {
      name: "AbortError",
    });
    expect(isAbortError(domAbort)).toBe(true);
    expect(isAbortError(errAbort)).toBe(true);
    expect(shouldRetryAnalyticsQuery(0, domAbort)).toBe(false);
    expect(shouldRetryAnalyticsQuery(0, errAbort)).toBe(false);
  });

  it("never retries 401, 403, 404, or non-transient 4xx responses", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(shouldRetryAnalyticsQuery(0, { status })).toBe(false);
    }
  });

  it("retries transient network and 408/429/5xx errors up to 3 times (4 total attempts)", () => {
    for (const err of [
      new TypeError("Failed to fetch"),
      { status: 408 },
      { status: 429 },
      { status: 500 },
      { status: 503 },
    ]) {
      expect(shouldRetryAnalyticsQuery(0, err)).toBe(true);
      expect(shouldRetryAnalyticsQuery(1, err)).toBe(true);
      expect(shouldRetryAnalyticsQuery(2, err)).toBe(true);
      expect(shouldRetryAnalyticsQuery(3, err)).toBe(false);
    }
  });

  it("uses 500 ms exponential backoff with jitter", () => {
    expect(analyticsRetryDelay(0, () => 0)).toBe(250);
    expect(analyticsRetryDelay(0, () => 0.5)).toBe(500);
    expect(analyticsRetryDelay(1, () => 0.5)).toBe(1000);
    expect(analyticsRetryDelay(2, () => 1)).toBe(3000);
  });

  it("creates a QueryClient configured with analytics retry defaults", () => {
    const client = createAnalyticsQueryClient();
    const queries = client.getDefaultOptions().queries;
    expect(queries?.retry).toBe(shouldRetryAnalyticsQuery);
    expect(typeof queries?.retryDelay).toBe("function");
    expect(queries?.refetchOnWindowFocus).toBe(false);
  });
});
