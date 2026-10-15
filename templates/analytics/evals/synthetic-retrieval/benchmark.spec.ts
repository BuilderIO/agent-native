import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  BASELINE_REVISION,
  CSV_PATH,
  FIXTURE_REVISION,
  computeSyntheticBenchmark,
  renderSyntheticBenchmarkCsv,
  summarizeSyntheticBenchmark,
} from "./benchmark";

describe("SYNTHETIC Analytics retrieval benchmark", () => {
  it("keeps the checked-in CSV equal to computed matcher and baseline outputs", async () => {
    const checkedIn = await readFile(CSV_PATH, "utf8");

    expect(checkedIn).toBe(`${renderSyntheticBenchmarkCsv()}\n`);
  });

  it("covers aliases, panel SQL, trust, roster grain, activity, and product-specific active-user routing", () => {
    const rows = computeSyntheticBenchmark();

    expect(rows.every((row) => row.fixtureRevision === FIXTURE_REVISION)).toBe(
      true,
    );

    expect(rows.map((row) => row.caseId)).toEqual([
      "dictionary-alias-mrr",
      "panel-sql-only-term",
      "semantic-scope-membership",
      "approved-over-generated",
      "organization-product-users-vs-membership-grain",
      "organization-roster-roles-vs-monthly-count",
      "organization-user-activity-vs-membership",
      "aggregate-wording-keeps-monthly-count",
      "active-member-roster-vs-product-events",
      "bare-active-members-vs-product-events",
      "negated-count-instruction-keeps-membership-rows",
      "metadata-only-roster-keeps-membership-grain",
      "weekly-active-builder-users-by-org-vs-membership-and-publishing",
      "weekly-agent-native-app-opens-vs-builder-activity",
    ]);
    expect(rows.map((row) => row.afterExpectedRank)).toEqual(
      Array.from({ length: 14 }, () => "1"),
    );
    expect(rows.map((row) => row.baselineExpectedRank)).toEqual([
      ...Array.from({ length: 12 }, () => "1"),
      "",
      "1",
    ]);
    expect(summarizeSyntheticBenchmark(rows)).toMatchObject({
      cases: 14,
      baselineTop1: "13/14",
      baselineHitAt5: "13/14",
      baselineMrr: 13 / 14,
      afterTop1: "14/14",
      afterHitAt5: "14/14",
      afterMrr: 1,
    });
  });

  it("records the measured origin/main revision with every baseline row", () => {
    expect(
      new Set(computeSyntheticBenchmark().map((row) => row.baselineRevision)),
    ).toEqual(new Set([BASELINE_REVISION]));
  });

  it("keeps production model names and policies out of synthetic output", () => {
    expect(renderSyntheticBenchmarkCsv()).not.toMatch(
      /dbt_(?:mart|intermediate)|@builder\.io|users\.organizations/i,
    );
  });
});
