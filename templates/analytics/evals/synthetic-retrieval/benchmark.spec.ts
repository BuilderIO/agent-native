import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  BASELINE_REVISION,
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

  it("covers aliases, panel SQL, semantic scope, trust, and off-topic naming", () => {
    const rows = computeSyntheticBenchmark();

    expect(rows.map((row) => row.caseId)).toEqual([
      "dictionary-alias-mrr",
      "panel-sql-only-term",
      "semantic-scope-membership",
      "approved-over-generated",
      "builder-users-organization-vs-connect",
    ]);
    expect(rows.map((row) => row.afterExpectedRank)).toEqual([
      "1",
      "1",
      "1",
      "1",
      "1",
    ]);
    expect(rows.map((row) => row.baselineExpectedRank)).toEqual([
      "1",
      "1",
      "1",
      "1",
      "2",
    ]);
    expect(summarizeSyntheticBenchmark(rows)).toMatchObject({
      cases: 5,
      baselineTop1: "4/5",
      baselineHitAt5: "5/5",
      baselineMrr: 0.9,
      afterTop1: "5/5",
      afterHitAt5: "5/5",
      afterMrr: 1,
    });
  });

  it("records the measured origin/main revision with every baseline row", () => {
    expect(
      new Set(computeSyntheticBenchmark().map((row) => row.baselineRevision)),
    ).toEqual(new Set([BASELINE_REVISION]));
  });
});
