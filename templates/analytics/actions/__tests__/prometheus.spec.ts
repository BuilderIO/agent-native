import { describe, expect, it, vi, beforeEach } from "vitest";

// @agent-native/core transitively imports @opentelemetry/api, which has a
// broken ESM export path that node's resolver can't load. Stub defineAction
// so action tests don't depend on the framework runtime.
//
// NOTE: This file lives in __tests__/ (not actions/ root) intentionally.
// The action scanner (autoDiscoverActions, non-recursive readdirSync) only
// picks up top-level files in actions/. A top-level spec containing the
// string "defineAction" gets added to .generated/actions-registry.ts, which
// causes vi.mock() to run outside Vitest's transform pipeline and throws
// "Vitest mocker was not initialized in this environment. vi.queueMock() is forbidden."
vi.mock("@agent-native/core", () => ({
  defineAction: <T extends { run: (args: any) => unknown }>(def: T) => def,
}));

const queryInstant = vi.fn();
const queryRange = vi.fn();
const listLabels = vi.fn();
const listLabelValues = vi.fn();
const listSeries = vi.fn();
const listMetricMetadata = vi.fn();
const listAlerts = vi.fn();

vi.mock("../../server/lib/prometheus", () => ({
  queryInstant: (...a: unknown[]) => queryInstant(...a),
  queryRange: (...a: unknown[]) => queryRange(...a),
  listLabels: (...a: unknown[]) => listLabels(...a),
  listLabelValues: (...a: unknown[]) => listLabelValues(...a),
  listSeries: (...a: unknown[]) => listSeries(...a),
  listMetricMetadata: (...a: unknown[]) => listMetricMetadata(...a),
  listAlerts: (...a: unknown[]) => listAlerts(...a),
}));

vi.mock("../_provider-action-utils", () => ({
  requireActionCredentials: vi.fn(async () => ({ ok: true, ctx: {} })),
  providerError: (e: unknown) => ({
    error: e instanceof Error ? e.message : String(e),
  }),
}));

const { default: prometheus } = await import("../prometheus");

describe("prometheus action", () => {
  beforeEach(() => {
    queryInstant.mockReset();
    queryRange.mockReset();
    listLabels.mockReset();
    listLabelValues.mockReset();
    listSeries.mockReset();
    listMetricMetadata.mockReset();
    listAlerts.mockReset();
  });

  it("defaults to mode=query with an instant query", async () => {
    queryInstant.mockResolvedValue({ resultType: "vector", result: [] });
    await prometheus.run({ mode: "query", query: "up" });
    expect(queryInstant).toHaveBeenCalledWith("up", undefined);
  });

  it("query_range forwards start/end/step", async () => {
    queryRange.mockResolvedValue({ resultType: "matrix", result: [] });
    await prometheus.run({
      mode: "query_range",
      query: "rate(http[5m])",
      start: "2026-05-01T00:00:00Z",
      end: "2026-05-01T01:00:00Z",
      step: "30s",
    });
    expect(queryRange).toHaveBeenCalledWith(
      "rate(http[5m])",
      Math.floor(Date.parse("2026-05-01T00:00:00Z") / 1000),
      Math.floor(Date.parse("2026-05-01T01:00:00Z") / 1000),
      30,
    );
  });

  it("labels mode returns the label list", async () => {
    listLabels.mockResolvedValue(["__name__", "job"]);
    const r = (await prometheus.run({ mode: "labels" })) as {
      labels: string[];
      total: number;
    };
    expect(r.labels).toEqual(["__name__", "job"]);
    expect(r.total).toBe(2);
  });

  it("rejects query mode without a query string", async () => {
    const r = (await prometheus.run({ mode: "query" })) as { error: string };
    expect(r.error).toMatch(/query/);
  });

  it("rejects label_values mode without a label", async () => {
    const r = (await prometheus.run({ mode: "label_values" })) as {
      error: string;
    };
    expect(r.error).toMatch(/label/);
  });

  it("series mode requires match[]", async () => {
    const r = (await prometheus.run({ mode: "series" })) as { error: string };
    expect(r.error).toMatch(/match/);
  });

  it("wraps thrown errors via providerError", async () => {
    queryInstant.mockRejectedValue(new Error("boom"));
    const r = (await prometheus.run({ mode: "query", query: "up" })) as {
      error: string;
    };
    expect(r.error).toBe("boom");
  });
});
