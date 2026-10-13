import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { searchAnalyticsQueryCatalog } from "../server/lib/analytics-query-catalog.js";
import type {
  SourceIndexFreshness,
  SourceIndexScanCoverage,
} from "../server/lib/source-index-store.js";

function countLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sourceIndexScanGuidance(
  status: "not-configured" | "unavailable" | "invalid" | "available",
  coverage: SourceIndexScanCoverage | null,
): string {
  if (status !== "available" || !coverage) return "";
  const messages = [
    coverage.unsafeEntriesOmitted !== null && coverage.unsafeEntriesOmitted > 0
      ? `${countLabel(coverage.unsafeEntriesOmitted, "entry", "entries")} ${coverage.unsafeEntriesOmitted === 1 ? "was" : "were"} omitted by safety checks`
      : "",
    coverage.unsafeFieldsOmitted !== null && coverage.unsafeFieldsOmitted > 0
      ? `${countLabel(coverage.unsafeFieldsOmitted, "field")} ${coverage.unsafeFieldsOmitted === 1 ? "was" : "were"} omitted by safety checks`
      : "",
    coverage.truncatedFields !== null && coverage.truncatedFields > 0
      ? `${countLabel(coverage.truncatedFields, "field")} ${coverage.truncatedFields === 1 ? "was" : "were"} truncated`
      : "",
    coverage.unresolvedTrackingCallSites !== null &&
    coverage.unresolvedTrackingCallSites > 0
      ? `${countLabel(coverage.unresolvedTrackingCallSites, "tracking call site")} ${coverage.unresolvedTrackingCallSites === 1 ? "has" : "have"} unresolved event names`
      : "",
  ].filter(Boolean);
  if (Object.values(coverage).some((count) => count === null)) {
    messages.push(
      "Some source-index scan coverage counts are unavailable for this revision. Treat absence from generated references as unknown and verify with schema or source metadata.",
    );
  }
  if (messages.length > 0) {
    return `Source-index scan coverage: ${messages.join("; ")}. Treat missing source-index matches as incomplete and verify with schema or source metadata.`;
  }
  return "";
}

function sourceIndexFreshnessGuidance(
  status: "not-configured" | "unavailable" | "invalid" | "available",
  freshness: SourceIndexFreshness | null,
): string {
  if (status !== "available" || !freshness?.stale) return "";
  return `The generated source index is stale (${freshness.ageDays} days old; refresh threshold ${freshness.staleAfterDays} days). Use its entries only to discover leads; do not treat its definitions, grain, joins, or omissions as current. Verify current schema and owner-approved definitions before querying.`;
}

export default defineAction({
  description:
    "Find definitions, dashboard SQL, and source-index references. Returns ranked metadata, source-index freshness and scan coverage, never live values. Treat stale generated entries as discovery hints; use `search-bigquery-schema` for exact columns or partitions, then run one live query before reporting values.",
  schema: z.object({
    question: z
      .string()
      .trim()
      .min(2)
      .describe("The metric, event, entity, or data question"),
    limit: z.number().int().min(1).max(12).optional().default(8),
    nextPage: z.string().max(64).optional().describe("Previous-page cursor"),
  }),
  readOnly: true,
  mcpTool: true,
  run: async ({ question, limit, nextPage }) => {
    const email = getRequestUserEmail();
    if (!email) {
      fail("An authenticated user is required to search Analytics data.", {
        errorCode: "authentication_required",
        statusCode: 401,
      });
    }
    const result = await searchAnalyticsQueryCatalog({
      search: question,
      limit,
      nextPage,
      email,
      orgId: getRequestOrgId() || null,
    });
    const { candidates, ...paginationAndCoverage } = result;
    const sourceIndexGuidance =
      result.sourceIndexStatus === "not-configured"
        ? "The generated source index is not configured, so absence from these references is not evidence that a warehouse relation does not exist. Use search-bigquery-schema for connected BigQuery schemas."
        : result.sourceIndexStatus === "invalid" ||
            result.sourceIndexStatus === "unavailable"
          ? "The generated source index could not be read, so treat these references as incomplete and verify with search-bigquery-schema."
          : "";
    const scanGuidance = sourceIndexScanGuidance(
      result.sourceIndexStatus,
      result.sourceIndexScanCoverage,
    );
    const freshnessGuidance = sourceIndexFreshnessGuidance(
      result.sourceIndexStatus,
      result.sourceIndexFreshness,
    );
    return {
      question,
      results: candidates,
      ...paginationAndCoverage,
      resultType: "reference-metadata",
      guidance: [
        "Treat saved SQL and source-index entries as examples or unapproved metadata. Verify source scope, live schema, partitions, and current values before answering. If truncated is true and nextPage is present, continue with that cursor; if truncated is true and nextPage is null, refine the search or use an explicit dashboard/schema search because a source cap was reached.",
        sourceIndexGuidance,
        scanGuidance,
        freshnessGuidance,
      ]
        .filter(Boolean)
        .join(" "),
    };
  },
});
