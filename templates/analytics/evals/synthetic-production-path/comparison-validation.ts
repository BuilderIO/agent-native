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

// Keep aligned with the production-path harness. A case-set change needs a new
// before/after run so both phases still measure identical prompts.
export const SYNTHETIC_PRODUCTION_PATH_CASE_IDS = [
  "current-organization-role-roster",
  "active-workspace-member-roster-with-roles",
  "full-workspace-roster-excludes-active-only-source",
  "nonpositive-count-instruction-keeps-member-rows",
  "monthly-organization-user-count",
  "bare-active-members-map-to-membership",
  "active-product-users-map-to-activity",
  "sample-product-users-map-to-identities",
  "active-sample-product-users-map-to-activity",
] as const;

export const PRODUCTION_PATH_BASELINE_REVISION =
  "75e39e8547b408aa09605e54872d9a8ef6522df9";
export const PRODUCTION_PATH_FIXTURE_REVISION =
  "synthetic-analytics-retrieval-v7";
const REASON_CODES = new Set([
  "rank_1",
  "ranked_below_1",
  "candidate_missing",
  "production_path_failed",
  "find_data_missing",
  "unexpected_action",
  "action_failed",
  "usage_missing",
  "guard_not_applied",
]);

type Phase = "before" | "after";

type ComparisonRow = {
  case_id: string;
  phase: Phase;
  git_revision: string;
  code_revision: string;
  fixture_revision: string;
  run: number;
  score: number;
  reason_code: string;
  expected_rank: number | null;
  hit_at_5: boolean;
  find_data_calls: number;
  other_action_calls: number;
  failed_action_calls: number;
  completed: boolean;
  aborted: boolean;
  input_tokens: number;
  output_tokens: number;
  llm_calls: number;
  latency_ms: number;
};

export type PhaseComparisonSummary = {
  rows: number;
  top1: number;
  hitAt5: number;
  revision: string;
  codeRevision: string;
};

export type ProductionPathComparisonSummary = {
  before: PhaseComparisonSummary;
  after: PhaseComparisonSummary;
  cases: number;
};

function parseInteger(value: string, field: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error("Comparison CSV has an invalid " + field + ".");
  }
  return Number(value);
}

function parseBoolean(value: string, field: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Comparison CSV has an invalid " + field + ".");
}

function parseComparisonRows(csv: string): ComparisonRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines[0] !== CSV_COLUMNS.join(",")) {
    throw new Error(
      "Comparison CSV header does not match the privacy-safe schema.",
    );
  }
  if (lines.some((line) => line.includes('"'))) {
    throw new Error("Comparison CSV contains an unexpected quoted field.");
  }

  return lines.slice(1).map((line) => {
    const values = line.split(",");
    if (values.length !== CSV_COLUMNS.length) {
      throw new Error("Comparison CSV row has an unexpected field count.");
    }
    const row = Object.fromEntries(
      CSV_COLUMNS.map((column, index) => [column, values[index] ?? ""]),
    );
    const phase = row.phase;
    if (phase !== "before" && phase !== "after") {
      throw new Error("Comparison CSV has an invalid phase.");
    }
    const caseId = row.case_id;
    if (!/^[a-z0-9_-]+$/.test(caseId)) {
      throw new Error("Comparison CSV has an unsafe case identifier.");
    }
    const expectedRank =
      row.expected_rank === ""
        ? null
        : parseInteger(row.expected_rank, "expected rank");
    const parsed: ComparisonRow = {
      case_id: caseId,
      phase,
      git_revision: row.git_revision,
      code_revision: row.code_revision,
      fixture_revision: row.fixture_revision,
      run: parseInteger(row.run, "run number"),
      score: parseInteger(row.score, "score"),
      reason_code: row.reason_code,
      expected_rank: expectedRank,
      hit_at_5: parseBoolean(row.hit_at_5, "hit_at_5"),
      find_data_calls: parseInteger(row.find_data_calls, "find_data_calls"),
      other_action_calls: parseInteger(
        row.other_action_calls,
        "other_action_calls",
      ),
      failed_action_calls: parseInteger(
        row.failed_action_calls,
        "failed_action_calls",
      ),
      completed: parseBoolean(row.completed, "completed"),
      aborted: parseBoolean(row.aborted, "aborted"),
      input_tokens: parseInteger(row.input_tokens, "input_tokens"),
      output_tokens: parseInteger(row.output_tokens, "output_tokens"),
      llm_calls: parseInteger(row.llm_calls, "llm_calls"),
      latency_ms: parseInteger(row.latency_ms, "latency_ms"),
    };
    if (
      !/^[a-f0-9]{40}$/.test(parsed.git_revision) ||
      !/^sha256:[a-f0-9]{64}$/.test(parsed.code_revision) ||
      parsed.fixture_revision !== PRODUCTION_PATH_FIXTURE_REVISION ||
      (parsed.score !== 0 && parsed.score !== 1) ||
      !REASON_CODES.has(parsed.reason_code)
    ) {
      throw new Error("Comparison CSV has invalid provenance or score fields.");
    }
    return parsed;
  });
}

function summarizePhase(
  phase: Phase,
  rows: readonly ComparisonRow[],
): PhaseComparisonSummary {
  const phaseRows = rows.filter((row) => row.phase === phase);
  const revisions = new Set(phaseRows.map((row) => row.git_revision));
  const codeRevisions = new Set(phaseRows.map((row) => row.code_revision));
  if (revisions.size !== 1 || codeRevisions.size !== 1) {
    throw new Error("Comparison CSV mixes revisions within a phase.");
  }
  const [revision] = revisions;
  const [codeRevision] = codeRevisions;
  if (!revision || !codeRevision) {
    throw new Error("Comparison CSV phase is missing provenance.");
  }
  return {
    rows: phaseRows.length,
    top1: phaseRows.filter((row) => row.expected_rank === 1).length,
    hitAt5: phaseRows.filter((row) => row.hit_at_5).length,
    revision,
    codeRevision,
  };
}

/** Validate the checked-in before/after artifact as one paired evaluation set. */
export function validateProductionPathComparisonCsv(
  csv: string,
): ProductionPathComparisonSummary {
  const rows = parseComparisonRows(csv);
  const expectedRows = SYNTHETIC_PRODUCTION_PATH_CASE_IDS.length * 2 * 2;
  if (rows.length !== expectedRows) {
    throw new Error("Comparison CSV must have two runs per case and phase.");
  }

  const expectedCaseIds = new Set<string>(SYNTHETIC_PRODUCTION_PATH_CASE_IDS);
  const phases: Phase[] = ["before", "after"];
  const rowsByPhaseAndPair = new Map<string, ComparisonRow>();
  for (const row of rows) {
    if (!expectedCaseIds.has(row.case_id) || (row.run !== 1 && row.run !== 2)) {
      throw new Error("Comparison CSV contains an unexpected case or run.");
    }
    const key = row.phase + ":" + row.case_id + ":" + row.run;
    if (rowsByPhaseAndPair.has(key)) {
      throw new Error("Comparison CSV contains a duplicate case/run pair.");
    }
    rowsByPhaseAndPair.set(key, row);
    if (
      row.find_data_calls !== 1 ||
      row.other_action_calls !== 0 ||
      row.failed_action_calls !== 0 ||
      !row.completed ||
      row.aborted ||
      row.llm_calls === 0
    ) {
      throw new Error(
        "Comparison CSV contains an invalid production-path run.",
      );
    }
    const expectedHitAt5 = row.expected_rank !== null && row.expected_rank <= 5;
    const expectedReason =
      row.expected_rank === null
        ? "candidate_missing"
        : row.expected_rank === 1
          ? "rank_1"
          : "ranked_below_1";
    if (
      row.hit_at_5 !== expectedHitAt5 ||
      row.reason_code !== expectedReason ||
      row.score !== (expectedReason === "rank_1" ? 1 : 0)
    ) {
      throw new Error(
        "Comparison CSV score does not match the measured rank: " +
          JSON.stringify({ row, expectedHitAt5, expectedReason }),
      );
    }
  }

  for (const phase of phases) {
    for (const caseId of SYNTHETIC_PRODUCTION_PATH_CASE_IDS) {
      for (const run of [1, 2]) {
        if (!rowsByPhaseAndPair.has(phase + ":" + caseId + ":" + run)) {
          throw new Error("Comparison CSV before/after pairs do not align.");
        }
      }
    }
  }

  const before = summarizePhase("before", rows);
  const after = summarizePhase("after", rows);
  if (before.rows !== 18 || after.rows !== 18) {
    throw new Error("Comparison CSV must have 18 rows in each phase.");
  }
  if (
    before.revision !== PRODUCTION_PATH_BASELINE_REVISION ||
    after.revision === PRODUCTION_PATH_BASELINE_REVISION
  ) {
    throw new Error("Comparison CSV revisions do not match the pinned phases.");
  }
  if (after.top1 !== 18 || after.hitAt5 !== 18) {
    throw new Error("Candidate production-path retrieval is not 18/18 top-1.");
  }

  return { before, after, cases: SYNTHETIC_PRODUCTION_PATH_CASE_IDS.length };
}
