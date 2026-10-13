import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  PRODUCTION_PATH_BASELINE_CODE_REVISION,
  PRODUCTION_PATH_BASELINE_REVISION,
  PRODUCTION_PATH_CANDIDATE_CODE_REVISION,
  PRODUCTION_PATH_CANDIDATE_REVISION,
  PRODUCTION_PATH_FIXTURE_REVISION,
  PRODUCTION_PATH_HARNESS_REVISION,
  SYNTHETIC_PRODUCTION_PATH_CASE_IDS,
  validateProductionPathComparisonCsv,
} from "./comparison-validation";

const V10_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v10-before-after.csv",
    import.meta.url,
  ),
);
const V11_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v11-before-after.csv",
    import.meta.url,
  ),
);
const V12_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v12-before-after.csv",
    import.meta.url,
  ),
);
const CSV_COLUMNS = [
  "case_id",
  "phase",
  "git_revision",
  "code_revision",
  "harness_revision",
  "fixture_revision",
  "run",
  "score",
  "reason_code",
  "expected_rank",
  "hit_at_5",
  "find_data_calls",
  "other_action_calls",
  "failed_action_calls",
  "completed",
  "aborted",
  "input_tokens",
  "output_tokens",
  "llm_calls",
  "latency_ms",
] as const;

function makeComparisonCsv(): string {
  const rows = [CSV_COLUMNS.join(",")];
  const beforeRanks: readonly (number | null)[] = [
    3,
    null,
    null,
    null,
    null,
    null,
    null,
    4,
    1,
    4,
    1,
    2,
    null,
    3,
    1,
    3,
    null,
    null,
    null,
    null,
  ];
  for (const phase of ["before", "after"] as const) {
    for (const [
      caseIndex,
      caseId,
    ] of SYNTHETIC_PRODUCTION_PATH_CASE_IDS.entries()) {
      for (const run of [1, 2]) {
        const expectedRank =
          phase === "after" ? 1 : (beforeRanks[caseIndex] ?? null);
        const hitAt5 = expectedRank !== null && expectedRank <= 5;
        const reasonCode =
          expectedRank === null
            ? "candidate_missing"
            : expectedRank === 1
              ? "rank_1"
              : "ranked_below_1";
        const row = {
          case_id: caseId,
          phase,
          git_revision:
            phase === "before"
              ? PRODUCTION_PATH_BASELINE_REVISION
              : PRODUCTION_PATH_CANDIDATE_REVISION,
          code_revision:
            phase === "before"
              ? PRODUCTION_PATH_BASELINE_CODE_REVISION
              : PRODUCTION_PATH_CANDIDATE_CODE_REVISION,
          harness_revision: PRODUCTION_PATH_HARNESS_REVISION,
          fixture_revision: PRODUCTION_PATH_FIXTURE_REVISION,
          run,
          score: reasonCode === "rank_1" ? 1 : 0,
          reason_code: reasonCode,
          expected_rank: expectedRank,
          hit_at_5: hitAt5,
          find_data_calls: 1,
          other_action_calls: 0,
          failed_action_calls: 0,
          completed: true,
          aborted: false,
          input_tokens: 240,
          output_tokens: 48,
          llm_calls: 2,
          latency_ms: 20 + run,
        };
        rows.push(
          CSV_COLUMNS.map((column) =>
            row[column] === null ? "" : String(row[column]),
          ).join(","),
        );
      }
    }
  }
  return rows.join("\n");
}

describe("Analytics synthetic production-path comparison artifact", () => {
  it("requires paired cases, two runs, pinned provenance, and safe completions", () => {
    const result = validateProductionPathComparisonCsv(makeComparisonCsv());

    expect(result).toMatchObject({
      cases: 20,
      before: {
        rows: 40,
        top1: 6,
        hitAt5: 18,
        harnessRevision: PRODUCTION_PATH_HARNESS_REVISION,
      },
      after: {
        rows: 40,
        top1: 40,
        hitAt5: 40,
        harnessRevision: PRODUCTION_PATH_HARNESS_REVISION,
      },
    });
    expect(result.before.revision).not.toBe(result.after.revision);
    expect(result.before.codeRevision).not.toBe(result.after.codeRevision);
  });

  it("rejects a missing phase/run row", () => {
    const csv = makeComparisonCsv();
    const rows = csv.trimEnd().split(/\r?\n/);

    expect(() =>
      validateProductionPathComparisonCsv(rows.slice(0, -1).join("\n")),
    ).toThrow("two runs per case and phase");
  });

  it("rejects a zero-based candidate rank", () => {
    const rows = makeComparisonCsv().trimEnd().split(/\r?\n/);
    const columns = rows[1]!.split(",");
    columns[7] = "0";
    columns[8] = "ranked_below_1";
    columns[9] = "0";
    columns[10] = "true";
    rows[1] = columns.join(",");

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "invalid expected rank",
    );
  });

  it("rejects retrieval ranks without a completed production-path action", () => {
    const rows = makeComparisonCsv().trimEnd().split(/\r?\n/);
    const columns = rows[1]!.split(",");
    columns[11] = "0";
    rows[1] = columns.join(",");

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "retrieval ranks require a complete, valid production-path run",
    );
  });

  it.each(["production_path_failed", "unexpected_action"] as const)(
    "rejects a %s row that claims a retrieval rank",
    (reasonCode) => {
      const rows = makeComparisonCsv().trimEnd().split(/\r?\n/);
      const columns = rows[1]!.split(",");
      columns[7] = "0";
      columns[8] = reasonCode;
      columns[9] = "1";
      columns[10] = "true";
      if (reasonCode === "unexpected_action") {
        columns[11] = "0";
        columns[12] = "1";
      }
      rows[1] = columns.join(",");

      expect(() =>
        validateProductionPathComparisonCsv(rows.join("\n")),
      ).toThrow("failure reasons cannot report a retrieval rank or hit");
    },
  );

  it("rejects failure codes that contradict their observed action fields", () => {
    const rows = makeComparisonCsv().trimEnd().split(/\r?\n/);
    const columns = rows[1]!.split(",");
    columns[7] = "0";
    columns[8] = "unexpected_action";
    columns[9] = "";
    columns[10] = "false";
    columns[12] = "0";
    rows[1] = columns.join(",");

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "unexpected_action reason does not match its action fields",
    );
  });

  it("rejects failed action counts above the recorded action total", () => {
    const rows = makeComparisonCsv().trimEnd().split(/\r?\n/);
    const columns = rows[1]!.split(",");
    columns[7] = "0";
    columns[8] = "action_failed";
    columns[9] = "";
    columns[10] = "false";
    columns[13] = "2";
    rows[1] = columns.join(",");

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "failed action calls exceed recorded action calls",
    );
  });

  it("rejects an after phase that is not pinned to the candidate revision", () => {
    const stale = makeComparisonCsv().replaceAll(
      PRODUCTION_PATH_CANDIDATE_REVISION,
      "b".repeat(40),
    );

    expect(() => validateProductionPathComparisonCsv(stale)).toThrow(
      "pinned baseline and candidate phases",
    );
  });

  it("rejects well-formed code hashes unrelated to the pinned source revisions", () => {
    const rows = makeComparisonCsv().trimEnd().split(/\r?\n/);
    for (let index = 1; index < rows.length; index++) {
      if (!rows[index]!.includes(",after,")) continue;
      const columns = rows[index]!.split(",");
      columns[3] = "sha256:" + "f".repeat(64);
      rows[index] = columns.join(",");
    }

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "code hashes do not match the pinned source revisions",
    );
  });

  it("rejects integers outside the safe numeric range", () => {
    const rows = makeComparisonCsv().trimEnd().split(/\r?\n/);
    const columns = rows[1]!.split(",");
    columns[19] = "9007199254740992";
    rows[1] = columns.join(",");

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "invalid latency_ms",
    );
  });

  it("rejects a duplicate that misaligns the before/after case/run pairs", () => {
    const rows = makeComparisonCsv().trimEnd().split(/\r?\n/);
    const lastRow = rows.at(-1)!;
    const columns = lastRow.split(",");
    columns[0] = SYNTHETIC_PRODUCTION_PATH_CASE_IDS[7];
    rows[rows.length - 1] = columns.join(",");

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "duplicate case/run pair",
    );
  });

  it("rejects a mismatched before/after fixture", () => {
    const changed = makeComparisonCsv().replaceAll(
      PRODUCTION_PATH_FIXTURE_REVISION,
      "synthetic-analytics-retrieval-v99",
    );

    expect(() => validateProductionPathComparisonCsv(changed)).toThrow(
      "fixture revision is not pinned",
    );
  });

  it("rejects before/after rows made with different harness bytes", () => {
    const rows = makeComparisonCsv().trimEnd().split(/\r?\n/);
    for (let index = 1; index < rows.length; index++) {
      if (!rows[index]!.includes(",after,")) continue;
      const columns = rows[index]!.split(",");
      columns[4] = "sha256:" + "d".repeat(64);
      rows[index] = columns.join(",");
    }

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "identical harness bytes",
    );
  });

  it("retains aborted production-path runs as failures in the comparison", () => {
    const rows = makeComparisonCsv().trimEnd().split(/\r?\n/);
    const afterStart = 1 + SYNTHETIC_PRODUCTION_PATH_CASE_IDS.length * 2;
    const columns = rows[afterStart]!.split(",");
    columns[7] = "0";
    columns[8] = "production_path_failed";
    columns[9] = "";
    columns[10] = "false";
    columns[11] = "0";
    columns[12] = "0";
    columns[13] = "0";
    columns[14] = "false";
    columns[15] = "true";
    columns[16] = "0";
    columns[17] = "0";
    columns[18] = "0";
    columns[19] = "0";
    rows[afterStart] = columns.join(",");

    const result = validateProductionPathComparisonCsv(rows.join("\n"));
    expect(result.after).toMatchObject({
      rows: 40,
      top1: 39,
      retrievalTop1: 39,
      hitAt5: 39,
      failedRuns: 1,
      abortedRuns: 1,
    });
  });

  it("retains a completed retrieval miss for honest quality reporting", () => {
    const rows = makeComparisonCsv().trimEnd().split(/\r?\n/);
    const afterStart = 1 + SYNTHETIC_PRODUCTION_PATH_CASE_IDS.length * 2;
    const columns = rows[afterStart + 2]!.split(",");
    columns[7] = "0";
    columns[8] = "ranked_below_1";
    columns[9] = "6";
    columns[10] = "false";
    rows[afterStart + 2] = columns.join(",");

    const result = validateProductionPathComparisonCsv(rows.join("\n"));
    expect(result.after).toMatchObject({
      top1: 39,
      retrievalTop1: 39,
      hitAt5: 39,
      failedRuns: 1,
      abortedRuns: 0,
    });
  });

  it("validates the preserved v10 measured comparison", async () => {
    const csv = await readFile(V10_COMPARISON_CSV, "utf8");
    const result = validateProductionPathComparisonCsv(csv);

    expect(result).toMatchObject({
      cases: 15,
      before: { rows: 30, top1: 6, hitAt5: 16 },
      after: { rows: 30, top1: 30, hitAt5: 30 },
    });
    expect(result.before.revision).not.toBe(result.after.revision);
    expect(result.before.codeRevision).not.toBe(result.after.codeRevision);
  });

  it("validates the checked-in v11 measured comparison", async () => {
    const csv = await readFile(V11_COMPARISON_CSV, "utf8");
    const result = validateProductionPathComparisonCsv(csv);

    expect(result).toMatchObject({
      cases: 16,
      before: { rows: 32, top1: 6, hitAt5: 18 },
      after: { rows: 32, top1: 32, hitAt5: 32 },
    });
    expect(result.before.revision).not.toBe(result.after.revision);
    expect(result.before.codeRevision).not.toBe(result.after.codeRevision);
  });

  it("validates the v12 measurement and reports its baseline misses", async () => {
    const csv = await readFile(V12_COMPARISON_CSV, "utf8");
    const result = validateProductionPathComparisonCsv(csv);

    expect(result).toMatchObject({
      cases: 20,
      before: {
        rows: 40,
        top1: 6,
        retrievalTop1: 6,
        hitAt5: 18,
        failedRuns: 34,
        abortedRuns: 0,
        revision: PRODUCTION_PATH_BASELINE_REVISION,
        codeRevision: PRODUCTION_PATH_BASELINE_CODE_REVISION,
        harnessRevision: PRODUCTION_PATH_HARNESS_REVISION,
      },
      after: {
        rows: 40,
        top1: 40,
        retrievalTop1: 40,
        hitAt5: 40,
        failedRuns: 0,
        abortedRuns: 0,
        revision: PRODUCTION_PATH_CANDIDATE_REVISION,
        codeRevision: PRODUCTION_PATH_CANDIDATE_CODE_REVISION,
        harnessRevision: PRODUCTION_PATH_HARNESS_REVISION,
      },
    });
  });
});
