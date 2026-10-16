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

  it("covers aliases, panel SQL, trust, roster grain, activity, and active-user clarification", () => {
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
      "weekly-active-users-keeps-membership-clarifier",
      "time-qualified-organization-roles-keeps-membership-grain",
    ]);
    expect(rows.map((row) => row.afterExpectedRank)).toEqual([
      ...Array.from({ length: 14 }, () => "1"),
      "2",
      "1",
    ]);
    expect(rows.map((row) => row.baselineExpectedRank)).toEqual([
      ...Array.from({ length: 12 }, () => "1"),
      "",
      "1",
      "",
      "",
    ]);
    expect(summarizeSyntheticBenchmark(rows)).toMatchObject({
      cases: 16,
      baselineTop1: "13/16",
      baselineHitAt5: "13/16",
      baselineMrr: 13 / 16,
      afterTop1: "15/16",
      afterHitAt5: "16/16",
      afterMrr: 15.5 / 16,
    });

    const ambiguousActiveUsers = rows.find(
      (row) => row.caseId === "weekly-active-users-keeps-membership-clarifier",
    );
    expect(ambiguousActiveUsers?.baselineCandidateIds).not.toContain(
      "dictionary:synthetic-weekly-active-organization-members",
    );
    expect(ambiguousActiveUsers?.afterCandidateIds.split(";")).toEqual(
      expect.arrayContaining([
        "dictionary:synthetic-weekly-active-organization-members",
        "dictionary:synthetic-weekly-active-product-users",
        "dictionary:synthetic-weekly-analytics-app-opens",
        "dictionary:synthetic-monthly-organization-user-seats",
      ]),
    );

    const activeUsersByRole = rows.find(
      (row) =>
        row.caseId ===
        "time-qualified-organization-roles-keeps-membership-grain",
    );
    expect(activeUsersByRole?.baselineTopCandidateId).toBe(
      "dictionary:synthetic-weekly-product-activity-by-role",
    );
    expect(activeUsersByRole?.afterTopCandidateId).toBe(
      "dictionary:synthetic-weekly-members-by-role",
    );
    expect(activeUsersByRole?.afterCandidateIds.split(";")).toEqual(
      expect.arrayContaining([
        "dictionary:synthetic-weekly-members-by-role",
        "dictionary:synthetic-weekly-product-activity-by-role",
      ]),
    );
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
