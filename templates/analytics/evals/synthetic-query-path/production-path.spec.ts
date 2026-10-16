import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AgentEngine,
  EngineEvent,
  EngineStreamOptions,
} from "@agent-native/core/agent/engine";
import {
  createAgentRunner,
  runEvals,
  type AgentRunOutput,
  type Eval,
  type EvalProductionIdentity,
  type EvalProductionPathReceipt,
  type Scorer,
} from "@agent-native/core/eval";
import { generateActionRegistryForProject } from "@agent-native/core/vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FirstPartyAnalyticsValidationError } from "../../server/lib/first-party-analytics-errors.js";

const providerBoundary = vi.hoisted(() => ({
  activeCaseKey: "",
  metricMetadataPageNumbers: [] as number[],
  bigquerySql: [] as string[],
  queryFirstPartyAnalytics: vi.fn(),
  searchAnalyticsQueryCatalog: vi.fn(),
  runQuery: vi.fn(),
  getBigQueryProjectId: vi.fn(),
  bigQueryGet: vi.fn(),
  listBigQueryTablesPage: vi.fn(),
  getBigQueryTableMetadata: vi.fn(),
  recoverFromSchemaMiss: vi.fn(),
  listWorkspaceConnectionsForApp: vi.fn(),
  resolveWorkspaceConnectionCredentialForApp: vi.fn(),
  executeProviderApiRequest: vi.fn(),
}));

vi.mock("../../server/lib/analytics-agent-context.js", () => ({
  retrieveAnalyticsPromptReferences: vi.fn(async () => ({
    jevPromptCandidates: [],
    jevFallbackCandidateIds: [],
    prefetchStatus: "empty",
  })),
  summarizeAnalyticsRun: vi.fn(async () => undefined),
}));

vi.mock(
  "../../server/lib/analytics-query-catalog.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../server/lib/analytics-query-catalog.js")
    >()),
    searchAnalyticsQueryCatalog: providerBoundary.searchAnalyticsQueryCatalog,
  }),
);

vi.mock("../../server/lib/bigquery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/lib/bigquery")>()),
  getBigQueryProjectId: providerBoundary.getBigQueryProjectId,
  bigQueryGet: providerBoundary.bigQueryGet,
  listBigQueryTablesPage: providerBoundary.listBigQueryTablesPage,
  getBigQueryTableMetadata: providerBoundary.getBigQueryTableMetadata,
  runQuery: providerBoundary.runQuery,
}));

vi.mock(
  "../../server/lib/first-party-analytics.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../server/lib/first-party-analytics.js")
    >()),
    queryFirstPartyAnalytics: providerBoundary.queryFirstPartyAnalytics,
  }),
);

vi.mock(
  "../../server/lib/bigquery-schema-recovery",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../server/lib/bigquery-schema-recovery")
    >()),
    recoverFromSchemaMiss: providerBoundary.recoverFromSchemaMiss,
  }),
);

vi.mock("../../server/lib/provider-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/lib/provider-api")>()),
  executeProviderApiRequest: providerBoundary.executeProviderApiRequest,
}));

vi.mock("../../server/lib/provider-credentials", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../server/lib/provider-credentials")
  >()),
  ANALYTICS_APP_ID: "analytics",
}));

vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/workspace-connections")
  >()),
  listWorkspaceConnectionsForApp:
    providerBoundary.listWorkspaceConnectionsForApp,
  resolveWorkspaceConnectionCredentialForApp:
    providerBoundary.resolveWorkspaceConnectionCredentialForApp,
}));

vi.mock("@agent-native/core/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/tracking")>()),
  track: vi.fn(),
}));

const ANALYTICS_PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const IDENTITY: EvalProductionIdentity = {
  ownerEmail: "synthetic-query-eval@example.invalid",
  orgId: "org_synthetic_query_eval",
};
const SYNTHETIC_SETUP_LINK =
  "https://example.invalid/analytics/data-sources?provider=dbt";
const rollingWindowEnd = new Date(
  Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  ),
);
const rollingWindowTargetMonth = new Date(
  Date.UTC(
    rollingWindowEnd.getUTCFullYear(),
    rollingWindowEnd.getUTCMonth() - 3,
    1,
  ),
);
const rollingWindowLastDay = new Date(
  Date.UTC(
    rollingWindowTargetMonth.getUTCFullYear(),
    rollingWindowTargetMonth.getUTCMonth() + 1,
    0,
  ),
).getUTCDate();
const rollingWindowStart = new Date(
  Date.UTC(
    rollingWindowTargetMonth.getUTCFullYear(),
    rollingWindowTargetMonth.getUTCMonth(),
    Math.min(rollingWindowEnd.getUTCDate(), rollingWindowLastDay),
  ),
);
const rollingThreeMonthRange = {
  startDate: rollingWindowStart.toISOString().slice(0, 10),
  endDate: rollingWindowEnd.toISOString().slice(0, 10),
};
const latestCompleteMonthEnd = new Date(
  Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 0),
);
const latestCompleteMonthsStart = new Date(
  Date.UTC(
    latestCompleteMonthEnd.getUTCFullYear(),
    latestCompleteMonthEnd.getUTCMonth() - 2,
    1,
  ),
);
const threeCompleteCalendarMonthsRange = {
  startDate: latestCompleteMonthsStart.toISOString().slice(0, 10),
  endDate: latestCompleteMonthEnd.toISOString().slice(0, 10),
};
let evalHarnessSha256 = "";

type Step = { name: string; input: Record<string, unknown> };
type Case = {
  key: string;
  prompt: string;
  actionAllowlist: readonly string[];
  steps: readonly Step[];
  finalText: string;
  check: (capture: Capture) => boolean;
};
type Capture = {
  output?: AgentRunOutput;
  receipt?: EvalProductionPathReceipt;
  failureReason?: "aborted" | "production_path_failed";
  actionCalls: Step[];
  actionResults: unknown[];
  metricMetadataPages: number[];
};
type SafeCsvRow = {
  phase: "baseline" | "candidate";
  source_revision: string;
  harness_sha256: string;
  case_key: string;
  replicate: number;
  score: number;
  reason_code: string;
  completed: boolean;
  aborted: boolean;
  production_path_invoked: boolean;
  guard_applied: boolean;
  usage_captured: boolean;
  tool_call_count: number;
  provider_call_count: number;
  dbt_call_count: number;
  bigquery_call_count: number;
  schema_search_call_count: number;
  provenance_distinguished: boolean;
  event_taxonomy_grounded: boolean;
  bounded_grouping_verified: boolean;
  first_party_div_recovery_verified: boolean;
  organization_grain_verified: boolean;
  partial_warning_disclosed: boolean;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  llm_calls: number;
};

const cases: readonly Case[] = [
  {
    key: "synthetic-unbuilt-index-does-not-claim-absence",
    prompt:
      "SYNTHETIC: Find the canonical source for synthetic storefront product categories. If Analytics has no generated source index, explain what you checked and do not claim the source does not exist.",
    actionAllowlist: ["find-data", "tool-search"],
    steps: [
      {
        name: "find-data",
        input: {
          question: "synthetic storefront product categories",
          limit: 8,
        },
      },
    ],
    finalText:
      "The generated source index is not configured, and the dictionary search returned no matching category source. I did not inspect a live warehouse schema or dbt manifest, so I cannot conclude that the source does not exist. Build the source index or connect an authoritative source before I identify a canonical category field.",
    check: ({ output, actionResults }) => {
      const result = actionResults[0] as
        | {
            results?: unknown[];
            sourceIndexStatus?: string;
            guidance?: string;
          }
        | undefined;
      const text = output?.text.toLowerCase() ?? "";
      return (
        output?.toolCalls.filter((name) => name === "find-data").length === 1 &&
        result?.results?.length === 0 &&
        result.sourceIndexStatus === "not-configured" &&
        result.guidance?.includes(
          "absence from these references is not evidence",
        ) === true &&
        text.includes("cannot conclude") &&
        !output?.toolCalls.some((name) =>
          ["bigquery", "query-dbt-semantic-metric"].includes(name),
        )
      );
    },
  },
  {
    key: "synthetic-content-api-requests-not-visual-views",
    prompt:
      "SYNTHETIC: How many synthetic Content API requests happened in September? Visual Views is a different measure; do not substitute its number.",
    actionAllowlist: [
      "find-data",
      "search-bigquery-schema",
      "bigquery",
      "tool-search",
    ],
    steps: [
      { name: "tool-search", input: { names: ["find-data"] } },
      {
        name: "find-data",
        input: {
          question: "synthetic Content API requests in September",
          limit: 8,
        },
      },
      {
        name: "tool-search",
        input: { names: ["search-bigquery-schema"] },
      },
      {
        name: "search-bigquery-schema",
        input: { search: "synthetic API request logs", includeColumns: true },
      },
      {
        name: "bigquery",
        input: {
          sql: "SELECT SUM(total_requests) AS content_api_requests FROM synthetic_warehouse.synthetic_api_request_logs WHERE api_family = 'content_api' AND request_date >= '2026-09-01' AND request_date <= '2026-09-30'",
        },
      },
    ],
    finalText:
      "The synthetic warehouse returned 42 Content API requests for September 2026. The Visual Views reference measures page views, so it is not an API-request count. I verified the request-log schema and filtered to the synthetic content_api family. This is a synthetic fixture, not a live Builder.io measurement.",
    check: ({ output, actionCalls, actionResults }) => {
      const catalog = actionResults.find(
        (_result, index) => actionCalls[index]?.name === "find-data",
      ) as
        | {
            results?: Array<{ metric?: string; definition?: string }>;
            guidance?: string;
          }
        | undefined;
      const schema = actionResults.find(
        (_result, index) =>
          actionCalls[index]?.name === "search-bigquery-schema",
      );
      const query = actionCalls.find((call) => call.name === "bigquery");
      const schemaText = JSON.stringify(schema);
      const sql = String(query?.input.sql ?? "").toLowerCase();
      const text = output?.text.toLowerCase() ?? "";
      return (
        catalog?.results?.length === 1 &&
        catalog.results[0]?.metric === "Synthetic Visual Views" &&
        catalog.results[0]?.definition?.includes("page views") === true &&
        catalog.guidance?.includes(
          "A related metric is a lead, not a substitute",
        ) === true &&
        schemaText.includes("synthetic_api_request_logs") &&
        schemaText.includes("api_family") &&
        schemaText.includes("total_requests") &&
        sql.includes("synthetic_warehouse.synthetic_api_request_logs") &&
        sql.includes("api_family = 'content_api'") &&
        sql.includes("sum(total_requests)") &&
        output?.toolCalls.includes("find-data") === true &&
        output.toolCalls.includes("search-bigquery-schema") === true &&
        output.toolCalls.includes("bigquery") === true &&
        text.includes("42 content api requests") &&
        text.includes("visual views") &&
        text.includes("not an api-request count") &&
        text.includes("synthetic fixture")
      );
    },
  },
  {
    key: "synthetic-source-provenance-ambiguity",
    prompt:
      "SYNTHETIC: Are synthetic weekly active product users the same population as synthetic workspace seats? Compare the definitions and their provenance. Do not give a count unless a live query proves it; ask which population I mean if needed.",
    actionAllowlist: ["find-data", "tool-search"],
    steps: [
      {
        name: "find-data",
        input: {
          question:
            "synthetic weekly active product users versus synthetic workspace seats",
          limit: 8,
        },
      },
    ],
    finalText:
      "These are different populations. The approved synthetic workspace-seat definition is a membership count at one row per synthetic user and workspace. The weekly active product-user entry is an unapproved source-index suggestion based on product event activity, so it is not a canonical seat definition. No live query ran, so I do not have a count. Which population do you mean: workspace membership or users active in product events?",
    check: ({ output }) => {
      const text = output?.text.toLowerCase() ?? "";
      return (
        text.includes("approved") &&
        text.includes("unapproved") &&
        text.includes("membership") &&
        text.includes("event activity") &&
        text.includes("which population") &&
        output?.toolCalls.filter((name) => name === "find-data").length === 1
      );
    },
  },
  {
    key: "synthetic-dbt-disconnected-abstains",
    prompt:
      "SYNTHETIC: Query synthetic_active_workspaces in the dbt Semantic Layer from 2026-09-01 to 2026-09-30. If the dbt workspace connection is unavailable, say so and do not estimate the value.",
    actionAllowlist: [
      "data-source-status",
      "query-dbt-semantic-metric",
      "tool-search",
    ],
    steps: [
      {
        name: "tool-search",
        input: { names: ["data-source-status"] },
      },
      { name: "data-source-status", input: { key: "dbt" } },
      {
        name: "tool-search",
        input: { names: ["query-dbt-semantic-metric"] },
      },
      {
        name: "query-dbt-semantic-metric",
        input: {
          metricName: "synthetic_active_workspaces",
          timeRange: { startDate: "2026-09-01", endDate: "2026-09-30" },
        },
      },
    ],
    finalText: `The dbt Semantic Layer connection is not connected, so I could not run synthetic_active_workspaces and have no value to report. I will not estimate it. [Connect dbt](${SYNTHETIC_SETUP_LINK})`,
    check: ({ output, actionResults }) => {
      const text = output?.text.toLowerCase() ?? "";
      const metricResult = actionResults.find(
        (result) =>
          result &&
          typeof result === "object" &&
          (result as { status?: unknown }).status === "connection_unavailable",
      );
      return (
        text.includes("connection_unavailable") &&
        text.includes("did not return a successful metric result") &&
        text.includes("reconnect") &&
        Boolean(metricResult) &&
        !/\b\d+\b/.test(output?.text ?? "") &&
        output?.toolCalls.includes("data-source-status") === true &&
        output?.toolCalls.includes("query-dbt-semantic-metric") === true &&
        output?.toolCallDetails?.every(
          (call) => !call.result?.includes('"status":"success"'),
        ) === true
      );
    },
  },
  {
    key: "synthetic-dbt-paginated-bounded-grouping",
    prompt:
      "SYNTHETIC: Query synthetic_weekly_active_product_users from 2026-09-01 to 2026-09-30, grouped by organization, with weekly buckets. Search all available metadata pages for this exact metric name.",
    actionAllowlist: ["query-dbt-semantic-metric", "tool-search"],
    steps: [
      {
        name: "tool-search",
        input: { names: ["query-dbt-semantic-metric"] },
      },
      {
        name: "query-dbt-semantic-metric",
        input: {
          metricName: "synthetic_weekly_active_product_users",
          groupBy: [
            { name: "metric_time", grain: "WEEK" },
            { name: "synthetic_organization_id" },
          ],
          timeRange: { startDate: "2026-09-01", endDate: "2026-09-30" },
        },
      },
    ],
    finalText:
      "The synthetic MetricFlow result for 2026-09-01 through 2026-09-30 is 18 active product users, grouped by organization and week. This is a synthetic provider fixture, not a live Builder.io measurement.",
    check: ({ output, actionCalls, actionResults, metricMetadataPages }) => {
      const queryCalls = actionCalls.filter(
        (call) => call.name === "query-dbt-semantic-metric",
      );
      const firstInput = queryCalls[0]?.input;
      const success = actionResults.find(
        (result) =>
          result &&
          typeof result === "object" &&
          (result as { status?: unknown }).status === "success",
      ) as
        | {
            querySpec?: {
              timeRange?: { startDate?: string; endDate?: string };
              groupBy?: Array<{ name?: string; grain?: string }>;
            };
          }
        | undefined;
      const resultGroupings = success?.querySpec?.groupBy ?? [];
      const text = output?.text.toLowerCase() ?? "";
      return (
        output?.toolCalls.filter((name) => name === "query-dbt-semantic-metric")
          .length === 1 &&
        firstInput?.metricName === "synthetic_weekly_active_product_users" &&
        JSON.stringify(metricMetadataPages) === JSON.stringify([1, 2]) &&
        JSON.stringify(success?.querySpec?.timeRange) ===
          JSON.stringify({ startDate: "2026-09-01", endDate: "2026-09-30" }) &&
        resultGroupings.some(
          (group) => group.name === "metric_time" && group.grain === "WEEK",
        ) &&
        resultGroupings.some(
          (group) => group.name === "synthetic_organization_id",
        ) &&
        text.includes("grouped by organization and week") &&
        text.includes("synthetic provider fixture")
      );
    },
  },
  {
    key: "synthetic-dbt-rolling-window-product-category",
    prompt:
      "SYNTHETIC: For the last 3 months, how many synthetic campaign-attributed users were there by product category? Use the exact requested period and category breakdown, and label the result as synthetic.",
    actionAllowlist: ["query-dbt-semantic-metric", "tool-search"],
    steps: [
      {
        name: "tool-search",
        input: { names: ["query-dbt-semantic-metric"] },
      },
      {
        name: "query-dbt-semantic-metric",
        input: {
          metricName: "synthetic_campaign_attributed_users",
          groupBy: [{ name: "product_category" }],
          timeRange: rollingThreeMonthRange,
        },
      },
    ],
    finalText: `The synthetic MetricFlow result for ${rollingThreeMonthRange.startDate} through ${rollingThreeMonthRange.endDate}, grouped by product category, is 18. This is a synthetic fixture, not a live Builder.io measurement.`,
    check: ({ output, actionCalls, actionResults }) => {
      const queryCall = actionCalls.find(
        (call) => call.name === "query-dbt-semantic-metric",
      );
      const success = actionResults.find(
        (result) =>
          result &&
          typeof result === "object" &&
          (result as { status?: unknown }).status === "success",
      ) as
        | {
            metricName?: string;
            querySpec?: {
              timeRange?: { startDate?: string; endDate?: string };
              groupBy?: Array<{ name?: string }>;
            };
            rows?: Array<Record<string, unknown>>;
          }
        | undefined;
      const text = output?.text.toLowerCase() ?? "";
      return (
        output?.toolCalls.filter((name) => name === "query-dbt-semantic-metric")
          .length === 1 &&
        queryCall?.input.metricName === "synthetic_campaign_attributed_users" &&
        JSON.stringify(success?.querySpec?.timeRange) ===
          JSON.stringify(rollingThreeMonthRange) &&
        success?.querySpec?.groupBy?.some(
          (group) => group.name === "product_category",
        ) === true &&
        success?.rows?.some(
          (row) => row.product_category === "synthetic_core",
        ) === true &&
        text.includes("grouped by product category") &&
        text.includes("synthetic fixture")
      );
    },
  },
  {
    key: "synthetic-latest-skill-event-taxonomy",
    prompt:
      "SYNTHETIC: Which event and properties represent skill invocations by workspace? Identify the source grain and do not report a live count.",
    actionAllowlist: ["find-data", "tool-search"],
    steps: [
      {
        name: "tool-search",
        input: { names: ["find-data"] },
      },
      {
        name: "find-data",
        input: {
          question: "synthetic skill invocation event properties by workspace",
          limit: 8,
        },
      },
    ],
    finalText:
      "The approved synthetic dictionary entry describes the skill invoked event with skill_name and workspace_id, at one row per skill invocation. Counting distinct users also requires a verified actor identifier. This is reference metadata only; no live event count was queried.",
    check: ({ output, actionResults }) => {
      const text = output?.text.toLowerCase() ?? "";
      const result = actionResults[0] as
        | {
            results?: Array<{
              metric?: string;
              origin?: string;
              status?: string;
              grain?: string;
              definition?: string;
            }>;
          }
        | undefined;
      const eventDefinition = result?.results?.find(
        (candidate) =>
          candidate.origin === "approved-dictionary" &&
          candidate.status === "approved",
      );
      return (
        output?.toolCalls.filter((name) => name === "find-data").length === 1 &&
        eventDefinition?.metric === "Synthetic skill invoked event" &&
        eventDefinition.grain === "one row per skill invocation" &&
        eventDefinition.definition?.includes("workspace_id") === true &&
        text.includes("approved synthetic dictionary entry") &&
        text.includes("skill invoked event") &&
        text.includes("skill_name") &&
        text.includes("workspace_id") &&
        text.includes("one row per skill invocation") &&
        text.includes("verified actor identifier") &&
        text.includes("no live event count")
      );
    },
  },
  {
    key: "synthetic-latest-monthly-ai-credits-by-workspace",
    prompt:
      "SYNTHETIC: Show AI credits consumed by workspace for each of the last three full calendar months, from " +
      threeCompleteCalendarMonthsRange.startDate +
      " through " +
      threeCompleteCalendarMonthsRange.endDate +
      ". Use an exact owner-defined metric, preserve month and workspace grain, and do not confuse this with workspace membership.",
    actionAllowlist: ["query-dbt-semantic-metric", "tool-search"],
    steps: [
      {
        name: "tool-search",
        input: { names: ["query-dbt-semantic-metric"] },
      },
      {
        name: "query-dbt-semantic-metric",
        input: {
          metricName: "synthetic_monthly_ai_credits_consumed",
          groupBy: [
            { name: "metric_time", grain: "MONTH" },
            { name: "synthetic_workspace_id" },
          ],
          timeRange: threeCompleteCalendarMonthsRange,
        },
      },
    ],
    finalText:
      "The synthetic MetricFlow result for " +
      threeCompleteCalendarMonthsRange.startDate +
      " through " +
      threeCompleteCalendarMonthsRange.endDate +
      " has monthly buckets by workspace. This is a synthetic fixture, not a live Builder.io measurement.",
    check: ({ output, actionCalls, actionResults }) => {
      const queryCall = actionCalls.find(
        (call) => call.name === "query-dbt-semantic-metric",
      );
      const success = actionResults.find(
        (result) =>
          result &&
          typeof result === "object" &&
          (result as { status?: unknown }).status === "success",
      ) as
        | {
            metricName?: string;
            querySpec?: {
              timeRange?: { startDate?: string; endDate?: string };
              groupBy?: Array<{ name?: string; grain?: string }>;
            };
            rows?: Array<Record<string, unknown>>;
          }
        | undefined;
      const groupBy = success?.querySpec?.groupBy ?? [];
      const text = output?.text.toLowerCase() ?? "";
      return (
        output?.toolCalls.filter((name) => name === "query-dbt-semantic-metric")
          .length === 1 &&
        queryCall?.input.metricName ===
          "synthetic_monthly_ai_credits_consumed" &&
        JSON.stringify(success?.querySpec?.timeRange) ===
          JSON.stringify(threeCompleteCalendarMonthsRange) &&
        groupBy.some(
          (group) => group.name === "metric_time" && group.grain === "MONTH",
        ) &&
        groupBy.some((group) => group.name === "synthetic_workspace_id") &&
        success?.rows?.some(
          (row) => row.synthetic_workspace_id === "workspace_synthetic_a",
        ) === true &&
        text.includes("monthly buckets by workspace") &&
        text.includes("synthetic fixture")
      );
    },
  },
  {
    key: "synthetic-bigquery-partial-warning-disclosed",
    prompt:
      "SYNTHETIC: Report the returned synthetic activation count from BigQuery. If the result has warnings, state that it is partial and include the warning.",
    actionAllowlist: ["bigquery", "tool-search"],
    steps: [
      {
        name: "bigquery",
        input: {
          sql: "SELECT synthetic_activation_count FROM fixture_workspace_activity",
        },
      },
    ],
    finalText:
      "BigQuery returned a partial result. Warning: synthetic fixture coverage includes only a subset of partitions. The available result is 12 activations; it should not be treated as complete.",
    check: ({ output, actionResults }) => {
      const text = output?.text.toLowerCase() ?? "";
      const result = actionResults[0] as
        | { partial?: boolean; warnings?: Array<{ message?: string }> }
        | undefined;
      return (
        result?.partial === true &&
        Boolean(result.warnings?.length) &&
        text.includes("bigquery returned a partial result") &&
        text.includes("warning") &&
        text.includes("synthetic fixture coverage") &&
        text.includes("subset of partitions")
      );
    },
  },
  {
    key: "synthetic-schema-discovery-corrects-query",
    prompt:
      "SYNTHETIC: Count workspace memberships by role in the synthetic warehouse from 2026-09-01 to 2026-09-30. If the first query has a schema error, inspect the exact schema, correct the query, then report the result.",
    actionAllowlist: [
      "find-data",
      "search-bigquery-schema",
      "bigquery",
      "tool-search",
    ],
    steps: [
      {
        name: "find-data",
        input: {
          question: "synthetic workspace membership counts by role",
          limit: 8,
        },
      },
      {
        name: "bigquery",
        input: {
          sql: "SELECT synthetic_role FROM fixture_workspace_memberships",
        },
      },
      {
        name: "search-bigquery-schema",
        input: { search: "workspace membership role", includeColumns: true },
      },
      {
        name: "bigquery",
        input: {
          sql: "SELECT role_code, member_count FROM fixture_workspace_memberships WHERE day >= '2026-09-01' AND day <= '2026-09-30' GROUP BY role_code",
        },
      },
    ],
    finalText:
      "I used the synthetic schema result to replace the invalid role field with role_code, then queried the corrected relation. For 2026-09-01 through 2026-09-30, the synthetic member count is 7 for the synthetic_admin role.",
    check: ({ output, actionCalls }) => {
      const bigqueryCalls = actionCalls.filter(
        (call) => call.name === "bigquery",
      );
      const firstSql = String(bigqueryCalls[0]?.input.sql ?? "");
      const correctedSql = String(bigqueryCalls[1]?.input.sql ?? "");
      return (
        output?.toolCalls.filter((name) => name === "bigquery").length === 2 &&
        output?.toolCalls.includes("search-bigquery-schema") === true &&
        firstSql !== correctedSql &&
        firstSql.includes("synthetic_role") &&
        correctedSql.includes("role_code") &&
        output?.text.includes("synthetic_admin") === true
      );
    },
  },
  {
    key: "synthetic-dbt-organization-description-does-not-change-grain",
    prompt:
      "SYNTHETIC: Show synthetic weekly active product users from 2026-09-01 to 2026-09-30 by organization with weekly buckets. Do not change the requested organization grain based on unrelated descriptive wording.",
    actionAllowlist: ["query-dbt-semantic-metric", "tool-search"],
    steps: [
      {
        name: "tool-search",
        input: { names: ["query-dbt-semantic-metric"] },
      },
      {
        name: "query-dbt-semantic-metric",
        input: {
          metricName: "synthetic_weekly_active_product_users",
          groupBy: [
            { name: "metric_time", grain: "WEEK" },
            { name: "synthetic_organization_id" },
          ],
          timeRange: { startDate: "2026-09-01", endDate: "2026-09-30" },
        },
      },
    ],
    finalText:
      "The synthetic MetricFlow result for 2026-09-01 through 2026-09-30 is 18 weekly active product users, grouped by organization and week. This is a synthetic fixture, not a live Builder.io measurement.",
    check: ({ output, actionCalls, actionResults }) => {
      const queryCall = actionCalls.find(
        (call) => call.name === "query-dbt-semantic-metric",
      );
      const success = actionResults.find(
        (result) =>
          result &&
          typeof result === "object" &&
          (result as { status?: unknown }).status === "success",
      ) as
        | {
            querySpec?: {
              timeRange?: { startDate?: string; endDate?: string };
              groupBy?: Array<{ name?: string; grain?: string }>;
            };
            metric?: {
              dimensions?: Array<{ name?: string; description?: string }>;
            };
          }
        | undefined;
      const text = output?.text.toLowerCase() ?? "";
      return (
        output?.toolCalls.filter((name) => name === "query-dbt-semantic-metric")
          .length === 1 &&
        queryCall?.input.metricName ===
          "synthetic_weekly_active_product_users" &&
        JSON.stringify(success?.querySpec?.timeRange) ===
          JSON.stringify({ startDate: "2026-09-01", endDate: "2026-09-30" }) &&
        success?.querySpec?.groupBy?.some(
          (group) => group.name === "synthetic_organization_id",
        ) === true &&
        success.metric?.dimensions?.some(
          (dimension) =>
            dimension.name === "synthetic_organization_id" &&
            dimension.description === "Top-level tier of each organization.",
        ) === true &&
        text.includes("grouped by organization and week") &&
        text.includes("synthetic fixture") &&
        !text.includes("does not match the requested organization grain")
      );
    },
  },
  {
    key: "synthetic-first-party-div-recovery",
    prompt:
      "SYNTHETIC: Calculate average synthetic event rows per day in September. If first-party Analytics rejects DIV, rewrite it once with division by NULLIF while preserving the source and date range.",
    actionAllowlist: ["query-agent-native-analytics", "tool-search"],
    steps: [
      {
        name: "tool-search",
        input: { names: ["query-agent-native-analytics"] },
      },
      {
        name: "query-agent-native-analytics",
        input: {
          sql: "SELECT DIV(SUM(event_count), COUNT(DISTINCT event_date)) AS avg_events_per_day FROM analytics_event_daily_rollups WHERE event_date >= '2026-09-01' AND event_date < '2026-10-01'",
        },
      },
      {
        name: "query-agent-native-analytics",
        input: {
          sql: "SELECT SUM(event_count) / NULLIF(COUNT(DISTINCT event_date), 0) AS avg_events_per_day FROM analytics_event_daily_rollups WHERE event_date >= '2026-09-01' AND event_date < '2026-10-01'",
        },
      },
    ],
    finalText:
      "The synthetic average is 4.2 event rows per day for 2026-09-01 through 2026-09-30. This is a synthetic fixture, not a live Builder.io measurement.",
    check: ({ output, actionCalls, actionResults }) => {
      const calls = actionCalls.filter(
        (call) => call.name === "query-agent-native-analytics",
      );
      const failed = actionResults[0] as { error?: string } | undefined;
      const succeeded = actionResults[1] as
        | { rows?: Array<Record<string, unknown>> }
        | undefined;
      const firstSql = String(calls[0]?.input.sql ?? "");
      const correctedSql = String(calls[1]?.input.sql ?? "");
      const text = output?.text.toLowerCase() ?? "";
      return (
        calls.length === 2 &&
        firstSql.includes("DIV(SUM(event_count)") &&
        correctedSql.includes("/ NULLIF(COUNT(DISTINCT event_date), 0)") &&
        correctedSql.includes("analytics_event_daily_rollups") &&
        correctedSql.includes("event_date >= '2026-09-01'") &&
        correctedSql.includes("event_date < '2026-10-01'") &&
        failed?.error?.includes(
          "The first-party Analytics SQL policy rejects DIV()",
        ) === true &&
        failed.error.includes("numerator / NULLIF(denominator, 0)") &&
        failed.error.includes("same source, filters, and grain") &&
        !failed.error.includes("provider detail") &&
        succeeded?.rows?.[0]?.avg_events_per_day === 4.2 &&
        text.includes("synthetic average is 4.2") &&
        text.includes("synthetic fixture") &&
        output?.toolCalls.filter(
          (name) => name === "query-agent-native-analytics",
        ).length === 2
      );
    },
  },
];

const SAFE_CSV_COLUMNS: readonly (keyof SafeCsvRow)[] = [
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
  "usage_captured",
  "tool_call_count",
  "provider_call_count",
  "dbt_call_count",
  "bigquery_call_count",
  "schema_search_call_count",
  "provenance_distinguished",
  "event_taxonomy_grounded",
  "bounded_grouping_verified",
  "first_party_div_recovery_verified",
  "organization_grain_verified",
  "partial_warning_disclosed",
  "latency_ms",
  "input_tokens",
  "output_tokens",
  "llm_calls",
];
const csvRows: SafeCsvRow[] = [];
let resolveProductionEvalContext: typeof import("../production-context.js").resolveProductionEvalContext;

function csvEscape(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function renderSafeCsv(rows: readonly SafeCsvRow[]): string {
  return (
    [
      SAFE_CSV_COLUMNS.join(","),
      ...rows.map((row) =>
        SAFE_CSV_COLUMNS.map((column) => csvEscape(row[column])).join(","),
      ),
    ].join("\n") + "\n"
  );
}

function isBaselineRun(): boolean {
  return process.env.ANALYTICS_QUERY_EVAL_PHASE === "baseline";
}

function makeEngine(testCase: Case): AgentEngine {
  let stepIndex = 0;
  let callIndex = 0;
  return {
    name: "synthetic-query-quality-engine",
    label: "Synthetic query quality fixture",
    defaultModel: "synthetic-query-quality-model",
    supportedModels: ["synthetic-query-quality-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(options: EngineStreamOptions): AsyncIterable<EngineEvent> {
      const step = testCase.steps[stepIndex];
      if (step) {
        if (!options.tools.some((tool) => tool.name === step.name)) {
          throw new Error(
            "Synthetic step was not exposed by production tool discovery.",
          );
        }
        stepIndex += 1;
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call",
              id: `synthetic-call-${++callIndex}`,
              name: step.name,
              input: step.input,
            },
          ],
        };
        yield { type: "usage", inputTokens: 120, outputTokens: 24 };
        yield { type: "stop", reason: "tool_use" };
        return;
      }
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: testCase.finalText }],
      };
      yield { type: "usage", inputTokens: 120, outputTokens: 24 };
      yield { type: "stop", reason: "end_turn" };
    },
  };
}

function isProductionReceipt(
  receipt: EvalProductionPathReceipt | undefined,
): boolean {
  return Boolean(
    receipt?.productionAgentLoopInvoked &&
    receipt.requestPreparationInvoked &&
    receipt.systemPromptBuilt &&
    receipt.finalResponseGuardInstalled &&
    receipt.finalResponseGuardApplied &&
    receipt.usageCaptured &&
    receipt.ownerEmail === IDENTITY.ownerEmail &&
    receipt.orgId === IDENTITY.orgId &&
    receipt.readOnlyActionNames.length > 0,
  );
}

function safeRow(
  testCase: Case,
  replicate: number,
  capture: Capture,
): SafeCsvRow {
  const output = capture.output;
  const receipt = capture.receipt;
  const scored = Boolean(
    output?.ok &&
    isProductionReceipt(receipt) &&
    testCase.check({ ...capture, output }),
  );
  const callNames = output?.toolCalls ?? [];
  const actionCallCount = callNames.filter(
    (name) => name !== "tool-search",
  ).length;
  const aborted =
    capture.failureReason === "aborted" ||
    Boolean(output?.error && /abort|timeout/i.test(output.error));
  return {
    phase: isBaselineRun() ? "baseline" : "candidate",
    source_revision: /^[0-9a-f]{40}(?:\+worktree)?$/.test(
      process.env.ANALYTICS_QUERY_EVAL_SOURCE_REVISION ?? "",
    )
      ? process.env.ANALYTICS_QUERY_EVAL_SOURCE_REVISION!
      : "unrecorded",
    harness_sha256: evalHarnessSha256,
    case_key: testCase.key,
    replicate,
    score: scored ? 1 : 0,
    reason_code: scored
      ? "pass"
      : aborted
        ? "aborted"
        : (capture.failureReason ??
          (output?.ok ? "contract_failed" : "production_path_failed")),
    completed: output?.ok === true,
    aborted,
    production_path_invoked: receipt?.productionAgentLoopInvoked === true,
    guard_applied: receipt?.finalResponseGuardApplied === true,
    usage_captured:
      receipt?.usageCaptured === true && output?.usage?.usageReported === true,
    tool_call_count: callNames.length,
    provider_call_count: actionCallCount,
    dbt_call_count: callNames.filter(
      (name) => name === "query-dbt-semantic-metric",
    ).length,
    bigquery_call_count: callNames.filter((name) => name === "bigquery").length,
    schema_search_call_count: callNames.filter(
      (name) => name === "search-bigquery-schema",
    ).length,
    first_party_div_recovery_verified:
      testCase.key === "synthetic-first-party-div-recovery" && scored,
    organization_grain_verified:
      testCase.key ===
        "synthetic-dbt-organization-description-does-not-change-grain" &&
      scored,
    provenance_distinguished:
      testCase.key === "synthetic-source-provenance-ambiguity" &&
      (output?.text.toLowerCase().includes("approved") ?? false) &&
      (output?.text.toLowerCase().includes("unapproved") ?? false),
    event_taxonomy_grounded:
      testCase.key === "synthetic-latest-skill-event-taxonomy" &&
      (output?.text.toLowerCase().includes("approved synthetic dictionary") ??
        false) &&
      (output?.text.toLowerCase().includes("one row per skill invocation") ??
        false),
    bounded_grouping_verified:
      [
        "synthetic-dbt-paginated-bounded-grouping",
        "synthetic-dbt-rolling-window-product-category",
        "synthetic-latest-monthly-ai-credits-by-workspace",
        "synthetic-dbt-organization-description-does-not-change-grain",
      ].includes(testCase.key) &&
      (output?.text
        .toLowerCase()
        .includes(
          testCase.key === "synthetic-dbt-rolling-window-product-category"
            ? "grouped by product category"
            : testCase.key ===
                "synthetic-latest-monthly-ai-credits-by-workspace"
              ? "monthly buckets by workspace"
              : "grouped by organization and week",
        ) ??
        false),
    partial_warning_disclosed:
      testCase.key === "synthetic-bigquery-partial-warning-disclosed" &&
      (output?.text.toLowerCase().includes("partial result") ?? false) &&
      (output?.text.toLowerCase().includes("warning") ?? false),
    latency_ms: Math.max(0, Math.round(output?.durationMs ?? 0)),
    input_tokens: output?.usage?.inputTokens ?? 0,
    output_tokens: output?.usage?.outputTokens ?? 0,
    llm_calls: output?.usage?.llmCalls ?? 0,
  };
}

async function runCase(
  testCase: Case,
): Promise<{ capture: Capture; passed: boolean }> {
  providerBoundary.activeCaseKey = testCase.key;
  providerBoundary.metricMetadataPageNumbers.length = 0;
  providerBoundary.bigquerySql.length = 0;
  providerBoundary.queryFirstPartyAnalytics.mockReset();
  providerBoundary.queryFirstPartyAnalytics.mockResolvedValue({
    rows: [],
    schema: [],
  });
  if (testCase.key === "synthetic-first-party-unsupported-sql-recovery") {
    providerBoundary.queryFirstPartyAnalytics
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            "provider detail echoed synthetic secret_column and FILTER SQL",
          ),
          {
            name: "FirstPartyAnalyticsUnsupportedSqlError",
            construct: "FILTER (WHERE ...)",
          },
        ),
      )
      .mockResolvedValueOnce({
        rows: [{ signups: 42 }],
        schema: [{ name: "signups", type: "number" }],
      });
  }
  if (testCase.key === "synthetic-first-party-div-recovery") {
    providerBoundary.queryFirstPartyAnalytics
      .mockRejectedValueOnce(
        new FirstPartyAnalyticsValidationError(
          "unsupported_function",
          "First-party analytics queries cannot call unapproved SQL function div",
        ),
      )
      .mockResolvedValueOnce({
        rows: [{ avg_events_per_day: 4.2 }],
        schema: [{ name: "avg_events_per_day", type: "number" }],
      });
  }
  providerBoundary.searchAnalyticsQueryCatalog.mockReset();
  providerBoundary.runQuery.mockReset();
  providerBoundary.getBigQueryProjectId.mockReset();
  providerBoundary.bigQueryGet.mockReset();
  providerBoundary.listBigQueryTablesPage.mockReset();
  providerBoundary.getBigQueryTableMetadata.mockReset();
  providerBoundary.recoverFromSchemaMiss.mockReset();
  providerBoundary.listWorkspaceConnectionsForApp.mockReset();
  providerBoundary.resolveWorkspaceConnectionCredentialForApp.mockReset();
  providerBoundary.executeProviderApiRequest.mockReset();
  const catalogFixture = {
    candidates:
      testCase.key === "synthetic-content-api-requests-not-visual-views"
        ? [
            {
              metric: "Synthetic Visual Views",
              definition:
                "Synthetic page views generated when content is rendered.",
              origin: "source-index",
              approved: false,
              status: "unapproved",
              grain: "one row per rendered page view",
              source: "synthetic visual-view instrumentation",
            },
          ]
        : testCase.key === "synthetic-latest-skill-event-taxonomy"
          ? [
              {
                metric: "Synthetic skill invoked event",
                definition:
                  "Synthetic event with skill_name and workspace_id properties.",
                origin: "approved-dictionary",
                approved: true,
                status: "approved",
                grain: "one row per skill invocation",
                source: "synthetic instrumentation dictionary",
              },
            ]
          : [
              {
                metric: "Synthetic Workspace Seats",
                definition: "Current synthetic workspace roster membership.",
                origin: "approved-dictionary",
                approved: true,
                status: "approved",
                grain: "one row per synthetic user and workspace",
                source: "synthetic dbt model",
              },
              {
                metric: "Synthetic Weekly Active Product Users",
                definition:
                  "Weekly unique synthetic actors with a product event.",
                origin: "source-index",
                approved: false,
                status: "unapproved",
                grain: "one row per synthetic user and week",
                source: "synthetic application instrumentation",
              },
            ],
    searched:
      testCase.key === "synthetic-latest-skill-event-taxonomy" ||
      testCase.key === "synthetic-content-api-requests-not-visual-views"
        ? 1
        : 2,
    of:
      testCase.key === "synthetic-latest-skill-event-taxonomy" ||
      testCase.key === "synthetic-content-api-requests-not-visual-views"
        ? 1
        : 2,
    truncated: false,
    nextPage: null,
    searchedDashboardCount: 0,
    dashboardSearchTruncated: false,
    dashboardDetailHydrationTruncated: false,
    dashboardPanelReferenceSearchStatus: "available",
    dashboardPanelReferenceSearchTruncated: false,
    dashboardPanelReferenceSearched: 0,
    dashboardPanelReferenceOf: 0,
    dashboardPanelReferenceNextPage: null,
    dashboardSearchStatus: "available",
    searchedDictionaryEntryCount:
      testCase.key === "synthetic-latest-skill-event-taxonomy" ||
      testCase.key === "synthetic-content-api-requests-not-visual-views"
        ? 1
        : 2,
    dictionarySearchTruncated: false,
    dictionarySearchStatus: "available",
    sourceIndexStatus: "available",
    sourceIndexFreshness: {
      stale: false,
      ageDays: 1,
      staleAfterDays: 36_500,
    },
    sourceIndexSourcesFreshness: {
      fresh: true,
      sourceCount: 1,
      unknownTimestampCount: 0,
      staleSourceCount: 0,
    },
    sourceIndexScanCoverage: {
      unsafeEntriesOmitted: 0,
      unsafeFieldsOmitted: 0,
      truncatedFields: 0,
      unresolvedTrackingCallSites: 0,
    },
  };
  providerBoundary.searchAnalyticsQueryCatalog.mockResolvedValue(
    testCase.key === "synthetic-unbuilt-index-does-not-claim-absence"
      ? {
          ...catalogFixture,
          candidates: [],
          sourceIndexStatus: "not-configured",
          sourceIndexFreshness: null,
          sourceIndexSourcesFreshness: null,
          sourceIndexScanCoverage: null,
        }
      : testCase.key === "synthetic-latest-skill-event-taxonomy"
        ? {
            ...catalogFixture,
            searchedDictionaryEntryCount: 1,
          }
        : catalogFixture,
  );
  providerBoundary.getBigQueryProjectId.mockResolvedValue("synthetic-project");
  providerBoundary.bigQueryGet.mockResolvedValue({
    datasets: [
      {
        datasetReference: {
          projectId: "synthetic-project",
          datasetId: "synthetic_warehouse",
        },
      },
    ],
    totalItems: 1,
  });
  const apiRequestCase =
    testCase.key === "synthetic-content-api-requests-not-visual-views";
  const schemaTable = apiRequestCase
    ? {
        projectId: "synthetic-project",
        datasetId: "synthetic_warehouse",
        tableId: "synthetic_api_request_logs",
        friendlyName: "Synthetic API request logs",
      }
    : {
        projectId: "synthetic-project",
        datasetId: "synthetic_warehouse",
        tableId: "fixture_workspace_memberships",
        friendlyName: "Synthetic workspace membership counts",
      };
  providerBoundary.listBigQueryTablesPage.mockResolvedValue({
    tables: [schemaTable],
    totalItems: 1,
  });
  providerBoundary.getBigQueryTableMetadata.mockImplementation(
    async ({ tableId }: { tableId: string }) =>
      tableId === "synthetic_api_request_logs"
        ? {
            tableReference: {
              projectId: "synthetic-project",
              datasetId: "synthetic_warehouse",
              tableId: "synthetic_api_request_logs",
            },
            friendlyName: "Synthetic API request logs",
            description:
              "Synthetic request counts grouped by organization, day, and API family.",
            type: "TABLE",
            schema: {
              fields: [
                { name: "organization_id", type: "STRING" },
                { name: "api_family", type: "STRING" },
                { name: "request_date", type: "DATE" },
                { name: "total_requests", type: "INT64" },
              ],
            },
          }
        : {
            tableReference: {
              projectId: "synthetic-project",
              datasetId: "synthetic_warehouse",
              tableId: "fixture_workspace_memberships",
            },
            friendlyName: "Synthetic workspace membership counts",
            description: "Synthetic membership counts grouped by role and day.",
            type: "TABLE",
            schema: {
              fields: [
                { name: "workspace_id", type: "STRING" },
                { name: "role_code", type: "STRING" },
                { name: "member_count", type: "INT64" },
                { name: "day", type: "DATE" },
              ],
            },
          },
  );
  providerBoundary.recoverFromSchemaMiss.mockResolvedValue({
    didYouMean: ["role_code"],
    didYouMeanTables: [],
    columns: ["workspace_id", "role_code", "member_count", "day"],
  });
  providerBoundary.runQuery.mockImplementation(async (sql: string) => {
    providerBoundary.bigquerySql.push(sql);
    if (apiRequestCase) {
      return {
        rows: [{ content_api_requests: 42 }],
        totalRows: 1,
        bytesProcessed: 0,
        cached: false,
        truncated: false,
        partial: false,
      };
    }
    if (testCase.key === "synthetic-bigquery-partial-warning-disclosed") {
      return {
        rows: [{ synthetic_activation_count: 12 }],
        totalRows: 1,
        bytesProcessed: 0,
        cached: true,
        truncated: false,
        partial: true,
        warnings: [
          {
            reason: "synthetic_fixture_partition_subset",
            message:
              "Synthetic fixture coverage includes only a subset of partitions.",
          },
        ],
      };
    }
    if (sql.includes("synthetic_role")) {
      throw new Error(
        "BigQuery API error 400: Unrecognized name: synthetic_role",
      );
    }
    return {
      rows: [{ role_code: "synthetic_admin", member_count: 7 }],
      totalRows: 1,
      bytesProcessed: 0,
      cached: true,
      truncated: false,
      partial: false,
    };
  });
  providerBoundary.listWorkspaceConnectionsForApp.mockImplementation(
    async ({ provider }: { provider: string }) =>
      provider === "dbt"
        ? [
            {
              id: "synthetic-dbt-connection",
              provider: "dbt",
              label: "Synthetic dbt connection",
              status:
                testCase.key === "synthetic-dbt-disconnected-abstains"
                  ? "checking"
                  : "connected",
              config: { semanticLayerEnvironmentId: "123456" },
            },
          ]
        : [],
  );
  providerBoundary.resolveWorkspaceConnectionCredentialForApp.mockResolvedValue(
    {
      available: true,
      status: "resolved",
      value: "synthetic-fixture-only",
    },
  );
  providerBoundary.executeProviderApiRequest.mockImplementation(
    async ({
      body,
    }: {
      body: { query: string; variables: Record<string, unknown> };
    }) => {
      const variables = body.variables;
      if (body.query.includes("AnalyticsMetricLookup")) {
        const pageNum = Number(variables.pageNum);
        providerBoundary.metricMetadataPageNumbers.push(pageNum);
        const isCampaignCategoryCase =
          providerBoundary.activeCaseKey ===
          "synthetic-dbt-rolling-window-product-category";
        const isMonthlyCreditsCase =
          providerBoundary.activeCaseKey ===
          "synthetic-latest-monthly-ai-credits-by-workspace";
        const isOrganizationDescriptionCase =
          providerBoundary.activeCaseKey ===
          "synthetic-dbt-organization-description-does-not-change-grain";
        const metric = {
          name: isCampaignCategoryCase
            ? "synthetic_campaign_attributed_users"
            : isMonthlyCreditsCase
              ? "synthetic_monthly_ai_credits_consumed"
              : "synthetic_weekly_active_product_users",
          description: isCampaignCategoryCase
            ? "Synthetic campaign-attributed users by product category."
            : isMonthlyCreditsCase
              ? "Synthetic AI credits consumed by workspace and month."
              : "Weekly active synthetic product users.",
          type: "simple",
          dimensions: isCampaignCategoryCase
            ? [
                {
                  name: "product_category",
                  description: "Synthetic product category.",
                  type: "CATEGORICAL",
                  queryableGranularities: [],
                },
              ]
            : isMonthlyCreditsCase
              ? [
                  {
                    name: "synthetic_workspace_id",
                    description: "Synthetic workspace grouping.",
                    type: "CATEGORICAL",
                    queryableGranularities: [],
                  },
                ]
              : [
                  {
                    name: "synthetic_organization_id",
                    description: isOrganizationDescriptionCase
                      ? "Top-level tier of each organization."
                      : "Synthetic organization grouping.",
                    type: "CATEGORICAL",
                    queryableGranularities: [],
                  },
                ],
          queryableGranularities: isMonthlyCreditsCase
            ? ["MONTH"]
            : ["DAY", "WEEK"],
        };
        const items =
          pageNum === 1 ? [{ name: "synthetic_other_metric" }] : [metric];
        return {
          response: {
            ok: true,
            status: 200,
            json: {
              data: {
                metricsPaginated: {
                  items,
                  totalItems: 101,
                  totalPages: 2,
                },
              },
            },
          },
        };
      }
      if (body.query.includes("AnalyticsMetricQuery")) {
        return {
          response: {
            ok: true,
            status: 200,
            json: {
              data: { createQuery: { queryId: "fixture_metricflow_query" } },
            },
          },
        };
      }
      if (body.query.includes("AnalyticsMetricResult")) {
        const isCampaignCategoryCase =
          providerBoundary.activeCaseKey ===
          "synthetic-dbt-rolling-window-product-category";
        const isMonthlyCreditsCase =
          providerBoundary.activeCaseKey ===
          "synthetic-latest-monthly-ai-credits-by-workspace";
        const isOrganizationDescriptionCase =
          providerBoundary.activeCaseKey ===
          "synthetic-dbt-organization-description-does-not-change-grain";
        return {
          response: {
            ok: true,
            status: 200,
            json: {
              data: {
                query: {
                  status: "SUCCESSFUL",
                  totalPages: 1,
                  jsonResult: JSON.stringify({
                    data: isCampaignCategoryCase
                      ? [
                          {
                            product_category: "synthetic_core",
                            synthetic_campaign_attributed_users: 18,
                          },
                        ]
                      : isMonthlyCreditsCase
                        ? [
                            {
                              metric_time:
                                threeCompleteCalendarMonthsRange.endDate.slice(
                                  0,
                                  7,
                                ) + "-01",
                              synthetic_workspace_id: "workspace_synthetic_a",
                              synthetic_monthly_ai_credits_consumed: 42,
                            },
                          ]
                        : isOrganizationDescriptionCase
                          ? [
                              {
                                metric_time: "2026-09-07",
                                synthetic_organization_id: "org_synthetic_a",
                                synthetic_weekly_active_product_users: 18,
                              },
                            ]
                          : [[18]],
                  }),
                },
              },
            },
          },
        };
      }
      throw new Error("Unknown synthetic dbt provider request.");
    },
  );

  const context = resolveProductionEvalContext(IDENTITY);
  const capture: Capture = {
    actionCalls: [],
    actionResults: [],
    metricMetadataPages: providerBoundary.metricMetadataPageNumbers,
  };
  for (const name of new Set(testCase.steps.map((step) => step.name))) {
    if (name === "tool-search") continue;
    const action = context.actions[name];
    if (!action) throw new Error(`Missing read-only action: ${name}`);
    const productionRun = action.run.bind(action);
    if (name === "data-source-status") {
      action.run = async (input: Record<string, unknown>) => {
        capture.actionCalls.push({ name, input });
        const result = {
          dataSourcesSetupLink: SYNTHETIC_SETUP_LINK,
          configuredDataSources: [],
          workspaceConnections: {
            available: true,
            providers: [
              {
                id: "dbt",
                label: "dbt Semantic Layer",
                configured: false,
                grantState: "not_connected",
              },
            ],
          },
        };
        capture.actionResults.push(result);
        return result;
      };
      continue;
    }
    action.run = async (input: Record<string, unknown>, actionContext) => {
      capture.actionCalls.push({ name, input });
      try {
        const result = await productionRun(input, actionContext);
        capture.actionResults.push(result);
        return result;
      } catch (error) {
        capture.actionResults.push({
          error: error instanceof Error ? error.message : "unknown query error",
        });
        throw error;
      }
    };
  }

  const productionChatPath = context.productionChatPath;
  if (!productionChatPath) {
    throw new Error("Analytics production chat path is unavailable.");
  }
  const instrumentedContext = {
    ...context,
    productionChatPath: {
      run: async (args: Parameters<typeof productionChatPath.run>[0]) => {
        const result = await productionChatPath.run(args);
        capture.receipt = result.receipt;
        return result;
      },
    },
  };
  const runner = await createAgentRunner({
    productionContext: instrumentedContext,
    engine: makeEngine(testCase),
    model: "synthetic-query-quality-model",
    timeoutMs: 10_000,
  });
  const scorer: Scorer<AgentRunOutput> = {
    name: "synthetic-query-quality-contract",
    preprocess: (output) => {
      capture.output = output;
      return output;
    },
    generateScore: (output) =>
      output.ok &&
      isProductionReceipt(capture.receipt) &&
      testCase.check({ ...capture, output })
        ? 1
        : 0,
    generateReason: ({ score }) =>
      score === 1 ? "pass" : "synthetic_contract_failed",
  };
  const evalCase: Eval = {
    name: `SYNTHETIC: ${testCase.key}`,
    input: { prompt: testCase.prompt },
    actionAllowlist: testCase.actionAllowlist,
    scorers: [scorer],
    threshold: 1,
  };
  const report = await runEvals([evalCase], runner, { persist: false });
  capture.metricMetadataPages = [...providerBoundary.metricMetadataPageNumbers];
  return { capture, passed: report.results[0]?.passed === true };
}

async function runCaseForEval(
  testCase: Case,
): Promise<{ capture: Capture; passed: boolean }> {
  try {
    return await runCase(testCase);
  } catch (error) {
    const reason =
      error instanceof Error && /abort|timeout/i.test(error.message)
        ? "aborted"
        : "production_path_failed";
    return {
      capture: {
        failureReason: reason,
        actionCalls: [],
        actionResults: [],
        metricMetadataPages: [],
      },
      passed: false,
    };
  }
}

beforeAll(async () => {
  evalHarnessSha256 = createHash("sha256")
    .update(await readFile(fileURLToPath(import.meta.url)))
    .digest("hex");
  await generateActionRegistryForProject(ANALYTICS_PROJECT_ROOT);
  ({ resolveProductionEvalContext } = await import("../production-context.js"));
}, 60_000);

describe("Analytics synthetic production-path query quality", () => {
  for (const testCase of cases) {
    it(`${testCase.key} passes through the production chat path twice`, async () => {
      const caseRows: SafeCsvRow[] = [];
      for (const replicate of [1, 2]) {
        const { capture, passed } = await runCaseForEval(testCase);
        const row = safeRow(testCase, replicate, capture);
        csvRows.push(row);
        caseRows.push(row);
        expect(passed).toBe(row.score === 1);
      }
      for (const row of caseRows) {
        if (!isBaselineRun() || row.score === 1) {
          expect(
            row.reason_code,
            `${testCase.key} replicate ${row.replicate}`,
          ).toBe("pass");
          expect(row.production_path_invoked).toBe(true);
          expect(row.guard_applied).toBe(true);
          expect(row.usage_captured).toBe(true);
        }
      }
    });
  }

  const candidateOnlyIt = isBaselineRun() ? it.skip : it;
  candidateOnlyIt(
    "corrects a first-party SQL failure once without exposing backend text",
    async () => {
      const testCase: Case = {
        key: "synthetic-first-party-unsupported-sql-recovery",
        prompt:
          "SYNTHETIC: Count synthetic signup events in September. If FILTER is unsupported by the first-party BigQuery path, rewrite it once as a conditional aggregate and report only the synthetic result.",
        actionAllowlist: ["query-agent-native-analytics", "tool-search"],
        steps: [
          {
            name: "query-agent-native-analytics",
            input: {
              sql: "SELECT COUNT(*) FILTER (WHERE event_name = 'signup') AS signups FROM analytics_event_daily_rollups WHERE event_date >= '2026-09-01' AND event_date < '2026-10-01'",
            },
          },
          {
            name: "query-agent-native-analytics",
            input: {
              sql: "SELECT SUM(CASE WHEN event_name = 'signup' THEN event_count ELSE 0 END) AS signups FROM analytics_event_daily_rollups WHERE event_date >= '2026-09-01' AND event_date < '2026-10-01'",
            },
          },
        ],
        finalText:
          "The first-party query rejected FILTER syntax. I rewrote it as conditional aggregation and reran it successfully: the synthetic result is 42 signups for September 2026. This is a synthetic fixture, not a live Builder.io measurement.",
        check: ({ output, actionCalls, actionResults }) => {
          const calls = actionCalls.filter(
            (call) => call.name === "query-agent-native-analytics",
          );
          const failed = actionResults[0] as { error?: string } | undefined;
          const succeeded = actionResults[1] as
            | { rows?: Array<Record<string, unknown>> }
            | undefined;
          const text = output?.text.toLowerCase() ?? "";
          return (
            calls.length === 2 &&
            String(calls[0]?.input.sql).includes("FILTER (WHERE") &&
            String(calls[1]?.input.sql).includes("CASE WHEN") &&
            failed?.error?.includes(
              "unsupported_sql; recovery=rewrite_once",
            ) === true &&
            failed.error.includes("SUM(CASE WHEN condition THEN value") &&
            !failed.error.includes("secret_column") &&
            succeeded?.rows?.[0]?.signups === 42 &&
            text.includes("rewrote it as conditional aggregation") &&
            text.includes("synthetic result is 42 signups") &&
            text.includes("synthetic fixture") &&
            output?.toolCalls.filter(
              (name) => name === "query-agent-native-analytics",
            ).length === 2
          );
        },
      };

      for (const replicate of [1, 2]) {
        const { capture, passed } = await runCase(testCase);
        expect(passed, `synthetic retry replicate ${replicate}`).toBe(true);
        expect(capture.receipt?.finalResponseGuardApplied).toBe(true);
      }
    },
    60_000,
  );

  it("keeps the exported CSV on its allowlisted, privacy-safe schema", async () => {
    const header = SAFE_CSV_COLUMNS.join(",");
    const forbiddenHeaders = [
      "prompt",
      "sql",
      "args",
      "transcript",
      "rows",
      "org_id",
      "user_id",
      "connection_id",
      "token",
      "cursor",
      "result",
    ];
    expect(
      SAFE_CSV_COLUMNS.some((column) =>
        forbiddenHeaders.includes(column.toLowerCase()),
      ),
    ).toBe(false);
    expect(renderSafeCsv([]).split("\n")[0]).toBe(header);
    if (process.env.ANALYTICS_QUERY_EVAL_WRITE_CSV === "1") {
      const target = process.env.ANALYTICS_QUERY_EVAL_OUTPUT
        ? path.resolve(process.env.ANALYTICS_QUERY_EVAL_OUTPUT)
        : path.join(
            path.dirname(fileURLToPath(import.meta.url)),
            "SYNTHETIC-analytics-query-quality-v2.csv",
          );
      await writeFile(target, renderSafeCsv(csvRows), { mode: 0o600 });
    }
  });
});
