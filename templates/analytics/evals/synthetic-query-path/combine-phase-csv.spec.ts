import { describe, expect, it } from "vitest";

import { combinePhaseCsvTexts } from "./combine-phase-csv.js";

const HEADER = [
  "phase",
  "source_revision",
  "harness_sha256",
  "case_key",
  "replicate",
  "score",
  "reason_code",
  "completed",
  "aborted",
  "production_path_invoked",
  "guard_applied",
  "owner_org_context_verified",
  "usage_captured",
  "tool_call_count",
  "provider_call_count",
  "dbt_call_count",
  "bigquery_call_count",
  "schema_search_call_count",
  "provenance_distinguished",
  "event_taxonomy_grounded",
  "bounded_grouping_verified",
  "bounded_time_scope_verified",
  "first_party_div_recovery_verified",
  "organization_grain_verified",
  "partial_warning_disclosed",
  "latency_ms",
  "input_tokens",
  "output_tokens",
  "llm_calls",
] as const;

const VALID_HASH = "a".repeat(64);
const VALID_REVISION = "b".repeat(40);
const CASE_KEYS = [
  "synthetic-unbuilt-index-does-not-claim-absence",
  "synthetic-content-api-requests-not-visual-views",
  "synthetic-source-provenance-ambiguity",
  "synthetic-dbt-disconnected-abstains",
  "synthetic-dbt-paginated-bounded-grouping",
  "synthetic-dbt-rolling-window-product-category",
  "synthetic-dbt-annual-period-rejects-all-time",
  "synthetic-latest-skill-event-taxonomy",
  "synthetic-latest-monthly-ai-credits-by-workspace",
  "synthetic-bigquery-partial-warning-disclosed",
  "synthetic-schema-discovery-corrects-query",
  "synthetic-dbt-organization-description-does-not-change-grain",
  "synthetic-first-party-div-recovery",
] as const;
const REPLICATES = ["1", "2"] as const;

function row(
  phase: "baseline" | "candidate",
  overrides: Partial<Record<(typeof HEADER)[number], string>> = {},
): string[] {
  const values: Record<(typeof HEADER)[number], string> = {
    phase,
    source_revision: VALID_REVISION,
    harness_sha256: VALID_HASH,
    case_key: "synthetic-content-api-requests-not-visual-views",
    replicate: "1",
    score: "1",
    reason_code: "pass",
    completed: "true",
    aborted: "false",
    production_path_invoked: "true",
    guard_applied: "true",
    owner_org_context_verified: "true",
    usage_captured: "true",
    tool_call_count: "1",
    provider_call_count: "0",
    dbt_call_count: "0",
    bigquery_call_count: "0",
    schema_search_call_count: "0",
    provenance_distinguished: "false",
    event_taxonomy_grounded: "false",
    bounded_grouping_verified: "false",
    bounded_time_scope_verified: "false",
    first_party_div_recovery_verified: "false",
    organization_grain_verified: "false",
    partial_warning_disclosed: "false",
    latency_ms: "10",
    input_tokens: "20",
    output_tokens: "5",
    llm_calls: "1",
    ...overrides,
  };
  return HEADER.map((column) => values[column]);
}

function csv(...rows: string[][]): string {
  return [HEADER.join(","), ...rows.map((cells) => cells.join(","))].join("\n");
}

function completePhaseRows(
  phase: "baseline" | "candidate",
  overrides: Partial<Record<(typeof HEADER)[number], string>> = {},
): string[][] {
  return CASE_KEYS.flatMap((caseKey) =>
    REPLICATES.map((replicate) =>
      row(phase, { ...overrides, case_key: caseKey, replicate }),
    ),
  );
}

describe("combinePhaseCsvTexts", () => {
  it("combines paired rows with verified production receipts", () => {
    const result = combinePhaseCsvTexts(
      csv(...completePhaseRows("baseline")),
      csv(...completePhaseRows("candidate")),
    );

    expect(result).toMatchObject({
      baselineRows: 26,
      candidateRows: 26,
      passed: [26, 26],
    });
    expect(result.csv).toContain("baseline");
    expect(result.csv).toContain("candidate");
  });

  it("rejects unapproved columns instead of copying them", () => {
    const baseline = `${HEADER.join(",")},customer_email\n${row("baseline").join(",")},person@example.invalid`;

    expect(() => combinePhaseCsvTexts(baseline, csv(row("candidate")))).toThrow(
      "baseline CSV does not match the safe schema.",
    );
  });

  it("rejects case keys outside the reviewed synthetic set", () => {
    const unreviewedKey = "synthetic-unreviewed-name";
    const baselineRows = completePhaseRows("baseline");
    baselineRows[0] = row("baseline", { case_key: unreviewedKey });
    const candidateRows = completePhaseRows("candidate");
    candidateRows[0] = row("candidate", { case_key: unreviewedKey });
    expect(() =>
      combinePhaseCsvTexts(csv(...baselineRows), csv(...candidateRows)),
    ).toThrow("baseline CSV has an invalid synthetic case key.");
  });

  it("rejects identical but incomplete case/replicate sets", () => {
    const baselineRows = completePhaseRows("baseline").slice(1);
    const candidateRows = completePhaseRows("candidate").slice(1);

    expect(() =>
      combinePhaseCsvTexts(csv(...baselineRows), csv(...candidateRows)),
    ).toThrow("baseline CSV does not contain the complete case/replicate set.");
  });

  it("rejects mixed source revisions inside a phase", () => {
    const baseline = csv(
      ...completePhaseRows("baseline").map((cells, index) =>
        index === 1
          ? row("baseline", {
              case_key: "synthetic-unbuilt-index-does-not-claim-absence",
              replicate: "2",
              source_revision: "c".repeat(40),
            })
          : cells,
      ),
    );

    expect(() =>
      combinePhaseCsvTexts(baseline, csv(...completePhaseRows("candidate"))),
    ).toThrow("baseline CSV must use one source revision.");
  });

  it("rejects invalid scores and missing production receipts", () => {
    expect(() =>
      combinePhaseCsvTexts(
        csv(row("baseline", { score: "2" })),
        csv(...completePhaseRows("candidate")),
      ),
    ).toThrow("baseline CSV has an invalid score.");

    expect(() =>
      combinePhaseCsvTexts(
        csv(row("baseline", { usage_captured: "false" })),
        csv(...completePhaseRows("candidate")),
      ),
    ).toThrow("baseline CSV is missing valid production receipts.");
  });

  it("counts an aborted production-path run as a failure", () => {
    const aborted = {
      score: "0",
      reason_code: "aborted",
      completed: "false",
      aborted: "true",
      production_path_invoked: "false",
      guard_applied: "false",
      owner_org_context_verified: "false",
      usage_captured: "false",
    };
    const baselineRows = completePhaseRows("baseline");
    baselineRows[0] = row("baseline", {
      ...aborted,
      case_key: CASE_KEYS[0],
      replicate: REPLICATES[0],
    });
    const candidateRows = completePhaseRows("candidate");
    candidateRows[0] = row("candidate", {
      ...aborted,
      case_key: CASE_KEYS[0],
      replicate: REPLICATES[0],
    });
    const result = combinePhaseCsvTexts(
      csv(...baselineRows),
      csv(...candidateRows),
    );

    expect(result.passed).toEqual([25, 25]);
  });
});
