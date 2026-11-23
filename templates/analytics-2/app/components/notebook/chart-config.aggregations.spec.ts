import { describe, expect, it } from "vitest";

import { chartAggregationSchema } from "@/lib/model/contracts";

import { chartAggregationsForType } from "./chart-config";

describe("chartAggregationsForType", () => {
  it("offers every aggregation for numeric columns", () => {
    expect(
      chartAggregationsForType("number", chartAggregationSchema.options),
    ).toEqual(chartAggregationSchema.options);
  });

  it("withholds statistical aggregations from datetime and text columns", () => {
    for (const type of ["datetime", "date", "string"]) {
      const offered = chartAggregationsForType(
        type,
        chartAggregationSchema.options,
      );
      expect(offered).not.toContain("stddev");
      expect(offered).not.toContain("variance");
      expect(offered).not.toContain("sum");
      expect(offered).toContain("count");
    }
  });

  it("keeps every aggregation when the column type is not known yet", () => {
    expect(
      chartAggregationsForType(undefined, chartAggregationSchema.options),
    ).toEqual(chartAggregationSchema.options);
  });
});
