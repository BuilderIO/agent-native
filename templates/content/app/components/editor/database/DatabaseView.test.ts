import { describe, expect, it } from "vitest";

import {
  builderSourceContinuationKey,
  builderSourceContinuationWatchdogDelay,
  builderSourceContinuationProgressPercent,
  builderSourceContinuationWatchdogDecision,
  builderSourceRowFetchStatus,
} from "./DatabaseView";

describe("Builder source row fetch status", () => {
  it("shows background refresh errors before stale partial progress", () => {
    expect(
      builderSourceRowFetchStatus({
        metadata: {
          primaryKey: "id",
          titleField: "data.title",
          sourceFetchState: "error",
          lastReadPartial: true,
        },
      }),
    ).toBe("error");
  });

  it("shows partial live reads as still fetching", () => {
    expect(
      builderSourceRowFetchStatus({
        metadata: {
          primaryKey: "id",
          titleField: "data.title",
          sourceFetchState: "idle",
          lastReadPartial: true,
        },
      }),
    ).toBe("fetching");
  });
});

describe("Builder source continuation state", () => {
  it("keys continuation attempts by source and offset", () => {
    expect(
      builderSourceContinuationKey({
        id: "src-builder",
        metadata: {
          primaryKey: "id",
          titleField: "data.title",
          lastReadNextOffset: 250,
        },
      }),
    ).toBe("src-builder:250");
  });

  it("uses determinate progress when fetched count and limit are known", () => {
    expect(
      builderSourceContinuationProgressPercent({
        metadata: {
          primaryKey: "id",
          titleField: "data.title",
          lastReadFetchedEntryCount: 50,
          lastReadLimit: 100,
          lastReadHasMore: true,
        },
      }),
    ).toBe(50);
  });

  it("caps in-progress determinate progress below complete", () => {
    expect(
      builderSourceContinuationProgressPercent({
        metadata: {
          primaryKey: "id",
          titleField: "data.title",
          lastReadFetchedEntryCount: 100,
          lastReadLimit: 100,
          lastReadHasMore: true,
        },
      }),
    ).toBe(95);
  });

  it("falls back to indeterminate progress when counts are missing", () => {
    expect(
      builderSourceContinuationProgressPercent({
        metadata: {
          primaryKey: "id",
          titleField: "data.title",
          lastReadFetchedEntryCount: 50,
        },
      }),
    ).toBeNull();
  });

  it("keeps watchdog continuation automatic with capped backoff", () => {
    expect(builderSourceContinuationWatchdogDecision(0)).toBe("refire");
    expect(builderSourceContinuationWatchdogDecision(1)).toBe("refire");
    expect(builderSourceContinuationWatchdogDecision(20)).toBe("refire");
    expect(builderSourceContinuationWatchdogDelay(0)).toBe(5_000);
    expect(builderSourceContinuationWatchdogDelay(1)).toBe(10_000);
    expect(builderSourceContinuationWatchdogDelay(2)).toBe(20_000);
    expect(builderSourceContinuationWatchdogDelay(3)).toBe(30_000);
    expect(builderSourceContinuationWatchdogDelay(20)).toBe(30_000);
  });
});
