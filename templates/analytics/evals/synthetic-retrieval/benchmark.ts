import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { rankAnalyticsQueryCatalog } from "../../server/lib/analytics-query-catalog";

export const BENCHMARK_TITLE = "SYNTHETIC: Analytics retrieval benchmark";
export const BASELINE_REVISION = "75e39e8547b408aa09605e54872d9a8ef6522df9";
export const FIXTURE_REVISION = "synthetic-retrieval-fixtures-v6";
export const CSV_PATH = fileURLToPath(
  new URL("./SYNTHETIC-analytics-retrieval-v6.csv", import.meta.url),
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
  fixtureRevision: string;
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

export const SYNTHETIC_CASES: SyntheticCase[] = [
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
  {
    id: "organization-product-users-vs-membership-grain",
    query: "organization sample product users",
    expectedCandidateId: "dictionary:synthetic-membership-distribution",
    note: "The user directory shares product-user terms but lacks organization grain; row-level membership evidence should win.",
    dictionaryEntries: [
      {
        id: "synthetic-membership-distribution",
        metric: "Sample Organization Membership",
        definition:
          "Synthetic organization membership records, one row per user and organization.",
        table: "synthetic_user_organization_memberships",
        columnsUsed: "user_id, organization_id, role_code",
        grain: "One row per user_id per organization_id",
        semanticScope: "membership",
        sourceKind: "code",
        sourceIndex: true,
        aiGenerated: true,
        approved: false,
      },
      {
        id: "synthetic-product-user-directory",
        metric: "Sample Product User Directory",
        definition:
          "Approved synthetic identity directory, one row per user, not keyed by organization.",
        table: "synthetic_product_user_directory",
        columnsUsed: "user_id, name, created_at",
        grain: "One row per user_id",
        semanticScope: "product_user",
        approved: true,
      },
    ],
    dashboards: [],
  },
  {
    id: "organization-roster-roles-vs-monthly-count",
    query: "current organization user roster with assigned roles",
    expectedCandidateId: "dictionary:synthetic-user-organization-role-bridge",
    note: "A current role-aware roster needs user-organization membership rows; the approved monthly aggregate is not a roster.",
    dictionaryEntries: [
      {
        id: "synthetic-monthly-user-count",
        metric: "Workspace Monthly Member Count",
        definition:
          "Refreshed daily. Completed periods use their final day; the current period is partial through today. The standard count excludes users from a synthetic sandbox domain; a separate sandbox count is not a staff roster. A workspace key may refer to a nested workspace.",
        table: "synthetic_workspace_member_period_counts",
        columnsUsed:
          "period_month, workspace_key, member_count, sandbox_member_count",
        grain: "One row per period_month per workspace_key",
        semanticScope: "membership",
        sourceKind: "dbt",
        sourceIndex: true,
        approved: true,
      },
      {
        id: "synthetic-user-organization-role-bridge",
        metric: "Workspace Member Roles",
        definition:
          "One row per synthetic user-workspace membership, including the assigned role.",
        table: "synthetic_workspace_member_roles",
        columnsUsed: "user_id, workspace_id, role_code",
        grain: "One row per user_id per workspace_id",
        semanticScope: "membership",
        sourceKind: "dbt",
        sourceIndex: true,
        aiGenerated: true,
        approved: false,
      },
    ],
    dashboards: [],
  },
  {
    id: "organization-user-activity-vs-membership",
    query: "which users in organizations triggered events",
    expectedCandidateId: "dictionary:synthetic-organization-user-events",
    note: "An event question about users and organizations should retrieve product activity instead of membership metadata.",
    dictionaryEntries: [
      {
        id: "synthetic-organization-user-membership",
        metric: "Organization User Role Membership",
        definition:
          "One row per synthetic user-workspace membership, including the assigned role.",
        table: "synthetic_workspace_member_roles",
        columnsUsed: "user_id, workspace_id, role_code",
        grain: "One row per user_id per workspace_id",
        semanticScope: "membership",
        sourceKind: "dbt",
        sourceIndex: true,
        aiGenerated: true,
        approved: true,
      },
      {
        id: "synthetic-organization-user-events",
        metric: "Organization User Product Activity Events",
        definition: "User events triggered inside organizations.",
        table: "synthetic_organization_user_events",
        semanticScope: "product_activity",
        sourceIndex: true,
        aiGenerated: true,
        approved: false,
      },
    ],
    dashboards: [],
  },
  {
    id: "aggregate-wording-keeps-monthly-count",
    query: "which organization had the highest monthly user count",
    expectedCandidateId: "dictionary:synthetic-monthly-user-count",
    note: "Aggregate wording must keep the approved monthly count available even when the question uses 'which'.",
    dictionaryEntries: [
      {
        id: "synthetic-monthly-user-count",
        metric: "Workspace Monthly Member Count",
        definition:
          "Refreshed daily. Completed periods use their final day; the current period is partial through today. The standard count excludes users from a synthetic sandbox domain; a separate sandbox count is not a staff roster. A workspace key may refer to a nested workspace.",
        table: "synthetic_workspace_member_period_counts",
        columnsUsed:
          "period_month, workspace_key, member_count, sandbox_member_count",
        grain: "One row per period_month per workspace_key",
        semanticScope: "membership",
        sourceKind: "dbt",
        sourceIndex: true,
        approved: true,
      },
      {
        id: "synthetic-user-organization-role-bridge",
        metric: "Workspace Member Roles",
        definition:
          "One row per synthetic user-workspace membership, including the assigned role.",
        table: "synthetic_workspace_member_roles",
        columnsUsed: "user_id, workspace_id, role_code",
        grain: "One row per user_id per workspace_id",
        semanticScope: "membership",
        sourceKind: "dbt",
        sourceIndex: true,
        aiGenerated: true,
        approved: false,
      },
    ],
    dashboards: [],
  },
  {
    id: "active-member-roster-vs-product-events",
    query: "list active workspace members with assigned roles",
    expectedCandidateId: "dictionary:synthetic-active-workspace-member-roles",
    note: "An explicitly active member roster can use an active-only membership source; an event source must not substitute for membership rows.",
    dictionaryEntries: [
      {
        id: "synthetic-active-workspace-member-roles",
        metric: "Active Workspace Member Roles",
        definition:
          "Current active members associated with each workspace, including their assigned role.",
        source: "synthetic",
        table: "synthetic_active_workspace_member_roles",
        columnsUsed: "user_id, workspace_id, role_code",
        grain: "One row per user_id per workspace_id",
        semanticScope: "membership",
        sourceIndex: true,
        aiGenerated: true,
        approved: false,
      },
      {
        id: "synthetic-active-member-events",
        metric: "Active Workspace Member Activity Events",
        definition:
          "Usage events for active workspace members with role context.",
        source: "synthetic",
        table: "synthetic_workspace_member_events",
        columnsUsed: "user_id, workspace_id, role_code, event_name, event_time",
        grain: "One row per event_key",
        semanticScope: "product_activity",
        sourceIndex: true,
        aiGenerated: true,
        approved: false,
      },
    ],
    dashboards: [],
  },
  {
    id: "bare-active-members-vs-product-events",
    query: "active members",
    expectedCandidateId: "dictionary:synthetic-active-organization-members",
    note: "A bare active-member lookup is membership intent; product activity must not become its default scope.",
    dictionaryEntries: [
      {
        id: "synthetic-active-organization-members",
        metric: "Active Organization Members",
        definition:
          "Current active synthetic organization memberships, one row per user and organization.",
        source: "synthetic",
        table: "synthetic_active_organization_memberships",
        columnsUsed: "user_id, organization_id, role_code",
        grain: "One row per user_id per organization_id",
        semanticScope: "membership",
        sourceIndex: true,
        aiGenerated: true,
        approved: false,
      },
      {
        id: "synthetic-active-member-events",
        metric: "Active Member Events",
        definition:
          "Product activity events associated with active synthetic members.",
        source: "synthetic",
        table: "synthetic_active_member_events",
        columnsUsed: "user_id, event_name, event_time",
        grain: "One row per event_id",
        semanticScope: "product_activity",
        sourceIndex: true,
        aiGenerated: true,
        approved: false,
      },
    ],
    dashboards: [],
  },
  {
    id: "negated-count-instruction-keeps-membership-rows",
    query: "workspace users, no live counts",
    expectedCandidateId: "dictionary:synthetic-user-organization-role-bridge",
    note: "A non-positive count phrase should not turn a row-level membership lookup into a count request.",
    dictionaryEntries: [
      {
        id: "synthetic-monthly-user-count",
        metric: "Workspace Monthly Member Count",
        definition: "Monthly rollup of membership counts by workspace.",
        source: "synthetic",
        table: "synthetic_workspace_member_period_counts",
        columnsUsed: "period_month, workspace_id, member_count",
        grain: "One row per period_month per workspace_id",
        semanticScope: "membership",
        approved: true,
      },
      {
        id: "synthetic-user-organization-role-bridge",
        metric: "Workspace Member Roles",
        definition:
          "One row per user-workspace membership, including the assigned role.",
        source: "synthetic",
        table: "synthetic_workspace_member_roles",
        columnsUsed: "user_id, workspace_id, role_code",
        grain: "One row per user_id per workspace_id",
        semanticScope: "membership",
        sourceKind: "dbt",
        sourceIndex: true,
        aiGenerated: true,
        approved: false,
      },
    ],
    dashboards: [],
  },
  {
    id: "metadata-only-roster-keeps-membership-grain",
    query:
      "workspace users. Metadata only; do not report live counts or values.",
    expectedCandidateId: "dictionary:synthetic-user-organization-role-bridge",
    note: "The Analytics search action appends this metadata-only instruction; it must not turn a row lookup into an aggregate request.",
    dictionaryEntries: [
      {
        id: "synthetic-monthly-user-count",
        metric: "Workspace Monthly Member Count",
        definition: "Monthly rollup of membership counts by workspace.",
        source: "synthetic",
        table: "synthetic_workspace_member_period_counts",
        columnsUsed: "period_month, workspace_id, member_count",
        grain: "One row per period_month per workspace_id",
        semanticScope: "membership",
        approved: true,
      },
      {
        id: "synthetic-user-organization-role-bridge",
        metric: "Workspace Member Roles",
        definition:
          "One row per user-workspace membership, including the assigned role.",
        source: "synthetic",
        table: "synthetic_workspace_member_roles",
        columnsUsed: "user_id, workspace_id, role_code",
        grain: "One row per user_id per workspace_id",
        semanticScope: "membership",
        sourceKind: "dbt",
        sourceIndex: true,
        aiGenerated: true,
        approved: false,
      },
    ],
    dashboards: [],
  },
];

// Measured against the exact origin/main implementation at BASELINE_REVISION.
// Baseline order was measured by measure-baseline.ts against BASELINE_REVISION.
const MEASURED_ORIGIN_MAIN_RANKINGS: Record<string, string[]> = {
  "dictionary-alias-mrr": ["dictionary:synthetic-monthly-recurring-revenue"],
  "panel-sql-only-term": ["dashboard:synthetic-runtime-overview:slow-path"],
  "semantic-scope-membership": ["dictionary:synthetic-workspace-membership"],
  "approved-over-generated": [
    "dictionary:synthetic-approved-workflow-completions",
    "dictionary:synthetic-generated-workflow-completions",
  ],
  "organization-product-users-vs-membership-grain": [
    "dictionary:synthetic-product-user-directory",
    "dictionary:synthetic-membership-distribution",
  ],
  "bare-active-members-vs-product-events": [
    "dictionary:synthetic-active-member-events",
  ],
  "organization-roster-roles-vs-monthly-count": [
    "dictionary:synthetic-monthly-user-count",
    "dictionary:synthetic-user-organization-role-bridge",
  ],
  "organization-user-activity-vs-membership": [
    "dictionary:synthetic-organization-user-membership",
    "dictionary:synthetic-organization-user-events",
  ],
  "aggregate-wording-keeps-monthly-count": [
    "dictionary:synthetic-monthly-user-count",
    "dictionary:synthetic-user-organization-role-bridge",
  ],
  "active-member-roster-vs-product-events": [
    "dictionary:synthetic-active-member-events",
  ],
  "negated-count-instruction-keeps-membership-rows": [
    "dictionary:synthetic-monthly-user-count",
    "dictionary:synthetic-user-organization-role-bridge",
  ],
  "metadata-only-roster-keeps-membership-grain": [
    "dictionary:synthetic-monthly-user-count",
    "dictionary:synthetic-user-organization-role-bridge",
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
  return SYNTHETIC_CASES.map((testCase) => {
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
      fixtureRevision: FIXTURE_REVISION,
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
    "fixtureRevision",
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
    "fixture_revision",
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
