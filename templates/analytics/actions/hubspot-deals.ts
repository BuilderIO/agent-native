import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  getAllDeals,
  getDealPipelines,
  getDealOwners,
  getVisiblePipelines,
  searchHubSpotObjects,
  type Deal,
  type Pipeline,
} from "../server/lib/hubspot";

const StringListSchema = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}, z.array(z.string()).optional());

const TextMatchSchema = z.enum(["token", "contains", "exact"]);
const ClosedStatusSchema = z.enum(["any", "won", "lost", "closed", "open"]);

function stageLookups(pipelines: Pipeline[]) {
  const stageLabels: Record<string, string> = {};
  const pipelineLabels: Record<string, string> = {};
  const wonStageIds = new Set<string>();
  const lostStageIds = new Set<string>();

  for (const pipeline of pipelines) {
    pipelineLabels[pipeline.id] = pipeline.label;
    for (const stage of pipeline.stages) {
      const label = stage.label || stage.id;
      const lower = label.toLowerCase();
      const probability = parseFloat(stage.metadata?.probability ?? "");
      stageLabels[stage.id] = label;
      if (
        probability === 1 ||
        lower.includes("closed won") ||
        lower === "won"
      ) {
        wonStageIds.add(stage.id);
      }
      if (
        probability === 0 ||
        lower.includes("closed lost") ||
        lower === "lost"
      ) {
        lostStageIds.add(stage.id);
      }
    }
  }

  return { stageLabels, pipelineLabels, wonStageIds, lostStageIds };
}

function enrichDeal(
  deal: Deal,
  lookups: ReturnType<typeof stageLookups>,
  owners: Record<string, string>,
) {
  const properties: Record<string, unknown> = { ...deal.properties };
  const stageId = String(properties.dealstage ?? "");
  const pipelineId = String(properties.pipeline ?? "");
  const ownerId = String(properties.hubspot_owner_id ?? "");
  const ownerName = ownerId ? owners[ownerId] : undefined;
  const stageName = lookups.stageLabels[stageId] ?? stageId;
  const pipelineName = lookups.pipelineLabels[pipelineId] ?? pipelineId;
  const isClosedWon = lookups.wonStageIds.has(stageId);
  const isClosedLost = lookups.lostStageIds.has(stageId);

  properties.deal_name = properties.dealname ?? "";
  properties.stage_name = stageName;
  properties.pipeline_name = pipelineName;
  properties.owner_name = ownerName ?? ownerId;
  properties.hubspot_owner_name = ownerName ?? ownerId;
  properties.sales_rep_owner_name = ownerName ?? ownerId;
  properties.is_closed_won = isClosedWon;
  properties.is_closed_lost = isClosedLost;
  properties.is_deal_closed = isClosedWon || isClosedLost;
  properties.company_name =
    properties.company_name ??
    properties.hs_primary_company_name ??
    properties.associatedcompanyid ??
    "";

  return { ...deal, properties };
}

function recordToDeal(record: {
  id: string;
  properties: Record<string, string | null | undefined>;
}): Deal {
  return {
    id: record.id,
    properties: {
      dealname: record.properties.dealname ?? "",
      dealstage: record.properties.dealstage ?? "",
      amount: record.properties.amount ?? null,
      closedate: record.properties.closedate ?? null,
      createdate: record.properties.createdate ?? "",
      hs_lastmodifieddate: record.properties.hs_lastmodifieddate ?? "",
      pipeline: record.properties.pipeline ?? "",
      hubspot_owner_id: record.properties.hubspot_owner_id ?? null,
      hs_deal_stage_probability:
        record.properties.hs_deal_stage_probability ?? null,
      ...record.properties,
    },
  };
}

type EnrichedDeal = ReturnType<typeof enrichDeal>;
type TextMatchMode = z.infer<typeof TextMatchSchema>;
type ClosedStatus = z.infer<typeof ClosedStatusSchema>;

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function splitMultiValue(value: string): string[] {
  return value
    .split(/[;,|]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function matchesText(
  value: unknown,
  expected: string | undefined,
  mode: TextMatchMode = "contains",
): boolean {
  const needle = expected?.trim().toLowerCase();
  if (!needle) return true;

  const haystack = textValue(value).toLowerCase();
  if (!haystack) return false;

  if (mode === "exact") return haystack === needle;
  if (mode === "token") {
    const tokens = splitMultiValue(haystack);
    return tokens.includes(needle) || haystack === needle;
  }
  return haystack.includes(needle);
}

function parseDateBoundary(
  value: string | undefined,
  endOfDay: boolean,
): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const numericYear = Number(year);
    const numericMonth = Number(month);
    const numericDay = Number(day);
    const timestamp = Date.UTC(
      numericYear,
      numericMonth - 1,
      numericDay,
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0,
    );
    const parsedDate = new Date(timestamp);
    if (
      parsedDate.getUTCFullYear() !== numericYear ||
      parsedDate.getUTCMonth() !== numericMonth - 1 ||
      parsedDate.getUTCDate() !== numericDay
    ) {
      return null;
    }
    return timestamp;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function dealClosedAt(deal: EnrichedDeal): number | null {
  const parsed = Date.parse(textValue(deal.properties.closedate));
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesClosedStatus(
  deal: EnrichedDeal,
  closedStatus: ClosedStatus,
): boolean {
  if (closedStatus === "any") return true;

  const isClosedWon = Boolean(deal.properties.is_closed_won);
  const isClosedLost = Boolean(deal.properties.is_closed_lost);
  const isClosed = isClosedWon || isClosedLost;

  if (closedStatus === "won") return isClosedWon;
  if (closedStatus === "lost") return isClosedLost;
  if (closedStatus === "closed") return isClosed;
  return !isClosed;
}

function matchesDateRange(
  deal: EnrichedDeal,
  fromMs: number | null,
  toMs: number | null,
): boolean {
  if (fromMs == null && toMs == null) return true;

  const closedAt = dealClosedAt(deal);
  if (closedAt == null) return false;
  if (fromMs != null && closedAt < fromMs) return false;
  if (toMs != null && closedAt > toMs) return false;
  return true;
}

function matchesPipeline(deal: EnrichedDeal, pipeline: string | undefined) {
  const trimmed = pipeline?.trim();
  if (!trimmed) return true;

  return (
    matchesText(deal.properties.pipeline_name, trimmed, "contains") ||
    matchesText(deal.properties.pipeline, trimmed, "contains")
  );
}

function buildFilterSummary(args: {
  owner?: string;
  query?: string;
  product?: string;
  productMatch: TextMatchMode;
  pipeline?: string;
  closedStatus: ClosedStatus;
  closedDateFrom?: string;
  closedDateTo?: string;
}) {
  return {
    ...(args.query ? { query: args.query } : {}),
    ...(args.owner ? { owner: args.owner } : {}),
    ...(args.product
      ? { products: args.product, productMatch: args.productMatch }
      : {}),
    ...(args.pipeline ? { pipeline: args.pipeline } : {}),
    ...(args.closedStatus !== "any" ? { closedStatus: args.closedStatus } : {}),
    ...(args.closedDateFrom ? { closedDateFrom: args.closedDateFrom } : {}),
    ...(args.closedDateTo ? { closedDateTo: args.closedDateTo } : {}),
  };
}

function hasStructuredFilters(filters: ReturnType<typeof buildFilterSummary>) {
  return [
    "owner",
    "products",
    "pipeline",
    "closedStatus",
    "closedDateFrom",
    "closedDateTo",
  ].some((key) => key in filters);
}

function buildGuidance(options: {
  query: string | undefined;
  structuredFilters: boolean;
  truncated: boolean;
  hasMore: boolean;
  total: number;
  returned: number;
  offset: number;
  limit: number;
}) {
  const guidance: string[] = [];

  if (options.query) {
    guidance.push(
      "Used HubSpot full-text deal search for the query. Treat query matches as broad keyword/account matches, not proof that a specific property equals the query.",
    );
  } else {
    guidance.push("Loaded visible HubSpot deals before local filtering.");
  }

  if (options.structuredFilters) {
    guidance.push(
      "Structured filters were applied to the returned cohort. Report the filter values and cohort count in the methodology. If the count looks too low, inspect HubSpot property metadata or adjust the structured filters; do not replace field-specific filters with a broad query search.",
    );
  } else {
    guidance.push(
      "For product, pipeline, closed-won/lost, or close-date cohorts, prefer product, pipeline, closedStatus, closedDateFrom, and closedDateTo over query.",
    );
  }

  if (options.truncated) {
    const more = options.hasMore
      ? `Fetch the next page with offset ${options.offset + options.returned}.`
      : "This is the last page of the cohort.";
    guidance.push(
      `Returned ${options.returned} of ${options.total} matching deals (limit ${options.limit}, offset ${options.offset}). This is a partial slice — do NOT treat it as the full cohort. Use total for counts/aggregates. ${more} Narrow the filters or, for exhaustive cohort analysis, use provider-api-request with provider = hubspot and stageAs.`,
    );
  }

  return guidance.join(" ");
}

export default defineAction({
  // Read-only provider query: safe to call from run-code `appAction` and
  // reusable across continuation retries (no re-fetch on resume).
  readOnly: true,
  description:
    "Get HubSpot deals with normalized stage, pipeline, owner, forecast, and NBM fields. This is a bounded deal analytics shortcut, not the full HubSpot capability surface. Use query for a specific customer/deal/account deep dive. For cohorts like products field = Publish, closed-won, pipeline = New Business, or close date in a range, use the structured product, pipeline, closedStatus, closedDateFrom, and closedDateTo filters instead of query when the answer is the deal list itself. If the cohort feeds a cross-source join, transcript/message/ticket search, exhaustive absence check, or downstream code/corpus workflow, prefer provider-api-catalog/provider-api-request with provider = hubspot and stageAs so the cohort is available as a staged dataset. Both paths are bounded: at most limit deals are returned (default 25, max 100). The structured-filter path returns total as the true matched count and a truncated flag; page with offset (or narrow filters) instead of expecting the whole cohort in one call, since a full enriched cohort can be several MB and overruns extension and context budgets. For non-deal CRM records use hubspot-records; for arbitrary HubSpot endpoints, filters, associations, batch APIs, or payloads use provider-api-catalog/provider-api-docs/provider-api-request with provider = hubspot.",
  schema: z.object({
    properties: StringListSchema.describe(
      "Optional comma-separated extra HubSpot deal property names to include.",
    ),
    owner: z
      .string()
      .optional()
      .describe("Optional owner name filter, case-insensitive."),
    product: z
      .string()
      .optional()
      .describe(
        "Optional structured filter for the HubSpot deals products field, e.g. Publish. Do not put product-field filters in query.",
      ),
    productMatch: TextMatchSchema.default("token").describe(
      "How to match the products field: token for multi-select values, contains for substring, exact for exact full-field match.",
    ),
    pipeline: z
      .string()
      .optional()
      .describe(
        "Optional structured filter for HubSpot deal pipeline id or label, case-insensitive contains match, e.g. New Business.",
      ),
    closedStatus: ClosedStatusSchema.default("any").describe(
      "Optional structured stage filter based on normalized HubSpot pipeline stage metadata.",
    ),
    closedDateFrom: z
      .string()
      .optional()
      .describe(
        "Optional inclusive close-date lower bound for deals, YYYY-MM-DD or ISO date/time.",
      ),
    closedDateTo: z
      .string()
      .optional()
      .describe(
        "Optional inclusive close-date upper bound for deals, YYYY-MM-DD or ISO date/time.",
      ),
    query: z
      .string()
      .optional()
      .describe(
        "Optional HubSpot full-text deal search query, such as a company name, deal name, domain, or keyword. Use for customer/deal deep dives. Do not use query as a substitute for field-specific product, pipeline, stage, or date filters.",
      ),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe(
        "Maximum deals to return. Applies to BOTH full-text query results and structured-filter cohorts. The structured-filter path returns at most this many enriched deals (use total for the true matched count and offset to page).",
      ),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        "Number of structured-filter results to skip before returning limit deals. Use for paging through a large cohort; ignored when query is provided.",
      ),
    after: z
      .string()
      .optional()
      .describe("Optional HubSpot pagination cursor for query results."),
  }),
  http: { method: "GET" },
  run: async ({
    properties,
    owner,
    product,
    productMatch = "token",
    pipeline,
    closedStatus = "any",
    closedDateFrom,
    closedDateTo,
    query,
    limit = 25,
    offset = 0,
    after,
  }) => {
    const trimmedQuery = query?.trim();
    const trimmedOwner = owner?.trim();
    const trimmedProduct = product?.trim();
    const trimmedPipeline = pipeline?.trim();
    const fromMs = parseDateBoundary(closedDateFrom, false);
    const toMs = parseDateBoundary(closedDateTo, true);

    if (closedDateFrom?.trim() && fromMs == null) {
      throw new Error(
        `Invalid closedDateFrom "${closedDateFrom}". Use YYYY-MM-DD or an ISO date/time.`,
      );
    }
    if (closedDateTo?.trim() && toMs == null) {
      throw new Error(
        `Invalid closedDateTo "${closedDateTo}". Use YYYY-MM-DD or an ISO date/time.`,
      );
    }

    const [dealResult, allPipelines, owners] = await Promise.all([
      trimmedQuery
        ? searchHubSpotObjects({
            objectType: "deals",
            query: trimmedQuery,
            properties,
            limit,
            after,
          })
        : getAllDeals(properties),
      getDealPipelines(),
      getDealOwners(),
    ]);

    const visiblePipelines = getVisiblePipelines(allPipelines);
    const visibleIds = new Set(visiblePipelines.map((p) => p.id));
    const lookups = stageLookups(visiblePipelines);
    const ownerFilter = owner?.trim().toLowerCase();
    const rawDeals = Array.isArray(dealResult)
      ? dealResult
      : dealResult.records.map(recordToDeal);
    const filters = buildFilterSummary({
      owner: trimmedOwner,
      query: trimmedQuery,
      product: trimmedProduct,
      productMatch,
      pipeline: trimmedPipeline,
      closedStatus,
      closedDateFrom: closedDateFrom?.trim(),
      closedDateTo: closedDateTo?.trim(),
    });
    const structuredFilters = hasStructuredFilters(filters);
    const matchedDeals = rawDeals
      .filter((d) => visibleIds.has(String(d.properties.pipeline)))
      .map((deal) => enrichDeal(deal, lookups, owners))
      .filter((deal) => {
        if (!ownerFilter) return true;
        const ownerName = String(
          deal.properties.owner_name ?? "",
        ).toLowerCase();
        return ownerName === ownerFilter;
      })
      .filter((deal) => {
        if (
          !matchesText(deal.properties.products, trimmedProduct, productMatch)
        ) {
          return false;
        }
        if (!matchesPipeline(deal, trimmedPipeline)) return false;
        if (!matchesClosedStatus(deal, closedStatus)) return false;
        return matchesDateRange(deal, fromMs, toMs);
      });

    // The full-text query path is already bounded by HubSpot's own `limit`.
    // The structured-filter path scans the whole visible deal set, so bound
    // the returned cohort here: a full enriched cohort can be multiple MB,
    // which overruns the extension iframe bridge and the agent context. We
    // keep `total` as the true matched count and signal partial slices via
    // `truncated` so callers never mistake a page for the full cohort.
    // `truncated` means "this response is only part of the cohort" (returned <
    // total) and stays true on the LAST page of a paginated read too; pagination
    // (is there a next page) is reported separately via `hasMore` / `nextOffset`.
    const matchedTotal = matchedDeals.length;
    const deals = trimmedQuery
      ? matchedDeals
      : matchedDeals.slice(offset, offset + limit);
    const truncated = !trimmedQuery && deals.length < matchedTotal;
    const hasMore = !trimmedQuery && offset + deals.length < matchedTotal;

    return {
      deals,
      stageLabels: lookups.stageLabels,
      pipelineLabels: lookups.pipelineLabels,
      total: matchedTotal,
      count: deals.length,
      query: trimmedQuery || null,
      filters,
      nextAfter: Array.isArray(dealResult) ? null : dealResult.nextAfter,
      ...(trimmedQuery
        ? {}
        : {
            limit,
            offset,
            truncated,
            hasMore,
            nextOffset: hasMore ? offset + deals.length : null,
          }),
      guidance: buildGuidance({
        query: trimmedQuery,
        structuredFilters,
        truncated,
        hasMore,
        total: matchedTotal,
        returned: deals.length,
        offset,
        limit,
      }),
      ...(Array.isArray(dealResult)
        ? {}
        : {
            searchedProperties: dealResult.properties,
          }),
    };
  },
});
