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

  it("covers aliases, panel SQL, trust, roster grain, activity, and aggregates", () => {
    const rows = computeSyntheticBenchmark();

    expect(
      rows.every(
        (row) =>
          row.dbtSchemaRevision === "000d5e351b5be91166610a4acf1b10fea565fcff",
      ),
    ).toBe(true);

    expect(rows.map((row) => row.caseId)).toEqual([
      "dictionary-alias-mrr",
      "panel-sql-only-term",
      "semantic-scope-membership",
      "approved-over-generated",
      "organization-users-vs-connect",
      "organization-roster-roles-vs-monthly-count",
      "organization-user-activity-vs-membership",
      "aggregate-wording-keeps-monthly-count",
    ]);
    expect(rows.map((row) => row.afterExpectedRank)).toEqual(
      Array.from({ length: 8 }, () => "1"),
    );
    expect(rows.map((row) => row.baselineExpectedRank)).toEqual([
      "1",
      "1",
      "1",
      "1",
      "1",
      "2",
      "2",
      "1",
    ]);
    expect(summarizeSyntheticBenchmark(rows)).toMatchObject({
      cases: 8,
      baselineTop1: "6/8",
      baselineHitAt5: "8/8",
      baselineMrr: 0.875,
      afterTop1: "8/8",
      afterHitAt5: "8/8",
      afterMrr: 1,
    });
  });

  it("records the measured origin/main revision with every baseline row", () => {
    expect(
      new Set(computeSyntheticBenchmark().map((row) => row.baselineRevision)),
    ).toEqual(new Set([BASELINE_REVISION]));
  });
});
