import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { shouldInvalidateAnalyticsQueryForAction } from "./root";

describe("Analytics action invalidation", () => {
  it.each([
    ["sql-chart", "panel-1"],
    ["sql-dashboards-sidebar", 0],
    ["analyses-sidebar", 0],
    ["extensions", { includeGloballyHidden: false }],
    ["action", "provider-corpus-jobs"],
  ])(
    "keeps persistent chrome query %s on its targeted refresh path",
    (...key) => {
      expect(shouldInvalidateAnalyticsQueryForAction({ queryKey: key })).toBe(
        false,
      );
    },
  );

  it("continues refreshing ordinary active action queries", () => {
    expect(
      shouldInvalidateAnalyticsQueryForAction({
        queryKey: ["action", "get-monitor", { id: "monitor-1" }],
      }),
    ).toBe(true);
  });

  it("forwards corpus job changes through the existing DB sync bridge", () => {
    const source = readFileSync(new URL("./root.tsx", import.meta.url), "utf8");
    expect(source).toContain("onEvent: notifyProviderCorpusJobSyncEvent");
  });
});
