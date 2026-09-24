import { describe, it, expect, beforeEach, vi } from "vitest";

import type { Experiment, ExperimentVariant } from "./types.js";

// experiments.ts holds the deterministic A/B bucketing logic and the
// metric aggregation (mean / stddev / 95% CI). Those are the high-value
// targets: a non-deterministic bucketer would silently reassign users
// mid-experiment, and broken stats would mislead every readout. We mock
// the store (assignment lookups, experiment CRUD) and the raw DB client
// (used by computeExperimentResults) so we can shape inputs precisely and
// no network/DB is hit.

const store = vi.hoisted(() => ({
  insertExperiment: vi.fn(),
  updateExperiment: vi.fn(),
  listExperiments: vi.fn(),
  getExperiment: vi.fn(),
  upsertAssignment: vi.fn(),
  getAssignment: vi.fn(),
  insertExperimentResult: vi.fn(),
  ensureObservabilityTables: vi.fn(),
}));

const dbExecute = vi.hoisted(() => vi.fn());

vi.mock("./store.js", () => ({
  insertExperiment: (...a: unknown[]) => store.insertExperiment(...a),
  updateExperiment: (...a: unknown[]) => store.updateExperiment(...a),
  listExperiments: (...a: unknown[]) => store.listExperiments(...a),
  getExperiment: (...a: unknown[]) => store.getExperiment(...a),
  upsertAssignment: (...a: unknown[]) => store.upsertAssignment(...a),
  getAssignment: (...a: unknown[]) => store.getAssignment(...a),
  insertExperimentResult: (...a: unknown[]) =>
    store.insertExperimentResult(...a),
  ensureObservabilityTables: (...a: unknown[]) =>
    store.ensureObservabilityTables(...a),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: dbExecute }),
}));

const {
  createExperiment,
  startExperiment,
  pauseExperiment,
  completeExperiment,
  resolveVariant,
  resolveActiveExperimentConfig,
  computeExperimentResults,
} = await import("./experiments.js");

function makeExperiment(over: Partial<Experiment> = {}): Experiment {
  return {
    id: "exp-1",
    name: "test",
    status: "running",
    variants: [
      { id: "control", weight: 50, config: { color: "blue" } },
      { id: "treatment", weight: 50, config: { color: "green" } },
    ],
    metrics: ["avg_cost"],
    assignmentLevel: "user",
    startedAt: null,
    endedAt: null,
    createdAt: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(store)) fn.mockReset();
  store.insertExperiment.mockResolvedValue(undefined);
  store.updateExperiment.mockResolvedValue(undefined);
  store.upsertAssignment.mockResolvedValue(undefined);
  store.insertExperimentResult.mockResolvedValue(undefined);
  store.ensureObservabilityTables.mockResolvedValue(undefined);
  store.getAssignment.mockResolvedValue(null);
  dbExecute.mockResolvedValue({ rows: [] });
});

describe("experiment lifecycle", () => {
  it("createExperiment starts in draft with a user-level default", async () => {
    const exp = await createExperiment({
      name: "checkout-test",
      variants: [{ id: "a", weight: 1, config: {} }],
      metrics: ["avg_cost"],
    });

    expect(exp.status).toBe("draft");
    expect(exp.assignmentLevel).toBe("user");
    expect(exp.startedAt).toBeNull();
    expect(exp.endedAt).toBeNull();
    expect(store.insertExperiment).toHaveBeenCalledWith(exp);
  });

  it("start / pause / complete transition status (and complete stamps endedAt)", async () => {
    await startExperiment("exp-1");
    expect(store.updateExperiment).toHaveBeenCalledWith("exp-1", {
      status: "running",
    });

    await pauseExperiment("exp-1");
    expect(store.updateExperiment).toHaveBeenCalledWith("exp-1", {
      status: "paused",
    });

    await completeExperiment("exp-1");
    const lastCall = store.updateExperiment.mock.calls.at(-1)![1];
    expect(lastCall.status).toBe("completed");
    expect(typeof lastCall.endedAt).toBe("number");
  });
});

describe("resolveVariant bucketing", () => {
  it("is deterministic: same (experiment,user) always lands the same variant", async () => {
    store.getExperiment.mockResolvedValue(makeExperiment());

    const first = await resolveVariant("exp-1", "user-42");
    // Clear the fire-and-forget assignment so the second call re-buckets
    // from the hash, not from a stored assignment — proving the hash
    // itself is stable.
    store.getAssignment.mockResolvedValue(null);
    const second = await resolveVariant("exp-1", "user-42");

    expect(first.id).toBe(second.id);
  });

  it("respects a stored assignment over re-bucketing (sticky)", async () => {
    store.getExperiment.mockResolvedValue(makeExperiment());
    store.getAssignment.mockResolvedValue({
      experimentId: "exp-1",
      userId: "user-1",
      variantId: "treatment",
      assignedAt: 1,
    });

    const variant = await resolveVariant("exp-1", "user-1");
    expect(variant.id).toBe("treatment");
    // No new assignment write when one already exists.
    expect(store.upsertAssignment).not.toHaveBeenCalled();
  });

  it("distributes users across variants roughly in proportion to weights", async () => {
    store.getExperiment.mockResolvedValue(makeExperiment());

    const counts: Record<string, number> = { control: 0, treatment: 0 };
    for (let i = 0; i < 2000; i++) {
      const v = await resolveVariant("exp-1", `user-${i}`);
      counts[v.id]++;
    }
    // 50/50 split — allow generous slack but both must get a real share.
    expect(counts.control).toBeGreaterThan(700);
    expect(counts.treatment).toBeGreaterThan(700);
    expect(counts.control + counts.treatment).toBe(2000);
  });

  it("honors lopsided weights (90/10) directionally", async () => {
    store.getExperiment.mockResolvedValue(
      makeExperiment({
        variants: [
          { id: "big", weight: 90, config: {} },
          { id: "small", weight: 10, config: {} },
        ],
      }),
    );

    const counts: Record<string, number> = { big: 0, small: 0 };
    for (let i = 0; i < 2000; i++) {
      const v = await resolveVariant("exp-1", `u${i}`);
      counts[v.id]++;
    }
    expect(counts.big).toBeGreaterThan(counts.small * 3);
  });

  it("persists the chosen assignment on first bucketing", async () => {
    store.getExperiment.mockResolvedValue(makeExperiment());

    const v = await resolveVariant("exp-1", "user-7");
    // upsertAssignment is fire-and-forget; await a microtask flush.
    await Promise.resolve();
    expect(store.upsertAssignment).toHaveBeenCalledTimes(1);
    const written = store.upsertAssignment.mock.calls[0][0];
    expect(written.variantId).toBe(v.id);
    expect(written.experimentId).toBe("exp-1");
    expect(written.userId).toBe("user-7");
  });

  it("throws when the experiment is missing", async () => {
    store.getExperiment.mockResolvedValue(null);
    await expect(resolveVariant("nope", "u1")).rejects.toThrow(/not found/);
  });

  it("throws when there are no variants or zero total weight", async () => {
    store.getExperiment.mockResolvedValue(makeExperiment({ variants: [] }));
    await expect(resolveVariant("exp-1", "u1")).rejects.toThrow(/no variants/);

    store.getExperiment.mockResolvedValue(
      makeExperiment({
        variants: [{ id: "z", weight: 0, config: {} }],
      }),
    );
    await expect(resolveVariant("exp-1", "u1")).rejects.toThrow(
      /no valid variant weights/,
    );
  });

  it("throws if a stored assignment points at a now-deleted variant", async () => {
    store.getExperiment.mockResolvedValue(makeExperiment());
    store.getAssignment.mockResolvedValue({
      experimentId: "exp-1",
      userId: "u1",
      variantId: "ghost",
      assignedAt: 1,
    });
    await expect(resolveVariant("exp-1", "u1")).rejects.toThrow(
      /Variant ghost not found/,
    );
  });
});

describe("resolveActiveExperimentConfig", () => {
  it("returns null when no experiments are running", async () => {
    store.listExperiments.mockResolvedValue([
      makeExperiment({ status: "draft" }),
    ]);
    const out = await resolveActiveExperimentConfig("user-1");
    expect(out).toBeNull();
  });

  it("merges configs from all running experiments for the user", async () => {
    // getActiveExperiments has a 5s in-module TTL cache; the previous test
    // may have cached an empty active-list. invalidateCache is only reachable
    // through a lifecycle call, so clear it via pauseExperiment first.
    await pauseExperiment("exp-x");
    const expA = makeExperiment({
      id: "expA",
      variants: [{ id: "a", weight: 1, config: { theme: "dark" } }],
    });
    const expB = makeExperiment({
      id: "expB",
      variants: [{ id: "b", weight: 1, config: { layout: "grid" } }],
    });
    store.listExperiments.mockResolvedValue([expA, expB]);
    store.getExperiment.mockImplementation(async (id: string) =>
      id === "expA" ? expA : expB,
    );

    const out = await resolveActiveExperimentConfig("user-1");
    expect(out).not.toBeNull();
    expect(out!.configs).toEqual({ theme: "dark", layout: "grid" });
    expect(out!.assignments).toEqual([
      { experimentId: "expA", variantId: "a" },
      { experimentId: "expB", variantId: "b" },
    ]);
  });
});

describe("computeExperimentResults stats", () => {
  it("emits zeroed metrics for a variant with no assignments", async () => {
    store.getExperiment.mockResolvedValue(makeExperiment());
    // Both variants: assignment query returns no rows.
    dbExecute.mockResolvedValue({ rows: [] });

    const results = await computeExperimentResults("exp-1");

    // 6 empty metrics per variant, 2 variants.
    expect(results).toHaveLength(12);
    expect(results.every((r) => r.value === 0 && r.sampleSize === 0)).toBe(
      true,
    );
    const metrics = new Set(results.map((r) => r.metric));
    expect(metrics).toEqual(
      new Set([
        "avg_cost",
        "avg_latency",
        "avg_eval_score",
        "tool_success_rate",
        "satisfaction",
        "sample_size",
      ]),
    );
  });

  it("computes mean, sample size, and a 95% CI from real trace rows", async () => {
    store.getExperiment.mockResolvedValue(
      makeExperiment({
        variants: [{ id: "control", weight: 1, config: {} }],
      }),
    );

    // Queue the sequence of execute() calls for the single variant:
    //  1) assignment user_ids
    //  2) trace summaries
    //  3) eval scores
    //  4) satisfaction (frustration) scores
    dbExecute
      .mockResolvedValueOnce({ rows: [{ user_id: "u1" }, { user_id: "u2" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            total_cost_cents_x100: 100, // => $1.00
            total_duration_ms: 1000,
            successful_tools: 1,
            tool_calls: 2, // rate 0.5
            run_id: "r1",
          },
          {
            total_cost_cents_x100: 300, // => $3.00
            total_duration_ms: 3000,
            successful_tools: 2,
            tool_calls: 2, // rate 1.0
            run_id: "r2",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ score: 0.8 }, { score: 0.6 }] })
      .mockResolvedValueOnce({ rows: [{ frustration_score: 20 }] });

    const results = await computeExperimentResults("exp-1");
    const byMetric = Object.fromEntries(results.map((r) => [r.metric, r]));

    expect(byMetric.avg_cost.value).toBeCloseTo(2.0, 5); // mean of 1,3
    expect(byMetric.avg_latency.value).toBeCloseTo(2000, 5);
    expect(byMetric.tool_success_rate.value).toBeCloseTo(0.75, 5); // (.5+1)/2
    expect(byMetric.avg_eval_score.value).toBeCloseTo(0.7, 5); // (.8+.6)/2
    expect(byMetric.satisfaction.value).toBeCloseTo(0.8, 5); // 1 - 20/100
    expect(byMetric.sample_size.value).toBe(2);

    // With n=2 the CI must straddle the mean (margin = 1.96*std/sqrt(2)).
    expect(byMetric.avg_cost.confidenceLow).toBeLessThan(2.0);
    expect(byMetric.avg_cost.confidenceHigh).toBeGreaterThan(2.0);
    // sample_size metric has std 0 => CI collapses to the point value.
    expect(byMetric.sample_size.confidenceLow).toBe(2);
    expect(byMetric.sample_size.confidenceHigh).toBe(2);

    // Each metric was persisted.
    expect(store.insertExperimentResult).toHaveBeenCalledTimes(6);
  });

  it("scopes trace + satisfaction queries to the variant's assigned user_ids", async () => {
    store.getExperiment.mockResolvedValue(
      makeExperiment({
        startedAt: 5000,
        variants: [{ id: "control", weight: 1, config: {} }],
      }),
    );
    dbExecute
      .mockResolvedValueOnce({
        rows: [{ user_id: "alice" }, { user_id: "bob" }],
      })
      .mockResolvedValueOnce({ rows: [] }) // no traces -> eval query skipped
      .mockResolvedValueOnce({ rows: [] }); // satisfaction (3rd call)

    await computeExperimentResults("exp-1");

    // 2nd call = trace summaries; must filter user_id IN (?, ?) and the
    // startedAt cutoff, with the user ids + cutoff bound in order.
    const traceCall = dbExecute.mock.calls[1][0];
    expect(traceCall.sql).toMatch(/s\.user_id IN \(\?, \?\)/);
    expect(traceCall.sql).toMatch(/s\.created_at >= \?/);
    expect(traceCall.args).toEqual(["alice", "bob", 5000]);

    // Because no traces matched, runIds is empty and the eval query is
    // skipped — so the satisfaction read is the very next (3rd) call. It
    // must likewise scope to the variant's users via the feedback subquery
    // (f.user_id IN (?, ?)), never leaking another variant's frustration.
    expect(dbExecute.mock.calls).toHaveLength(3);
    const satCall = dbExecute.mock.calls[2][0];
    expect(satCall.sql).toMatch(/f\.user_id IN \(\?, \?\)/);
    expect(satCall.sql).toMatch(/computed_at >= \?/);
    expect(satCall.args).toEqual(["alice", "bob", 5000]);
  });

  it("throws when computing results for a missing experiment", async () => {
    store.getExperiment.mockResolvedValue(null);
    await expect(computeExperimentResults("nope")).rejects.toThrow(/not found/);
  });
});
