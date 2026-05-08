import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getAllDeals,
  getDealPipelines,
  getDealOwners,
  getVisiblePipelines,
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

export default defineAction({
  description:
    "Get all HubSpot deals with normalized stage, pipeline, owner, forecast, and NBM fields.",
  schema: z.object({
    properties: StringListSchema.describe(
      "Optional comma-separated extra HubSpot deal property names to include.",
    ),
    owner: z
      .string()
      .optional()
      .describe("Optional owner name filter, case-insensitive."),
  }),
  http: { method: "GET" },
  run: async ({ properties, owner }) => {
    const [allDeals, allPipelines, owners] = await Promise.all([
      getAllDeals(properties),
      getDealPipelines(),
      getDealOwners(),
    ]);

    const visiblePipelines = getVisiblePipelines(allPipelines);
    const visibleIds = new Set(visiblePipelines.map((p) => p.id));
    const lookups = stageLookups(visiblePipelines);
    const ownerFilter = owner?.trim().toLowerCase();
    const deals = allDeals
      .filter((d) => visibleIds.has(d.properties.pipeline))
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
      total: deals.length,
    };
  },
});
