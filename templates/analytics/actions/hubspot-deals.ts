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

export default defineAction({
  description:
    "Get HubSpot deals with normalized stage, pipeline, owner, forecast, and NBM fields. Use query for a specific customer/deal/account deep dive instead of fetching all deals.",
  schema: z.object({
    properties: StringListSchema.describe(
      "Optional comma-separated extra HubSpot deal property names to include.",
    ),
    owner: z
      .string()
      .optional()
      .describe("Optional owner name filter, case-insensitive."),
    query: z
      .string()
      .optional()
      .describe(
        "Optional HubSpot deal search query, such as a company name, deal name, domain, or keyword. Use for customer/deal deep dives.",
      ),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe("Maximum records to return when query is provided."),
    after: z
      .string()
      .optional()
      .describe("Optional HubSpot pagination cursor for query results."),
  }),
  http: { method: "GET" },
  run: async ({ properties, owner, query, limit = 25, after }) => {
    const trimmedQuery = query?.trim();
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
    const deals = rawDeals
      .filter(
        (d) => trimmedQuery || visibleIds.has(String(d.properties.pipeline)),
      )
      .map((deal) => enrichDeal(deal, lookups, owners))
      .filter((deal) => {
        if (!ownerFilter) return true;
        const ownerName = String(
          deal.properties.owner_name ?? "",
        ).toLowerCase();
        return ownerName === ownerFilter;
      });

    return {
      deals,
      stageLabels: lookups.stageLabels,
      pipelineLabels: lookups.pipelineLabels,
      total: Array.isArray(dealResult) ? deals.length : dealResult.total,
      count: deals.length,
      query: trimmedQuery || null,
      nextAfter: Array.isArray(dealResult) ? null : dealResult.nextAfter,
      ...(Array.isArray(dealResult)
        ? {}
        : {
            searchedProperties: dealResult.properties,
            guidance:
              "Searched HubSpot deals directly for the named account/deal. For a deep dive, enrich these deal records with hubspot-records for associated company/contact/ticket context when needed.",
          }),
    };
  },
});
