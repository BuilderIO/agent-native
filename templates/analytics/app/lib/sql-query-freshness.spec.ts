import { describe, expect, it } from "vitest";

import { describeSqlQueryFreshness } from "./sql-query-freshness";

const FETCHED_AT = "2026-10-14T12:00:00.000Z";

describe("describeSqlQueryFreshness", () => {
  it("says nothing without a result", () => {
    expect(
      describeSqlQueryFreshness(undefined, {
        source: "bigquery",
        restored: false,
      }),
    ).toBeUndefined();
  });

  it("shows the fetch time of a fresh BigQuery result with no cache suffix", () => {
    expect(
      describeSqlQueryFreshness(
        { fetchedAt: FETCHED_AT, providerCacheHit: false },
        { source: "bigquery", restored: false },
      ),
    ).toEqual({ fetchedAt: FETCHED_AT, cache: "live" });
  });

  it("names the cache that served a result", () => {
    const options = { source: "bigquery", restored: false } as const;
    expect(
      describeSqlQueryFreshness(
        { fetchedAt: FETCHED_AT, cached: true, providerCacheHit: false },
        options,
      )?.cache,
    ).toBe("app-cache");
    expect(
      describeSqlQueryFreshness(
        { fetchedAt: FETCHED_AT, providerCacheHit: true },
        options,
      )?.cache,
    ).toBe("provider-cache");
  });

  it("reports an unreported BigQuery cache state or fetch time as unknown", () => {
    expect(
      describeSqlQueryFreshness(
        { fetchedAt: FETCHED_AT },
        { source: "bigquery", restored: false },
      ),
    ).toEqual({ fetchedAt: FETCHED_AT, cache: "unknown" });
    expect(
      describeSqlQueryFreshness({}, { source: "bigquery", restored: false }),
    ).toEqual({ fetchedAt: undefined, cache: "unknown" });
  });

  it("shows nothing for another source that reports no metadata", () => {
    expect(
      describeSqlQueryFreshness({}, { source: "ga4", restored: false }),
    ).toBeUndefined();
    expect(
      describeSqlQueryFreshness({}, { source: "first-party", restored: false }),
    ).toBeUndefined();
  });

  it("shows another source's metadata when it has some, never as unknown", () => {
    expect(
      describeSqlQueryFreshness(
        { fetchedAt: FETCHED_AT },
        { source: "first-party", restored: false },
      ),
    ).toEqual({ fetchedAt: FETCHED_AT, cache: "live" });
  });

  it("marks a saved copy as restored for every source, keeping its fetch time", () => {
    expect(
      describeSqlQueryFreshness(
        { fetchedAt: FETCHED_AT, cached: false, providerCacheHit: false },
        { source: "bigquery", restored: true },
      ),
    ).toEqual({ fetchedAt: FETCHED_AT, cache: "restored" });
    expect(
      describeSqlQueryFreshness({}, { source: "ga4", restored: true }),
    ).toEqual({ fetchedAt: undefined, cache: "restored" });
  });
});
