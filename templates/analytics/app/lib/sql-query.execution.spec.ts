// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/hooks", () => ({ callAction }));

import { SqlQueryRefusalError } from "@shared/sql-query-contract";

import { getTotalBytes, getUnknownScans, resetSession } from "./cost-tracker";
import { executeSqlQuery } from "./sql-query";

describe("SQL execution boundary with the real cost counter", () => {
  beforeEach(() => {
    callAction.mockReset();
    resetSession();
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["bigquery", "first-party"] as const)(
    "does not count a pre-query 401 for %s",
    async (source) => {
      const error = Object.assign(new Error("authentication required"), {
        status: 401,
      });
      callAction.mockRejectedValue(error);
      await expect(executeSqlQuery("SELECT 1", source)).rejects.toBe(error);
      expect(callAction).toHaveBeenCalledTimes(1);
      expect(getTotalBytes()).toBe(0);
      expect(getUnknownScans()).toBe(0);
    },
  );

  it.each([403, 404, 500, undefined])(
    "keeps potentially submitted failures unknown for status %s",
    async (status) => {
      const error = Object.assign(new Error("query failed"), { status });
      callAction.mockRejectedValue(error);
      await expect(executeSqlQuery("SELECT 1", "bigquery")).rejects.toBe(error);
      expect(callAction).toHaveBeenCalledTimes(1);
      expect(getTotalBytes()).toBe(0);
      expect(getUnknownScans()).toBe(1);
    },
  );

  it.each(["missing_api_key", "invalid_query", "unsupported_by_backend"])(
    "preserves the exact %s body refusal without inventing a status or scan",
    async (code) => {
      callAction.mockResolvedValue({ error: code, message: "Query refused" });
      const error = await executeSqlQuery("SELECT 1", "bigquery").catch(
        (error: unknown) => error,
      );
      expect(error).toBeInstanceOf(SqlQueryRefusalError);
      expect(error).toMatchObject({ code, message: "Query refused" });
      expect(error).not.toHaveProperty("status");
      expect(callAction).toHaveBeenCalledTimes(1);
      expect(getTotalBytes()).toBe(0);
      expect(getUnknownScans()).toBe(0);
    },
  );

  it("counts first-party BigQuery bytes once and preserves cached fetch times", async () => {
    const fetchedAt = "2026-10-14T12:00:00.000Z";
    const response = {
      rows: [{ n: 1 }],
      bytesProcessed: 4096,
      cached: false,
      providerCacheHit: false,
      fetchedAt,
    };
    callAction
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({ ...response, cached: true })
      .mockResolvedValueOnce({ ...response, providerCacheHit: true });
    for (let i = 0; i < 3; i += 1) {
      await expect(
        executeSqlQuery("SELECT 1", "first-party"),
      ).resolves.toMatchObject({ rows: [{ n: 1 }], fetchedAt });
      expect(getTotalBytes()).toBe(4096);
      expect(getUnknownScans()).toBe(0);
    }
    expect(callAction).toHaveBeenCalledTimes(3);
  });
});
