import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordQueryCost: vi.fn(),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appApiPath: (path: string) => path,
}));
vi.mock("./auth", () => ({ getIdToken: async () => null }));
vi.mock("./cost-tracker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cost-tracker")>();
  mocks.recordQueryCost.mockImplementation(actual.recordQueryCost);
  return { ...actual, recordQueryCost: mocks.recordQueryCost };
});

import { getTotalBytes, getUnknownScans, resetSession } from "./cost-tracker";
import { queryMetrics } from "./query-metrics";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("queryMetrics cost accounting", () => {
  beforeEach(() => {
    mocks.recordQueryCost.mockClear();
    resetSession();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands the cache flags and scanned bytes to the cost counter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          rows: [{ n: 1 }],
          bytesProcessed: 4096,
          cached: true,
          providerCacheHit: false,
        }),
      ),
    );

    await expect(queryMetrics("SELECT 1")).resolves.toMatchObject({
      rows: [{ n: 1 }],
    });

    expect(mocks.recordQueryCost).toHaveBeenCalledTimes(1);
    expect(mocks.recordQueryCost).toHaveBeenCalledWith({
      status: "success",
      cached: true,
      providerCacheHit: false,
      bytesProcessed: 4096,
    });
    expect(getTotalBytes()).toBe(0);
    expect(getUnknownScans()).toBe(0);
  });

  it.each([
    { cached: false, providerCacheHit: true, expected: 0 },
    { cached: false, providerCacheHit: false, expected: 4096 },
  ])(
    "counts only actual scan bytes for $cached/$providerCacheHit",
    async ({ cached, providerCacheHit, expected }) => {
      const fetchMock = vi.fn(async () =>
        jsonResponse({
          rows: [],
          bytesProcessed: 4096,
          cached,
          providerCacheHit,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      await queryMetrics("SELECT 1");
      expect(getTotalBytes()).toBe(expected);
      expect(getUnknownScans()).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("passes a response that reports no cache flags without inventing them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ rows: [], bytesProcessed: 10 })),
    );

    await queryMetrics("SELECT 1");

    expect(mocks.recordQueryCost.mock.calls[0]?.[0]).toEqual({
      status: "success",
      bytesProcessed: 10,
    });
    expect(getTotalBytes()).toBe(0);
    expect(getUnknownScans()).toBe(1);
  });

  it.each([
    [{ cached: false }, 1],
    [{ providerCacheHit: false }, 1],
    [{ cached: true }, 0],
    [{ providerCacheHit: true }, 0],
  ] as const)(
    "preserves incomplete Explorer cache provenance %j",
    async (metadata, unknownScans) => {
      const fetchMock = vi.fn(async () =>
        jsonResponse({ rows: [], bytesProcessed: 4096, ...metadata }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await queryMetrics("SELECT 1");

      expect(mocks.recordQueryCost).toHaveBeenCalledExactlyOnceWith({
        status: "success",
        bytesProcessed: 4096,
        ...metadata,
      });
      expect(getTotalBytes()).toBe(0);
      expect(getUnknownScans()).toBe(unknownScans);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("records an error response as an unknown scan and still returns the error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "job failed" }, 400)),
    );

    await expect(queryMetrics("SELECT 1")).resolves.toEqual({
      rows: [],
      error: "job failed",
    });

    expect(mocks.recordQueryCost).toHaveBeenCalledTimes(1);
    expect(mocks.recordQueryCost).toHaveBeenCalledWith({ status: "error" });
    expect(getTotalBytes()).toBe(0);
    expect(getUnknownScans()).toBe(1);
  });

  it("does not count a pre-query authentication failure as an unknown scan", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: "missing_api_key" }, 401),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(queryMetrics("SELECT 1")).resolves.toEqual({
      rows: [],
      error: "missing_api_key",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.recordQueryCost).not.toHaveBeenCalled();
    expect(getTotalBytes()).toBe(0);
    expect(getUnknownScans()).toBe(0);
  });

  it("records a lost request as an unknown scan and rethrows it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );

    await expect(queryMetrics("SELECT 1")).rejects.toThrow("network down");

    expect(mocks.recordQueryCost).toHaveBeenCalledWith({ status: "error" });
  });

  it("records a success response that cannot be read as an unknown scan", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );

    await expect(queryMetrics("SELECT 1")).rejects.toThrow();

    expect(mocks.recordQueryCost).toHaveBeenCalledWith({ status: "error" });
  });

  it("records a cancelled request as one unknown scan", async () => {
    const error = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    await expect(queryMetrics("SELECT 1")).rejects.toBe(error);
    expect(mocks.recordQueryCost).toHaveBeenCalledExactlyOnceWith({
      status: "cancelled",
    });
    expect(getTotalBytes()).toBe(0);
    expect(getUnknownScans()).toBe(1);
  });
});
