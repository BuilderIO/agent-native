import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { rankAnalyticsQueryCatalog } from "../../server/lib/analytics-query-catalog";

export const BENCHMARK_TITLE = "SYNTHETIC: Analytics retrieval benchmark";
export const BASELINE_REVISION = "70bf54c17404fa0993b248154bf95ef70d216a3f";
export const CSV_PATH = fileURLToPath(
  new URL("./SYNTHETIC-analytics-retrieval.csv", import.meta.url),
);

type SyntheticDictionaryEntry = Record<string, unknown> & {
  id: string;
  metric: string;
};

type SyntheticDashboard = {
  id: string;
  title: string;
  description: string;
  origin: "dashboard-template";
  config: Record<string, unknown>;
};

type SyntheticCase = {
  id: string;
  query: string;
  expectedCandidateId: string;
  note: string;
  dictionaryEntries: SyntheticDictionaryEntry[];
  dashboards: SyntheticDashboard[];
};

export type SyntheticBenchmarkRow = {
  dataClass: "SYNTHETIC";
  benchmarkTitle: string;
  caseId: string;
  query: string;
  expectedCandidateId: string;
  baselineRevision: string;
  baselineTopCandidateId: string;
  baselineCandidateIds: string;
  baselineExpectedRank: string;
  baselineHitAt5: string;
  afterTopCandidateId: string;
  afterExpectedRank: string;
  afterHitAt5: string;
  afterCandidateIds: string;
  note: string;
};

const CASES: SyntheticCase[] = [
  {
    id: "dictionary-alias-mrr",
    query: "MRR",
    expectedCandidateId: "dictionary:synthetic-monthly-recurring-revenue",
    note: "The query is an alias expanded by the shared matcher; the phrase MRR is absent from dictionary text.",
    dictionaryEntries: [
      {
        id: "synthetic-monthly-recurring-revenue",
        metric: "Monthly Recurring Revenue",
        definition: "Synthetic subscription value normalized to a month.",
        source: "synthetic",
        table: "synthetic_subscription_summary",
        approved: true,
      },
    ],
    dashboards: [],
  },
  {
    id: "panel-sql-only-term",
    query: "checkout latency",
    expectedCandidateId: "dashboard:synthetic-runtime-overview:slow-path",
    note: "The query terms occur only in a panel SQL fragment, not dictionary text or dashboard summary fields.",
    dictionaryEntries: [],
    dashboards: [
      {
        id: "synthetic-runtime-overview",
        title: "Synthetic Runtime Overview",
        description: "A synthetic operations summary.",
        origin: "dashboard-template",
        config: {
          panels: [
            {
              id: "slow-path",
              title: "Slow Path",
              config: { description: "Response timing by cohort." },
              sql: "SELECT checkout_latency_ms FROM synthetic_events WHERE event_name = 'checkout'",
            },
          ],
        },
      },
    ],
  },
  {
    id: "semantic-scope-membership",
    query: "workspace members",
    expectedCandidateId: "dictionary:synthetic-workspace-membership",
    note: "Both entries contain the phrase; the current ranker selects the membership scope over product activity.",
    dictionaryEntries: [
      {
        id: "synthetic-workspace-activity",
        metric: "Workspace Members Activity Events",
        definition: "Synthetic activity events grouped by workspace member.",
        source: "synthetic",
        table: "synthetic_activity_events",
        semanticScope: "product_activity",
        approved: true,
      },
      {
        id: "synthetic-workspace-membership",
        metric: "Workspace Members Membership Records",
        definition: "Synthetic membership records grouped by workspace.",
        source: "synthetic",
        table: "synthetic_membership_records",
        semanticScope: "membership",
        approved: true,
      },
    ],
    dashboards: [],
  },
  {
    id: "approved-over-generated",
    query: "workflow completions",
    expectedCandidateId: "dictionary:synthetic-approved-workflow-completions",
    note: "The fixture lists an unapproved generated suggestion first; the approved definition should rank first.",
    dictionaryEntries: [
      {
        id: "synthetic-generated-workflow-completions",
        metric: "Workflow Completions",
        definition: "Generated estimate of synthetic workflow runs completed.",
        source: "synthetic",
        table: "synthetic_workflow_runs",
        sourceIndex: true,
        aiGenerated: true,
        approved: false,
      },
      {
        id: "synthetic-approved-workflow-completions",
        metric: "Workflow Completions",
        definition: "Canonical count of synthetic workflow runs completed.",
        source: "synthetic",
        table: "synthetic_workflow_runs",
        approved: true,
      },
    ],
    dashboards: [],
  },
];

// Re-measured from the exact origin/main implementation at BASELINE_REVISION.
const MEASURED_ORIGIN_MAIN_RANKINGS: Record<string, string[]> = {
  "dictionary-alias-mrr": ["dictionary:synthetic-monthly-recurring-revenue"],
  "panel-sql-only-term": ["dashboard:synthetic-runtime-overview:slow-path"],
  "semantic-scope-membership": [
    "dictionary:synthetic-workspace-activity",
    "dictionary:synthetic-workspace-membership",
  ],
  "approved-over-generated": [
    "dictionary:synthetic-approved-workflow-completions",
  ],
};

function baselineCandidateIds(testCase: SyntheticCase): string[] {
  const candidates = MEASURED_ORIGIN_MAIN_RANKINGS[testCase.id];
  if (!candidates) {
    throw new Error(
      `Missing baseline ranking for synthetic case ${testCase.id}.`,
    );
  }
  return candidates;
}

function afterCandidateId(
  candidate: ReturnType<typeof rankAnalyticsQueryCatalog>[number],
): string {
  if (candidate.kind === "data-dictionary") {
    return `dictionary:${candidate.id}`;
  }
  return `dashboard:${candidate.dashboardId}:${candidate.panelId}`;
}

function rankOf(candidateIds: string[], expectedId: string): string {
  const index = candidateIds.indexOf(expectedId);
  return index < 0 ? "" : String(index + 1);
}

export function computeSyntheticBenchmark(): SyntheticBenchmarkRow[] {
  return CASES.map((testCase) => {
    const baselineIds = baselineCandidateIds(testCase);
    const afterIds = rankAnalyticsQueryCatalog({
      search: testCase.query,
      dashboards: testCase.dashboards,
      dictionaryEntries: testCase.dictionaryEntries,
      limit: 5,
    }).map(afterCandidateId);
    const baselineRank = rankOf(baselineIds, testCase.expectedCandidateId);
    const afterRank = rankOf(afterIds, testCase.expectedCandidateId);

    return {
      dataClass: "SYNTHETIC",
      benchmarkTitle: BENCHMARK_TITLE,
      caseId: testCase.id,
      query: testCase.query,
      expectedCandidateId: testCase.expectedCandidateId,
      baselineRevision: BASELINE_REVISION,
      baselineTopCandidateId: baselineIds[0] ?? "",
      baselineCandidateIds: baselineIds.join(";"),
      baselineExpectedRank: baselineRank,
      baselineHitAt5:
        baselineRank && Number(baselineRank) <= 5 ? "true" : "false",
      afterTopCandidateId: afterIds[0] ?? "",
      afterExpectedRank: afterRank,
      afterHitAt5: afterRank && Number(afterRank) <= 5 ? "true" : "false",
      afterCandidateIds: afterIds.join(";"),
      note: testCase.note,
    };
  });
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function renderSyntheticBenchmarkCsv(
  rows = computeSyntheticBenchmark(),
): string {
  const columns: Array<keyof SyntheticBenchmarkRow> = [
    "dataClass",
    "benchmarkTitle",
    "caseId",
    "query",
    "expectedCandidateId",
    "baselineRevision",
    "baselineTopCandidateId",
    "baselineCandidateIds",
    "baselineExpectedRank",
    "baselineHitAt5",
    "afterTopCandidateId",
    "afterExpectedRank",
    "afterHitAt5",
    "afterCandidateIds",
    "note",
  ];
  const header = [
    "SYNTHETIC_data_class",
    "benchmark_title",
    "case_id",
    "query",
    "expected_candidate_id",
    "baseline_revision",
    "baseline_top_candidate_id",
    "baseline_candidate_ids",
    "baseline_expected_rank",
    "baseline_hit_at_5",
    "after_top_candidate_id",
    "after_expected_rank",
    "after_hit_at_5",
    "after_candidate_ids",
    "notes",
  ];
  return [
    header.join(","),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column])).join(","),
    ),
  ].join("\n");
}

export function summarizeSyntheticBenchmark(rows: SyntheticBenchmarkRow[]) {
  const reciprocalRank = (rank: string) => (rank ? 1 / Number(rank) : 0);
  const count = rows.length;
  const meanReciprocalRank = (
    key: "baselineExpectedRank" | "afterExpectedRank",
  ) =>
    count
      ? rows.reduce((total, row) => total + reciprocalRank(row[key]), 0) / count
      : 0;
  const hitAt5 = (key: "baselineHitAt5" | "afterHitAt5") =>
    rows.filter((row) => row[key] === "true").length;
  const top1 = (key: "baselineExpectedRank" | "afterExpectedRank") =>
    rows.filter((row) => row[key] === "1").length;

  return {
    cases: count,
    baselineTop1: `${top1("baselineExpectedRank")}/${count}`,
    baselineHitAt5: `${hitAt5("baselineHitAt5")}/${count}`,
    baselineMrr: meanReciprocalRank("baselineExpectedRank"),
    afterTop1: `${top1("afterExpectedRank")}/${count}`,
    afterHitAt5: `${hitAt5("afterHitAt5")}/${count}`,
    afterMrr: meanReciprocalRank("afterExpectedRank"),
  };
}

async function main() {
  const rows = computeSyntheticBenchmark();
  const csv = renderSyntheticBenchmarkCsv(rows);
  const mode = process.argv[2];

  if (mode === "--write") {
    await writeFile(CSV_PATH, `${csv}\n`);
  } else if (mode === "--check") {
    const checkedIn = await readFile(CSV_PATH, "utf8");
    if (checkedIn !== `${csv}\n`) {
      throw new Error(
        "The synthetic retrieval CSV is stale. Run this command with --write.",
      );
    }
  } else {
    throw new Error("Usage: benchmark.ts --write | --check");
  }

  const summary = summarizeSyntheticBenchmark(rows);
  console.log(`${BENCHMARK_TITLE} (${summary.cases} cases)`);
  console.log(
    `Baseline: top-1 ${summary.baselineTop1}, hit@5 ${summary.baselineHitAt5}, MRR ${summary.baselineMrr.toFixed(2)}`,
  );
  console.log(
    `After: top-1 ${summary.afterTop1}, hit@5 ${summary.afterHitAt5}, MRR ${summary.afterMrr.toFixed(2)}`,
  );
  console.log(
    mode === "--write" ? `Wrote ${CSV_PATH}` : "CSV matches computed outputs.",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
