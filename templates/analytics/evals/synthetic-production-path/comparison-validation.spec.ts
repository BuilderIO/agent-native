import { describe, expect, it } from "vitest";

import {
  PRODUCTION_PATH_BASELINE_REVISION,
  PRODUCTION_PATH_FIXTURE_REVISION,
  SYNTHETIC_PRODUCTION_PATH_CASE_IDS,
  validateProductionPathComparisonCsv,
} from "./comparison-validation";

const CSV_COLUMNS = [
  "case_id",
  "phase",
  "git_revision",
  "code_revision",
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
          phase === "after" || caseIndex < 2 ? 1 : 2 + (caseIndex % 3);
        const hitAt5 = phase === "after" || caseIndex < 6;
        const row = {
          case_id: caseId,
          phase,
          git_revision:
            phase === "before"
              ? PRODUCTION_PATH_BASELINE_REVISION
              : "b".repeat(40),
          code_revision:
            phase === "before"
              ? "sha256:" + "a".repeat(64)
              : "sha256:" + "b".repeat(64),
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
      cases: 9,
      before: { rows: 18, top1: 4, hitAt5: 12 },
      after: { rows: 18, top1: 18, hitAt5: 18 },
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

  it("rejects a mismatched before/after fixture", () => {
    const csv = makeComparisonCsv();
    const changed = csv.replace(
      "synthetic-analytics-retrieval-v7",
      "synthetic-analytics-retrieval-v6",
    );

    expect(() => validateProductionPathComparisonCsv(changed)).toThrow(
      "invalid provenance or score fields",
    );
  });
});
