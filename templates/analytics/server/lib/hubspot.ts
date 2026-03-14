// HubSpot CRM API helper
// Fetches deals, pipelines/stages, and computes sales metrics

const API_BASE = "https://api.hubapi.com";

// In-memory cache
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE = 120;

function getToken(): string {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN env var required");
  return token;
}

async function apiGet<T>(path: string, cacheKey?: string): Promise<T> {
  const key = cacheKey ?? path;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });

  return data as T;
}

// -- Types --

export interface DealStage {
  id: string;
  label: string;
  displayOrder: number;
  metadata?: { probability?: string };
}

export interface Pipeline {
  id: string;
  label: string;
  stages: DealStage[];
}

export interface Deal {
  id: string;
  properties: {
    dealname: string;
    dealstage: string;
    amount: string | null;
    closedate: string | null;
    createdate: string;
    hs_lastmodifieddate: string;
    pipeline: string;
    hubspot_owner_id: string | null;
    hs_deal_stage_probability: string | null;
    [key: string]: string | null | undefined;
  };
}

interface HubSpotListResponse {
  results: Deal[];
  paging?: { next?: { after: string } };
}

interface PipelineListResponse {
  results: {
    id: string;
    label: string;
    stages: {
      id: string;
      label: string;
      displayOrder: number;
      metadata?: { probability?: string };
    }[];
  }[];
}

// -- API functions --

const DEAL_PROPERTIES = [
  "dealname",
  "dealstage",
  "amount",
  "closedate",
  "createdate",
  "hs_lastmodifieddate",
  "pipeline",
  "hubspot_owner_id",
  "hs_deal_stage_probability",
  // POV stage entry dates (hs_v2_date_entered_{stageId})
  "hs_v2_date_entered_2121599", // Enterprise: New Business — S2 - Proof of Value
  "hs_v2_date_entered_1166928645", // Enterprise: Expansion — S2 - Proof of Value
];

export async function getDealPipelines(): Promise<Pipeline[]> {
  const data = await apiGet<PipelineListResponse>(
    "/crm/v3/pipelines/deals",
    "pipelines",
  );
  return data.results.map((p) => ({
    id: p.id,
    label: p.label,
    stages: p.stages
      .map((s) => ({
        id: s.id,
        label: s.label,
        displayOrder: s.displayOrder,
        metadata: s.metadata,
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder),
  }));
}

// Pipelines to exclude from metrics — single-stage auto-complete or non-core
const EXCLUDED_PIPELINE_LABELS = [
  "self-serve: new subscription",
  "self-serve: expansion",
  "self-serve: downgrade",
  "partner onboarding pipeline",
];

// Pipelines to hide from the Kanban board
const HIDDEN_KANBAN_LABELS = [
  "self serve pipeline",
  "enterprise: white label",
  "partner deal pipeline",
  "partner onboarding pipeline",
  "self-serve: new subscription",
  "self-serve: expansion",
  "self-serve: downgrade",
];

export function getVisiblePipelines(pipelines: Pipeline[]): Pipeline[] {
  return pipelines.filter(
    (p) => !HIDDEN_KANBAN_LABELS.includes(p.label.toLowerCase()),
  );
}

export function getMetricsPipelines(pipelines: Pipeline[]): Pipeline[] {
  return pipelines.filter(
    (p) => !EXCLUDED_PIPELINE_LABELS.includes(p.label.toLowerCase()),
  );
}

export async function getAllDeals(): Promise<Deal[]> {
  // Check full-result cache first
  const fullCacheKey = "all-deals-full";
  const cached = cache.get(fullCacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as Deal[];
  }

  const all: Deal[] = [];
  let after: string | undefined;
  const props = DEAL_PROPERTIES.join(",");

  // Paginate through all deals (up to 10K)
  for (let i = 0; i < 100; i++) {
    const url = `/crm/v3/objects/deals?limit=100&properties=${props}${after ? `&after=${after}` : ""}`;
    const res = await fetch(`${API_BASE}${url}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HubSpot API error ${res.status}: ${text}`);
    }
    const data = (await res.json()) as HubSpotListResponse;
    all.push(...data.results);
    after = data.paging?.next?.after;
    if (!after) break;
  }

  // Cache the full result
  cache.set(fullCacheKey, { data: all, ts: Date.now() });
  return all;
}

// -- Computed metrics --

// Known POV stage IDs — used for hs_v2_date_entered_ lookups
const POV_STAGE_IDS = [
  "2121599", // Enterprise: New Business
  "1166928645", // Enterprise: Expansion
];

export interface SalesMetrics {
  totalDeals: number;
  totalPipelineValue: number;
  openDeals: number;
  openPipelineValue: number;
  wonDeals: number;
  wonValue: number;
  lostDeals: number;
  lostValue: number;
  avgDealSize: number;
  landingAcv: number;
  winRate: number;
  povSuccessRate: number;
  povEntered: number;
  povWon: number;
  dealsByStage: {
    stageId: string;
    stageLabel: string;
    count: number;
    value: number;
  }[];
}

export function computeSalesMetrics(
  deals: Deal[],
  pipelines: Pipeline[],
  filterToMetricsPipelines = true,
): SalesMetrics {
  // Filter deals to only enterprise/relevant pipelines for metrics
  const metricsPipelines = filterToMetricsPipelines
    ? getMetricsPipelines(pipelines)
    : pipelines;
  const metricsPipelineIds = new Set(metricsPipelines.map((p) => p.id));
  const filteredDeals = deals.filter((d) =>
    metricsPipelineIds.has(d.properties.pipeline),
  );
  // Build stage lookup — keyed by stageId
  const stageMap = new Map<string, DealStage>();
  const wonStageIds = new Set<string>();
  const lostStageIds = new Set<string>();

  // Per-pipeline POV info: pipelineId -> { povStageOrder, povStageId }
  const pipelinePov = new Map<string, { order: number; id: string }>();
  // Map stageId -> pipelineId
  const stageToPipeline = new Map<string, string>();

  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) {
      stageMap.set(stage.id, stage);
      stageToPipeline.set(stage.id, pipeline.id);
      const label = stage.label.toLowerCase();
      const prob = parseFloat(stage.metadata?.probability ?? "");
      if (prob === 1 || label.includes("closed won") || label === "won") {
        wonStageIds.add(stage.id);
      }
      if (prob === 0 || label.includes("closed lost") || label === "lost") {
        lostStageIds.add(stage.id);
      }
      // Identify POV/PoC stage per pipeline
      if (
        label.includes("proof of value") ||
        label.includes("pov") ||
        label === "poc"
      ) {
        pipelinePov.set(pipeline.id, {
          order: stage.displayOrder,
          id: stage.id,
        });
      }
    }
  }

  let totalPipelineValue = 0;
  let openDeals = 0;
  let openPipelineValue = 0;
  let wonDeals = 0;
  let wonValue = 0;
  let lostDeals = 0;
  let lostValue = 0;

  // POV tracking using actual stage entry dates (hs_v2_date_entered_)
  let povEntered = 0;
  let povWon = 0;

  const stageCount = new Map<string, { count: number; value: number }>();

  // Track won deal amounts for ACV calculation
  const wonAmounts: number[] = [];

  for (const deal of filteredDeals) {
    const amount = parseFloat(deal.properties.amount ?? "0") || 0;
    const stageId = deal.properties.dealstage;

    totalPipelineValue += amount;

    // Count by stage
    const existing = stageCount.get(stageId) ?? { count: 0, value: 0 };
    existing.count++;
    existing.value += amount;
    stageCount.set(stageId, existing);

    if (wonStageIds.has(stageId)) {
      wonDeals++;
      wonValue += amount;
      if (amount > 0) wonAmounts.push(amount);
    } else if (lostStageIds.has(stageId)) {
      lostDeals++;
      lostValue += amount;
    } else {
      openDeals++;
      openPipelineValue += amount;
    }

    // POV success: check hs_v2_date_entered_ for each known POV stage
    const enteredPov = POV_STAGE_IDS.some(
      (sid) => !!deal.properties[`hs_v2_date_entered_${sid}`],
    );
    if (enteredPov) {
      povEntered++;
      if (wonStageIds.has(stageId)) {
        povWon++;
      }
    }
  }

  const closedDeals = wonDeals + lostDeals;
  const winRate = closedDeals > 0 ? wonDeals / closedDeals : 0;
  const avgDealSize =
    wonAmounts.length > 0
      ? wonAmounts.reduce((a, b) => a + b, 0) / wonAmounts.length
      : 0;
  // Landing ACV: median of won deal amounts (less skewed by outliers)
  const sortedAmounts = [...wonAmounts].sort((a, b) => a - b);
  const landingAcv =
    sortedAmounts.length > 0
      ? sortedAmounts[Math.floor(sortedAmounts.length / 2)]
      : 0;
  const povSuccessRate = povEntered > 0 ? povWon / povEntered : 0;

  // Build stage breakdown
  const dealsByStage: SalesMetrics["dealsByStage"] = [];
  for (const [stageId, data] of stageCount) {
    const stage = stageMap.get(stageId);
    dealsByStage.push({
      stageId,
      stageLabel: stage?.label ?? stageId,
      count: data.count,
      value: data.value,
    });
  }
  dealsByStage.sort((a, b) => {
    const aOrder = stageMap.get(a.stageId)?.displayOrder ?? 999;
    const bOrder = stageMap.get(b.stageId)?.displayOrder ?? 999;
    return aOrder - bOrder;
  });

  return {
    totalDeals: filteredDeals.length,
    totalPipelineValue,
    openDeals,
    openPipelineValue,
    wonDeals,
    wonValue,
    lostDeals,
    lostValue,
    avgDealSize,
    landingAcv,
    winRate,
    povSuccessRate,
    povEntered,
    povWon,
    dealsByStage,
  };
}
