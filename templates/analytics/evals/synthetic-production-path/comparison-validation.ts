import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

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

// Keep each immutable case set aligned with its production-path harness run.
const V10_CASE_IDS = [
  "current-organization-role-roster",
  "active-workspace-member-roster-with-roles",
  "active-workspace-users-map-to-membership",
  "exclude-inactive-show-active-members",
  "not-excluding-active-members",
  "exclude-everyone-but-active-members",
  "full-workspace-roster-excludes-active-only-source",
  "nonpositive-count-instruction-keeps-member-rows",
  "negated-counts-keep-positive-monthly-trend",
  "monthly-organization-user-count",
  "monthly-workspace-users-by-role",
  "bare-active-members-map-to-membership",
  "active-product-users-map-to-activity",
  "sample-product-users-map-to-identities",
  "active-sample-product-users-map-to-activity",
] as const;

const V11_CASE_IDS = [
  ...V10_CASE_IDS,
  "negated-counts-preserve-role-detail",
] as const;

export const SYNTHETIC_PRODUCTION_PATH_CASE_IDS = V11_CASE_IDS;

type PinnedEvaluation = {
  fixtureRevision: string;
  baselineRevision: string;
  candidateRevision: string;
  caseIds: readonly string[];
};

const PINNED_EVALUATIONS = [
  {
    fixtureRevision: "synthetic-analytics-retrieval-v10",
    baselineRevision: "d0caebd20464a2a00ad417c78943d81438d9333a",
    candidateRevision: "595a07f9a507bba5ba43d6478969c6e19bea9ac2",
    caseIds: V10_CASE_IDS,
  },
  {
    fixtureRevision: "synthetic-analytics-retrieval-v11",
    baselineRevision: "d0caebd20464a2a00ad417c78943d81438d9333a",
    candidateRevision: "fb583843666f597c9eced3d7f4f297fd5cdcec26",
    caseIds: V11_CASE_IDS,
  },
] as const satisfies readonly PinnedEvaluation[];
const PINNED_EVALUATIONS_BY_FIXTURE = new Map(
  PINNED_EVALUATIONS.map(
    (evaluation) => [evaluation.fixtureRevision, evaluation] as const,
  ),
);

const CURRENT_EVALUATION = PINNED_EVALUATIONS.at(-1)!;
export const PRODUCTION_PATH_BASELINE_REVISION =
  CURRENT_EVALUATION.baselineRevision;
export const PRODUCTION_PATH_CANDIDATE_REVISION =
  CURRENT_EVALUATION.candidateRevision;
export const PRODUCTION_PATH_FIXTURE_REVISION =
  CURRENT_EVALUATION.fixtureRevision;
const PRODUCTION_PATH_HARNESS_PATH =
  "templates/analytics/evals/synthetic-production-path/production-path.spec.ts";

// Keep aligned with SOURCE_FILES and codeRevision() in production-path.spec.ts.
const PRODUCTION_PATH_SOURCE_PATHS = [
  "templates/analytics/evals/production-context.ts",
  "templates/analytics/actions/find-data.ts",
  "templates/analytics/server/lib/analytics-query-catalog.ts",
  "templates/analytics/server/lib/analytics-term-matcher.ts",
  "templates/analytics/server/lib/analytics-agent-context.ts",
  "templates/analytics/server/lib/data-dictionary-context.ts",
  "templates/analytics/server/lib/source-index-store.ts",
  "templates/analytics/server/plugins/agent-chat.ts",
  "packages/core/src/agent/production-agent.ts",
  "packages/core/src/eval/agent-runner.ts",
] as const;

const REPOSITORY_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: process.cwd(),
  encoding: "utf8",
}).trim();

function codeRevisionForSourceCommit(
  sourceRevision: string,
  harnessRevision: string,
): string {
  const hash = createHash("sha256");
  for (const repositoryRelativePath of PRODUCTION_PATH_SOURCE_PATHS) {
    const content = execFileSync(
      "git",
      ["show", `${sourceRevision}:${repositoryRelativePath}`],
      { cwd: REPOSITORY_ROOT },
    );
    hash.update(repositoryRelativePath.split("/").at(-1) ?? "source");
    hash.update(content);
  }
  const harness = execFileSync(
    "git",
    ["show", `${harnessRevision}:${PRODUCTION_PATH_HARNESS_PATH}`],
    { cwd: REPOSITORY_ROOT },
  );
  hash.update(PRODUCTION_PATH_HARNESS_PATH);
  hash.update(harness);
  return `sha256:${hash.digest("hex")}`;
}

function harnessRevisionForCommit(revision: string): string {
  const harness = execFileSync(
    "git",
    ["show", `${revision}:${PRODUCTION_PATH_HARNESS_PATH}`],
    { cwd: REPOSITORY_ROOT },
  );
  return `sha256:${createHash("sha256").update(harness).digest("hex")}`;
}

const CODE_REVISIONS_BY_FIXTURE = new Map(
  PINNED_EVALUATIONS.map(
    (evaluation) =>
      [
        evaluation.fixtureRevision,
        {
          baseline: codeRevisionForSourceCommit(
            evaluation.baselineRevision,
            evaluation.candidateRevision,
          ),
          candidate: codeRevisionForSourceCommit(
            evaluation.candidateRevision,
            evaluation.candidateRevision,
          ),
          harness: harnessRevisionForCommit(evaluation.candidateRevision),
        },
      ] as const,
  ),
);

const CURRENT_CODE_REVISIONS = CODE_REVISIONS_BY_FIXTURE.get(
  PRODUCTION_PATH_FIXTURE_REVISION,
)!;
export const PRODUCTION_PATH_BASELINE_CODE_REVISION =
  CURRENT_CODE_REVISIONS.baseline;
export const PRODUCTION_PATH_CANDIDATE_CODE_REVISION =
  CURRENT_CODE_REVISIONS.candidate;
export const PRODUCTION_PATH_HARNESS_REVISION = CURRENT_CODE_REVISIONS.harness;

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
  harness_revision: string;
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
  harnessRevision: string;
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
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Comparison CSV has an invalid " + field + ".");
  }
  return parsed;
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
    if (expectedRank !== null && expectedRank < 1) {
      throw new Error("Comparison CSV has an invalid expected rank.");
    }
    const parsed: ComparisonRow = {
      case_id: caseId,
      phase,
      git_revision: row.git_revision,
      code_revision: row.code_revision,
      harness_revision: row.harness_revision,
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
      !/^sha256:[a-f0-9]{64}$/.test(parsed.harness_revision) ||
      !/^synthetic-analytics-retrieval-v\d+$/.test(parsed.fixture_revision) ||
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
  const harnessRevisions = new Set(
    phaseRows.map((row) => row.harness_revision),
  );
  if (
    revisions.size !== 1 ||
    codeRevisions.size !== 1 ||
    harnessRevisions.size !== 1
  ) {
    throw new Error("Comparison CSV mixes revisions within a phase.");
  }
  const [revision] = revisions;
  const [codeRevision] = codeRevisions;
  const [harnessRevision] = harnessRevisions;
  if (!revision || !codeRevision || !harnessRevision) {
    throw new Error("Comparison CSV phase is missing provenance.");
  }
  return {
    rows: phaseRows.length,
    top1: phaseRows.filter((row) => row.expected_rank === 1).length,
    hitAt5: phaseRows.filter((row) => row.hit_at_5).length,
    revision,
    codeRevision,
    harnessRevision,
  };
}

/** Validate the checked-in before/after artifact as one paired evaluation set. */
export function validateProductionPathComparisonCsv(
  csv: string,
): ProductionPathComparisonSummary {
  const rows = parseComparisonRows(csv);
  const fixtureRevisions = new Set(rows.map((row) => row.fixture_revision));
  if (fixtureRevisions.size !== 1) {
    throw new Error("Comparison CSV mixes fixture revisions.");
  }
  const fixtureRevision = rows[0]?.fixture_revision;
  const pinnedEvaluation = fixtureRevision
    ? PINNED_EVALUATIONS_BY_FIXTURE.get(fixtureRevision)
    : undefined;
  if (!pinnedEvaluation) {
    throw new Error("Comparison CSV fixture revision is not pinned.");
  }
  const pinnedCodeRevisions = CODE_REVISIONS_BY_FIXTURE.get(fixtureRevision);
  if (!pinnedCodeRevisions) {
    throw new Error("Comparison CSV fixture revision is not pinned.");
  }
  const expectedCaseIds = new Set<string>(pinnedEvaluation.caseIds);
  const expectedRows = pinnedEvaluation.caseIds.length * 2 * 2;
  if (rows.length !== expectedRows) {
    throw new Error("Comparison CSV must have two runs per case and phase.");
  }

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
    for (const caseId of pinnedEvaluation.caseIds) {
      for (const run of [1, 2]) {
        if (!rowsByPhaseAndPair.has(phase + ":" + caseId + ":" + run)) {
          throw new Error("Comparison CSV before/after pairs do not align.");
        }
      }
    }
  }

  const before = summarizePhase("before", rows);
  const after = summarizePhase("after", rows);
  const expectedPhaseRows = pinnedEvaluation.caseIds.length * 2;
  if (before.rows !== expectedPhaseRows || after.rows !== expectedPhaseRows) {
    throw new Error(
      "Comparison CSV must have two runs per case in each phase.",
    );
  }
  if (
    before.revision !== pinnedEvaluation.baselineRevision ||
    after.revision !== pinnedEvaluation.candidateRevision
  ) {
    throw new Error(
      "Comparison CSV revisions do not match the pinned baseline and candidate phases.",
    );
  }
  if (
    before.codeRevision !== pinnedCodeRevisions.baseline ||
    after.codeRevision !== pinnedCodeRevisions.candidate
  ) {
    throw new Error(
      "Comparison CSV code hashes do not match the pinned source revisions.",
    );
  }
  if (before.harnessRevision !== after.harnessRevision) {
    throw new Error(
      "Before and after phases must use identical harness bytes.",
    );
  }
  if (before.harnessRevision !== pinnedCodeRevisions.harness) {
    throw new Error(
      "Comparison CSV harness hash does not match the pinned candidate harness.",
    );
  }
  if (after.top1 !== expectedPhaseRows || after.hitAt5 !== expectedPhaseRows) {
    throw new Error(
      `Candidate production-path retrieval is not ${expectedPhaseRows}/${expectedPhaseRows} top-1.`,
    );
  }

  return { before, after, cases: pinnedEvaluation.caseIds.length };
}
