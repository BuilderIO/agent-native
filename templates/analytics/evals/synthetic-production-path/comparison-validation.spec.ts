import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  PRODUCTION_PATH_BASELINE_REVISION,
  PRODUCTION_PATH_CANDIDATE_REVISION,
  PRODUCTION_PATH_FIXTURE_REVISION,
  SYNTHETIC_PRODUCTION_PATH_CASE_IDS,
  validateProductionPathComparisonCsv,
} from "./comparison-validation";

const COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v9-before-after.csv",
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
  for (const phase of ["before", "after"] as const) {
    for (const [
      caseIndex,
      caseId,
    ] of SYNTHETIC_PRODUCTION_PATH_CASE_IDS.entries()) {
      for (const run of [1, 2]) {
        const expectedRank =
          phase === "after" || caseIndex < 2
            ? 1
            : caseIndex < 6
              ? caseIndex
              : caseIndex + 1;
        const hitAt5 = phase === "after" || caseIndex < 6;
        const row = {
          case_id: caseId,
          phase,
          git_revision:
            phase === "before"
              ? PRODUCTION_PATH_BASELINE_REVISION
              : PRODUCTION_PATH_CANDIDATE_REVISION,
          code_revision:
            phase === "before"
              ? "sha256:" + "a".repeat(64)
              : "sha256:" + "b".repeat(64),
          harness_revision: "sha256:" + "c".repeat(64),
          fixture_revision: PRODUCTION_PATH_FIXTURE_REVISION,
          run,
          score: expectedRank === 1 ? 1 : 0,
          reason_code: expectedRank === 1 ? "rank_1" : "ranked_below_1",
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
        rows.push(CSV_COLUMNS.map((column) => String(row[column])).join(","));
      }
    }
  }
  return rows.join("\n");
}

describe("Analytics synthetic production-path comparison artifact", () => {
  it("requires paired cases, two runs, pinned provenance, and safe completions", () => {
    const result = validateProductionPathComparisonCsv(makeComparisonCsv());

    expect(result).toMatchObject({
      cases: 13,
      before: {
        rows: 26,
        top1: 4,
        hitAt5: 12,
        harnessRevision: "sha256:" + "c".repeat(64),
      },
      after: {
        rows: 26,
        top1: 26,
        hitAt5: 26,
        harnessRevision: "sha256:" + "c".repeat(64),
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

  it("rejects an after phase that is not pinned to the candidate revision", () => {
    const stale = makeComparisonCsv().replaceAll(
      PRODUCTION_PATH_CANDIDATE_REVISION,
      "b".repeat(40),
    );

    expect(() => validateProductionPathComparisonCsv(stale)).toThrow(
      "pinned baseline and candidate phases",
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
    const csv = makeComparisonCsv();
    const changed = csv.replace(
      "synthetic-analytics-retrieval-v9",
      "synthetic-analytics-retrieval-v6",
    );

    expect(() => validateProductionPathComparisonCsv(changed)).toThrow(
      "invalid provenance or score fields",
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

  it("validates the checked-in measured comparison", async () => {
    const csv = await readFile(COMPARISON_CSV, "utf8");
    const result = validateProductionPathComparisonCsv(csv);

    expect(result).toMatchObject({
      cases: 13,
      before: { rows: 26, top1: 6, hitAt5: 16 },
      after: { rows: 26, top1: 26, hitAt5: 26 },
    });
    expect(result.before.revision).not.toBe(result.after.revision);
    expect(result.before.codeRevision).not.toBe(result.after.codeRevision);
  });
});
