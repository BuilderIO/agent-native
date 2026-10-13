const LEGACY_CSV_COLUMNS = [
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
const CSV_COLUMNS = [...LEGACY_CSV_COLUMNS, "stale_index_marked"] as const;

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

const V12_CASE_IDS = [
  ...V11_CASE_IDS,
  "long-exclusion-clause-excludes-active-only-source",
  "negated-removal-keeps-active-members",
  "not-to-exclude-keeps-active-members",
  "later-independent-exclusion-excludes-active-members",
] as const;

const V13_CASE_IDS = [
  ...V12_CASE_IDS,
  "workspace-membership-prefers-row-grain",
] as const;

const V14_CASE_IDS = [
  ...V13_CASE_IDS,
  "stale-generated-index-yields-to-current-source",
] as const;

export const SYNTHETIC_PRODUCTION_PATH_CASE_IDS = V14_CASE_IDS;

type PinnedEvaluation = {
  fixtureRevision: string;
  baselineRevision: string;
  baselineCodeRevision: string;
  candidateRevision: string;
  candidateCodeRevision: string;
  harnessRevision: string;
  caseIds: readonly string[];
  staleIndexMarker?: boolean;
};

const PINNED_EVALUATIONS = [
  {
    fixtureRevision: "synthetic-analytics-retrieval-v10",
    baselineRevision: "d0caebd20464a2a00ad417c78943d81438d9333a",
    baselineCodeRevision:
      "sha256:fb3f0bad8151998d81fcf994a55143ee58f64ed8c3483404237669514656a268",
    candidateRevision: "595a07f9a507bba5ba43d6478969c6e19bea9ac2",
    candidateCodeRevision:
      "sha256:9a1fc94f54d57e6656dc2793628bcccf917a416980fa1c861b7f44bd28f3d139",
    harnessRevision:
      "sha256:5e746b9ffc64ce67cb7ee0b16a05b276ca6341bd26e90ba7bf12e26028df9ac9",
    caseIds: V10_CASE_IDS,
  },
  {
    fixtureRevision: "synthetic-analytics-retrieval-v11",
    baselineRevision: "d0caebd20464a2a00ad417c78943d81438d9333a",
    baselineCodeRevision:
      "sha256:a31ae9051b291723b73c09752df3711dcea125df319de7b96483a52769def191",
    candidateRevision: "fb583843666f597c9eced3d7f4f297fd5cdcec26",
    candidateCodeRevision:
      "sha256:2b0445b08a32d9afabc18ba1e429ee07898ad7033c4575d70e46ac6f184f9358",
    harnessRevision:
      "sha256:b9acd1d7c3c9758d57a4485fd56a72c7954ad2b3fefe74f128fc16fb1ca18472",
    caseIds: V11_CASE_IDS,
  },
  {
    fixtureRevision: "synthetic-analytics-retrieval-v12",
    baselineRevision: "1999aef1ad68dcf9d44423fa95df1a7acb67e8c5",
    baselineCodeRevision:
      "sha256:5bf2d8b224e03b2fb8081a0f61e6e626d420a51c2a3de60c6d6d50595063e8f7",
    candidateRevision: "35fdffa8f309e2a7820d6c6e1e5decad04ebf989",
    candidateCodeRevision:
      "sha256:7b4e074cb1b62a254e00af4924c37ac923ff280dfdf74b63fb000a207d929e38",
    harnessRevision:
      "sha256:ca70d1a86c17bff2777ac22b4428f4f4370e4d71ad96e60266f22a54a6ba2792",
    caseIds: V12_CASE_IDS,
  },
  {
    fixtureRevision: "synthetic-analytics-retrieval-v13",
    baselineRevision: "afe2ee7e45f6f3f380571a6d18918fc49d71c6e1",
    baselineCodeRevision:
      "sha256:5efa951a394abdcc5d39090b58d0277f1e0392a0ca1c984c96def8935cabcafe",
    candidateRevision: "586b87b50a99fe0d5023637df9c735bafb47d035",
    candidateCodeRevision:
      "sha256:f1cda350256c3ec48f87bf151c7284291ecf4467b2c1f9fa5c5062e5fea8b764",
    harnessRevision:
      "sha256:91a1a65cebb864d1368b624b9dac7e2ab4c32710357e52c4a9c25c6c705a7d97",
    caseIds: V13_CASE_IDS,
  },
  {
    fixtureRevision: "synthetic-analytics-retrieval-v14",
    baselineRevision: "0fb4de3ed8bd4e317543575c9b188b93db392d26",
    baselineCodeRevision:
      "sha256:16768496b83db90ba30f74df6ea49f934c1ee11e6ba3fb8d1c7f65ee089e44ac",
    candidateRevision: "ba53610515501c3f8657168c2c7346a713ac03df",
    candidateCodeRevision:
      "sha256:70424c4be93310ac67c21eaf3af6d68e10c18d87e495bce2653c5c40b409e07c",
    harnessRevision:
      "sha256:04428dd484b504b646a93e1b6b35151fcc344568c8c1cd7780fa498822df8a93",
    caseIds: V14_CASE_IDS,
    staleIndexMarker: true,
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

// CI uses shallow checkouts, so provenance hashes cannot be recomputed from old git objects.
const CODE_REVISIONS_BY_FIXTURE = new Map(
  PINNED_EVALUATIONS.map(
    (evaluation) =>
      [
        evaluation.fixtureRevision,
        {
          baseline: evaluation.baselineCodeRevision,
          candidate: evaluation.candidateCodeRevision,
          harness: evaluation.harnessRevision,
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
const RANK_REASON_CODES = new Set([
  "rank_1",
  "ranked_below_1",
  "candidate_missing",
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
  stale_index_marked: boolean;
};

export type PhaseComparisonSummary = {
  rows: number;
  /** Runs that passed both the retrieval and production-path integrity scorers. */
  top1: number;
  /** Retrieval rank counts remain visible even when another path check failed. */
  retrievalTop1: number;
  hitAt5: number;
  failedRuns: number;
  abortedRuns: number;
  staleIndexMarked: number;
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
  const hasStaleIndexMarker = lines[0] === CSV_COLUMNS.join(",");
  if (!hasStaleIndexMarker && lines[0] !== LEGACY_CSV_COLUMNS.join(",")) {
    throw new Error(
      "Comparison CSV header does not match the privacy-safe schema.",
    );
  }
  if (lines.some((line) => line.includes('"'))) {
    throw new Error("Comparison CSV contains an unexpected quoted field.");
  }

  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const columns = hasStaleIndexMarker ? CSV_COLUMNS : LEGACY_CSV_COLUMNS;
    if (values.length !== columns.length) {
      throw new Error("Comparison CSV row has an unexpected field count.");
    }
    const row = Object.fromEntries(
      columns.map((column, index) => [column, values[index] ?? ""]),
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
      stale_index_marked: hasStaleIndexMarker
        ? parseBoolean(row.stale_index_marked, "stale_index_marked")
        : false,
    };
    if (
      parsed.failed_action_calls >
      parsed.find_data_calls + parsed.other_action_calls
    ) {
      throw new Error(
        "Comparison CSV failed action calls exceed recorded action calls.",
      );
    }
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
    top1: phaseRows.filter((row) => row.score === 1).length,
    retrievalTop1: phaseRows.filter((row) => row.expected_rank === 1).length,
    hitAt5: phaseRows.filter((row) => row.hit_at_5).length,
    failedRuns: phaseRows.filter((row) => row.score === 0).length,
    abortedRuns: phaseRows.filter((row) => row.aborted).length,
    staleIndexMarked: phaseRows.filter((row) => row.stale_index_marked).length,
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
  const hasStaleIndexMarker =
    csv.trim().split(/\r?\n/, 1)[0] === CSV_COLUMNS.join(",");
  if (Boolean(pinnedEvaluation.staleIndexMarker) !== hasStaleIndexMarker) {
    throw new Error(
      "Comparison CSV schema does not match its fixture revision.",
    );
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
    const expectedHitAt5 = row.expected_rank !== null && row.expected_rank <= 5;
    if (row.hit_at_5 !== expectedHitAt5) {
      throw new Error(
        "Comparison CSV hit_at_5 does not match its measured rank.",
      );
    }
    if (
      row.stale_index_marked &&
      (!pinnedEvaluation.staleIndexMarker ||
        row.phase !== "after" ||
        row.case_id !== "stale-generated-index-yields-to-current-source")
    ) {
      throw new Error(
        "Comparison CSV stale-index markers must match the pinned candidate case.",
      );
    }
    if (
      row.aborted &&
      (row.score !== 0 || row.reason_code !== "production_path_failed")
    ) {
      throw new Error(
        "Comparison CSV aborts must count as production-path failures.",
      );
    }
    if (row.completed && row.aborted) {
      throw new Error(
        "Comparison CSV runs cannot be completed and aborted at once.",
      );
    }
    if (
      !RANK_REASON_CODES.has(row.reason_code) &&
      (row.score !== 0 || row.expected_rank !== null || row.hit_at_5)
    ) {
      throw new Error(
        "Comparison CSV failure reasons cannot report a retrieval rank or hit.",
      );
    }
    if (
      row.score === 1 &&
      (row.reason_code !== "rank_1" ||
        row.expected_rank !== 1 ||
        !row.completed ||
        row.aborted ||
        row.find_data_calls !== 1 ||
        row.other_action_calls !== 0 ||
        row.failed_action_calls !== 0 ||
        row.llm_calls === 0)
    ) {
      throw new Error(
        "Comparison CSV has an invalid successful production-path score.",
      );
    }
    if (
      ["rank_1", "ranked_below_1", "candidate_missing"].includes(
        row.reason_code,
      ) &&
      (!row.completed ||
        row.aborted ||
        row.find_data_calls !== 1 ||
        row.other_action_calls !== 0 ||
        row.failed_action_calls !== 0 ||
        row.llm_calls === 0)
    ) {
      throw new Error(
        "Comparison CSV retrieval ranks require a complete, valid production-path run.",
      );
    }
    if (row.score === 0 && row.reason_code === "rank_1") {
      throw new Error(
        "Comparison CSV rank_1 reason must have a passing score.",
      );
    }
    if (
      row.reason_code === "ranked_below_1" &&
      (row.expected_rank === null || row.expected_rank === 1)
    ) {
      throw new Error(
        "Comparison CSV ranked_below_1 reason has an invalid rank.",
      );
    }
    if (row.reason_code === "candidate_missing" && row.expected_rank !== null) {
      throw new Error(
        "Comparison CSV candidate_missing reason has a measured rank.",
      );
    }
    if (
      row.reason_code === "find_data_missing" &&
      (!row.completed || row.aborted || row.find_data_calls !== 0)
    ) {
      throw new Error(
        "Comparison CSV find_data_missing reason does not match its action fields.",
      );
    }
    if (
      row.reason_code === "unexpected_action" &&
      (!row.completed ||
        row.aborted ||
        row.find_data_calls === 0 ||
        row.other_action_calls === 0)
    ) {
      throw new Error(
        "Comparison CSV unexpected_action reason does not match its action fields.",
      );
    }
    if (
      row.reason_code === "action_failed" &&
      (!row.completed ||
        row.aborted ||
        row.find_data_calls === 0 ||
        row.other_action_calls !== 0 ||
        row.failed_action_calls === 0)
    ) {
      throw new Error(
        "Comparison CSV action_failed reason does not match its action fields.",
      );
    }
    if (
      row.reason_code === "usage_missing" &&
      (!row.completed ||
        row.aborted ||
        row.find_data_calls === 0 ||
        row.other_action_calls !== 0 ||
        row.failed_action_calls !== 0)
    ) {
      throw new Error(
        "Comparison CSV usage_missing reason does not match its path fields.",
      );
    }
    if (
      row.reason_code === "guard_not_applied" &&
      (!row.completed ||
        row.aborted ||
        row.find_data_calls === 0 ||
        row.other_action_calls !== 0 ||
        row.failed_action_calls !== 0 ||
        row.llm_calls === 0)
    ) {
      throw new Error(
        "Comparison CSV guard_not_applied reason does not match its path fields.",
      );
    }
    if (!row.completed && row.reason_code !== "production_path_failed") {
      throw new Error(
        "Comparison CSV incomplete runs must count as production-path failures.",
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

  if (pinnedEvaluation.staleIndexMarker) {
    const staleCaseRows = rows.filter(
      (row) => row.case_id === "stale-generated-index-yields-to-current-source",
    );
    if (
      staleCaseRows
        .filter((row) => row.phase === "before")
        .some((row) => row.stale_index_marked) ||
      staleCaseRows.filter((row) => row.phase === "after").length !== 2 ||
      staleCaseRows
        .filter((row) => row.phase === "after")
        .some((row) => !row.stale_index_marked)
    ) {
      throw new Error(
        "Comparison CSV must record stale-index marking only for both candidate runs.",
      );
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
  return { before, after, cases: pinnedEvaluation.caseIds.length };
}
