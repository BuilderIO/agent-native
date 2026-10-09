import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  CSV_PATH,
  computeSyntheticBenchmark,
  renderSyntheticBenchmarkCsv,
  summarizeSyntheticBenchmark,
} from "./benchmark";

describe("SYNTHETIC Analytics retrieval benchmark", () => {
  it("keeps the checked-in CSV equal to computed matcher and baseline outputs", async () => {
    const checkedIn = await readFile(CSV_PATH, "utf8");

    expect(checkedIn).toBe(`${renderSyntheticBenchmarkCsv()}\n`);
  });

  it("covers aliases, panel SQL, semantic scope, and trust ordering", () => {
    const rows = computeSyntheticBenchmark();

    expect(rows.map((row) => row.caseId)).toEqual([
      "dictionary-alias-mrr",
      "panel-sql-only-term",
      "semantic-scope-membership",
      "approved-over-generated",
    ]);
    expect(rows.map((row) => row.afterExpectedRank)).toEqual([
      "1",
      "1",
      "1",
      "1",
    ]);
    expect(rows.map((row) => row.baselineExpectedRank)).toEqual([
      "1",
      "1",
      "2",
      "1",
    ]);
    expect(summarizeSyntheticBenchmark(rows)).toMatchObject({
      cases: 4,
      baselineTop1: "3/4",
      baselineHitAt5: "4/4",
      baselineMrr: 0.875,
      afterTop1: "4/4",
      afterHitAt5: "4/4",
      afterMrr: 1,
    });
  });

  it("records the previous production catalog revision with every baseline row", () => {
    expect(
      new Set(computeSyntheticBenchmark().map((row) => row.baselineRevision)),
    ).toEqual(new Set(["f2c69d7718a9204f707bef6257045a71b78be457"]));
  });
});
