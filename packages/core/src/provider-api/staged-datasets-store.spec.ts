import { describe, expect, it } from "vitest";

import {
  MAX_BYTES_PER_APP,
  MAX_ROWS_PER_APP,
  legacyStagedDatasetId,
  selectStagedDatasetsToEvict,
  stagedDatasetId,
} from "./staged-datasets-store.js";

// Pure helpers only. Anything that reads or writes the tables is covered
// against real Postgres in staged-datasets-store.pglite.spec.ts.

const MB = 1024 * 1024;
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function candidate(
  id: string,
  byte_size: number,
  updated_at: number,
  row_count = 0,
  owner_email = "ada@example.com",
) {
  return { id, owner_email, byte_size, row_count, updated_at };
}

describe("selectStagedDatasetsToEvict", () => {
  it("evicts nothing when the projected totals already fit", () => {
    expect(
      selectStagedDatasetsToEvict({
        candidates: [candidate("a", 10 * MB, 1)],
        ownerEmail: "ada@example.com",
        projectedBytes: MAX_BYTES_PER_APP,
        projectedRows: 0,
      }),
    ).toEqual({ evictIds: [], fits: true });
  });

  it("evicts least recently updated first until bytes fit", () => {
    const result = selectStagedDatasetsToEvict({
      candidates: [
        candidate("newest", 10 * MB, 300),
        candidate("oldest", 10 * MB, 100),
        candidate("middle", 10 * MB, 200),
      ],
      ownerEmail: "ada@example.com",
      projectedBytes: MAX_BYTES_PER_APP + 15 * MB,
      projectedRows: 0,
    });
    expect(result).toEqual({ evictIds: ["oldest", "middle"], fits: true });
  });

  it("keeps evicting while the row cap is the one still exceeded", () => {
    const result = selectStagedDatasetsToEvict({
      candidates: [
        candidate("a", 1, 100, 100),
        candidate("b", 1, 200, 100),
        candidate("c", 1, 300, 100),
      ],
      ownerEmail: "ada@example.com",
      projectedBytes: 3,
      projectedRows: MAX_ROWS_PER_APP + 150,
    });
    expect(result).toEqual({ evictIds: ["a", "b"], fits: true });
  });

  it("always drops stale datasets but stops at the first fresh one that fits", () => {
    const result = selectStagedDatasetsToEvict({
      candidates: [
        candidate("fresh", 10 * MB, 900),
        candidate("stale-new", 1, 500),
        candidate("stale-old", 1, 100),
      ],
      ownerEmail: "ada@example.com",
      projectedBytes: MAX_BYTES_PER_APP + 1,
      projectedRows: 0,
      staleBefore: 600,
    });
    expect(result).toEqual({
      evictIds: ["stale-old", "stale-new"],
      fits: true,
    });
  });

  it("reports fits=false when dropping every candidate is not enough", () => {
    const result = selectStagedDatasetsToEvict({
      candidates: [candidate("a", 1 * MB, 1), candidate("b", 1 * MB, 2)],
      ownerEmail: "ada@example.com",
      projectedBytes: MAX_BYTES_PER_APP + 10 * MB,
      projectedRows: 0,
    });
    expect(result).toEqual({ evictIds: ["a", "b"], fits: false });
  });

  it("evicts the writer's own datasets before other owners' once nothing is stale", () => {
    const result = selectStagedDatasetsToEvict({
      candidates: [
        candidate("others-oldest", 10 * MB, 100, 0, "linus@example.com"),
        candidate("mine-newer", 10 * MB, 300, 0, "ada@example.com"),
        candidate("mine-newest", 10 * MB, 400, 0, "ada@example.com"),
      ],
      ownerEmail: "ada@example.com",
      projectedBytes: MAX_BYTES_PER_APP + 15 * MB,
      projectedRows: 0,
    });
    expect(result).toEqual({
      evictIds: ["mine-newer", "mine-newest"],
      fits: true,
    });
  });

  it("does not mutate the candidates it is given", () => {
    const candidates = [candidate("b", 1, 2), candidate("a", 1, 1)];
    selectStagedDatasetsToEvict({
      ownerEmail: "ada@example.com",
      candidates,
      projectedBytes: MAX_BYTES_PER_APP + 1,
      projectedRows: 0,
    });
    expect(candidates.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("legacyStagedDatasetId", () => {
  it("derives the legacy id the way stageAs used to", () => {
    expect(
      legacyStagedDatasetId({
        appId: "analytics",
        ownerEmail: "ada@example.com",
        name: "gong calls",
      }),
    ).toBe("ds_analytics_ada_example_com_gong_calls");
  });
});

describe("stagedDatasetId", () => {
  const id = (appId: string, ownerEmail: string, name: string) =>
    stagedDatasetId({ appId, ownerEmail, name });

  it("is stable for the same app, owner, and name", () => {
    expect(id("analytics", "ada@example.com", "gong_calls")).toBe(
      id("analytics", "ada@example.com", "gong_calls"),
    );
  });

  it("keeps owners whose emails sanitize alike on separate ids", () => {
    expect(id("analytics", "a.b@example.com", "calls")).not.toBe(
      id("analytics", "a_b@example.com", "calls"),
    );
  });

  it("keeps apps and names that sanitize alike on separate ids", () => {
    expect(id("analytics", "ada@example.com", "q1 calls")).not.toBe(
      id("analytics", "ada@example.com", "q1_calls"),
    );
    expect(id("a_b", "ada@example.com", "calls")).not.toBe(
      id("a.b", "ada@example.com", "calls"),
    );
  });

  it("does not collapse long names that share a long prefix", () => {
    const prefix = "x".repeat(120);
    expect(id("analytics", "ada@example.com", `${prefix}_one`)).not.toBe(
      id("analytics", "ada@example.com", `${prefix}_two`),
    );
  });

  it("stays a short identifier of safe characters", () => {
    const value = id("analytics", "ada@example.com", `${"n".repeat(200)} ✓/..`);
    expect(value).toMatch(/^ds_[A-Za-z0-9_-]+$/);
    expect(value.length).toBeLessThanOrEqual(80);
  });
});
