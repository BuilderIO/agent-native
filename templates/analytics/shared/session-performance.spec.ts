import { describe, expect, it } from "vitest";

import {
  histogramBucket,
  histogramEdges,
  histogramPercentile,
  PERFORMANCE_METRICS,
  type PerformanceMetric,
  WEB_VITAL_THRESHOLDS,
} from "./session-performance";
import { SLOW_REQUEST_THRESHOLD_MS } from "./slow-request";

/** The exact percentile the histogram estimates: the sample at its rank. */
function exactPercentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function estimate(metric: PerformanceMetric, values: number[], p: number) {
  const weights = histogramEdges(metric).map(() => 0);
  for (const value of values) weights[histogramBucket(metric, value)] += 1;
  return histogramPercentile(metric, weights, p)!.value;
}

describe("performance histograms", () => {
  it("step at most 28% past the first bucket, with every threshold an edge", () => {
    for (const metric of PERFORMANCE_METRICS) {
      const edges = histogramEdges(metric);
      for (let index = 2; index < edges.length; index += 1) {
        expect(edges[index] / edges[index - 1]).toBeLessThanOrEqual(1.28);
      }
    }
    for (const [metric, { good, poor }] of Object.entries(
      WEB_VITAL_THRESHOLDS,
    )) {
      const edges = histogramEdges(metric as PerformanceMetric);
      expect(edges).toContain(good);
      expect(edges).toContain(poor);
    }
    expect(histogramEdges("request")).toContain(SLOW_REQUEST_THRESHOLD_MS);
  });

  it("estimates percentiles within 28%, or the first bucket's width", () => {
    // Small layout shifts and fast responses, where wide buckets used to
    // report 0.02 for an exact 0.01.
    const cls = [0, 0.0001, 0.0001, 0.0002, 0.004, 0.01, 0.01, 0.012, 0.3, 1.1];
    const ms = [0.4, 3, 7, 9, 14, 15, 90, 420, 1_300, 2_900];
    for (const [metric, values, floor] of [
      ["cls", cls, 0.001],
      ["request", ms, 1],
    ] as const) {
      for (const p of [0.1, 0.25, 0.5, 0.75, 0.9, 0.95]) {
        const exact = exactPercentile([...values], p);
        const error = Math.abs(estimate(metric, [...values], p) - exact);
        expect(error).toBeLessThanOrEqual(
          exact < floor ? floor : exact * 0.28 + 1e-12,
        );
      }
    }
  });
});
