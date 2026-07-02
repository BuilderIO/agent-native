import {
  batchGetAssociations,
  getAllDeals,
  getDealOwners,
  getDealPipelines,
  getVisiblePipelines,
  readHubSpotObjects,
  searchHubSpotDealsByRiskStatuses,
  type Deal,
  type Pipeline,
} from "./hubspot";
import {
  getPylonSentimentMap,
  isRiskSentiment,
  type PylonSentimentMap,
} from "./pylon";

// Renewal deals a CSM has flagged in HubSpot; sorted longest-in-status first.
const ACTIVE_RISK_STATUSES = [
  "On the Radar",
  "Churn Risk",
  "Confirmed Churn",
  "No Save Attempted",
] as const;

const RISK_DEAL_PROPERTIES = [
  "risk_status",
  "risk_summary",
  "risk_category",
  "risk_status_last_updated",
  "hs_next_step",
  "churn_notes",
  "total_contract_value",
  "customer_success_owner",
  "dealname",
  "dealstage",
  "closedate",
  "pipeline",
  "hubspot_owner_id",
];

export interface RiskDeal {
  id: string;
  dealname: string;
  riskStatus: (typeof ACTIVE_RISK_STATUSES)[number];
  riskSummary: string | null;
  riskCategory: string | null;
  nextStep: string | null;
  churnNotes: string | null;
  daysInCurrentRiskStatus: number;
  riskStatusLastUpdated: string | null;
  csmName: string | null;
  dealStageLabel: string | null;
  arr: number | null;
  closedate: string | null;
  pipeline: string | null;
  pylonSentiment: string | null;
  pylonAccountId: string | null;
}

export interface PylonEarlyWarningAccount {
  pylonAccountId: string;
  accountName: string;
  pylonSentiment: string;
  csmName: string | null;
  totalArr: number | null;
  earliestClosedate: string | null;
  dealCount: number;
}

export interface RiskMeetingData {
  deals: RiskDeal[];
  pylonOnlyDeals: PylonEarlyWarningAccount[];
  total: number;
}

interface CompanyInfo {
  domain: string | null;
  type: string | null;
  lifecyclestage: string | null;
}

function toNumber(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function daysSince(ms: number): number {
  return Math.max(0, Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000)));
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isPastCloseDate(closedate: string | null | undefined): boolean {
  if (!closedate) return false;
  const ms = Date.parse(closedate);
  return Number.isFinite(ms) && ms < Date.now();
}

function stageLookups(pipelines: Pipeline[]) {
  const stageLabels: Record<string, string> = {};
  const pipelineLabels: Record<string, string> = {};
  for (const pipeline of pipelines) {
    pipelineLabels[pipeline.id] = pipeline.label;
    for (const stage of pipeline.stages) {
      stageLabels[stage.id] = stage.label || stage.id;
    }
  }
  return { stageLabels, pipelineLabels };
}

// Joins deals to their primary company's domain (and profile) with batched
// association reads so a cohort of N deals costs O(N/100) HTTP calls instead
// of N — required to stay inside the 30s extension iframe budget.
async function buildDealCompanyMap(
  dealIds: string[],
): Promise<Map<string, CompanyInfo>> {
  const result = new Map<string, CompanyInfo>();
  if (!dealIds.length) return result;

  const dealToCompanies = await batchGetAssociations({
    fromObjectType: "deals",
    toObjectType: "companies",
    fromObjectIds: dealIds,
  });

  const companyIds = Array.from(
    new Set(Array.from(dealToCompanies.values()).flat()),
  );
  if (!companyIds.length) return result;

  const companies = await readHubSpotObjects({
    objectType: "companies",
    ids: companyIds,
    properties: ["domain", "type", "lifecyclestage"],
  });
  const companyById = new Map<string, CompanyInfo>();
  for (const company of companies) {
    const domain = company.properties.domain;
    companyById.set(company.id, {
      domain:
        typeof domain === "string" && domain.trim()
          ? domain.trim().toLowerCase()
          : null,
      type:
        typeof company.properties.type === "string"
          ? company.properties.type
          : null,
      lifecyclestage:
        typeof company.properties.lifecyclestage === "string"
          ? company.properties.lifecyclestage
          : null,
    });
  }

  for (const [dealId, associatedCompanyIds] of dealToCompanies) {
    const primaryCompanyId = associatedCompanyIds[0];
    const info = primaryCompanyId
      ? companyById.get(primaryCompanyId)
      : undefined;
    if (info) result.set(dealId, info);
  }

  return result;
}

// Best-effort classification of the Fusion "Enterprise Active Customer"
// segment from the standard HubSpot company `type` / `lifecyclestage` fields.
function isEnterpriseActiveCustomer(info: CompanyInfo | undefined): boolean {
  if (!info) return false;
  const type = (info.type ?? "").toLowerCase();
  const lifecycle = (info.lifecyclestage ?? "").toLowerCase();
  return type.includes("enterprise") && lifecycle.includes("customer");
}

export async function getRiskDeals(
  pylonSentimentMap: PylonSentimentMap,
): Promise<RiskDeal[]> {
  const allDeals: Deal[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const { deals, nextAfter } = await searchHubSpotDealsByRiskStatuses({
      riskStatuses: [...ACTIVE_RISK_STATUSES],
      limit: 100,
      after,
      extraProperties: RISK_DEAL_PROPERTIES,
    });
    allDeals.push(...deals);
    if (!nextAfter) break;
    after = nextAfter;
  }

  const activeStatuses = new Set<string>(ACTIVE_RISK_STATUSES);
  const candidateDeals = allDeals.filter((deal) => {
    const status = String(deal.properties.risk_status ?? "").trim();
    if (!activeStatuses.has(status)) return false;
    return !isPastCloseDate(deal.properties.closedate);
  });

  const [allPipelines, owners, companyByDeal] = await Promise.all([
    getDealPipelines(),
    getDealOwners(),
    buildDealCompanyMap(candidateDeals.map((deal) => deal.id)),
  ]);
  const lookups = stageLookups(getVisiblePipelines(allPipelines));

  const riskDeals: RiskDeal[] = candidateDeals.map((deal) => {
    const props = deal.properties;
    const stageId = String(props.dealstage ?? "");
    const pipelineId = String(props.pipeline ?? "");
    const lastUpdatedMs = Number(props.risk_status_last_updated ?? "");
    const hasLastUpdated = Number.isFinite(lastUpdatedMs) && lastUpdatedMs > 0;
    const ownerId = String(
      props.customer_success_owner ?? props.hubspot_owner_id ?? "",
    );
    const company = companyByDeal.get(deal.id);
    const pylonEntry = company?.domain
      ? pylonSentimentMap.byDomain.get(company.domain)
      : undefined;

    return {
      id: deal.id,
      dealname: props.dealname ?? "",
      riskStatus: String(props.risk_status ?? "") as RiskDeal["riskStatus"],
      riskSummary: props.risk_summary ?? null,
      riskCategory: props.risk_category ?? null,
      nextStep: props.hs_next_step ?? null,
      churnNotes: props.churn_notes ?? null,
      daysInCurrentRiskStatus: hasLastUpdated ? daysSince(lastUpdatedMs) : 0,
      riskStatusLastUpdated: hasLastUpdated ? toIsoDate(lastUpdatedMs) : null,
      csmName: ownerId ? (owners[ownerId] ?? null) : null,
      dealStageLabel: lookups.stageLabels[stageId] ?? (stageId || null),
      arr: toNumber(props.total_contract_value),
      closedate: props.closedate ?? null,
      pipeline: pipelineId
        ? (lookups.pipelineLabels[pipelineId] ?? pipelineId)
        : null,
      pylonSentiment: pylonEntry?.sentiment ?? null,
      pylonAccountId: pylonEntry?.pylonAccountId ?? null,
    };
  });

  riskDeals.sort(
    (a, b) => b.daysInCurrentRiskStatus - a.daysInCurrentRiskStatus,
  );

  return riskDeals;
}

export async function getPylonOnlyRiskDeals(
  pylonSentimentMap: PylonSentimentMap,
  flaggedPylonAccountIds: Set<string>,
): Promise<PylonEarlyWarningAccount[]> {
  const hasRiskAccounts = Array.from(pylonSentimentMap.byDomain.values()).some(
    (entry) =>
      isRiskSentiment(entry.sentiment) &&
      !flaggedPylonAccountIds.has(entry.pylonAccountId),
  );
  if (!hasRiskAccounts) return [];

  const [allDeals, owners] = await Promise.all([
    getAllDeals(["customer_success_owner", "total_contract_value"]),
    getDealOwners(),
  ]);

  const companyByDeal = await buildDealCompanyMap(
    allDeals.map((deal) => deal.id),
  );

  interface Accumulator extends PylonEarlyWarningAccount {
    earliestCloseMs: number;
  }

  const byAccountId = new Map<string, Accumulator>();

  for (const deal of allDeals) {
    const company = companyByDeal.get(deal.id);
    if (!company?.domain) continue;
    if (!isEnterpriseActiveCustomer(company)) continue;

    const entry = pylonSentimentMap.byDomain.get(company.domain);
    if (!entry || !isRiskSentiment(entry.sentiment)) continue;
    if (flaggedPylonAccountIds.has(entry.pylonAccountId)) continue;

    const props = deal.properties;
    const ownerId = String(
      props.customer_success_owner ?? props.hubspot_owner_id ?? "",
    );
    const arr = toNumber(props.total_contract_value) ?? 0;
    const closedate = props.closedate ?? null;
    const closeMs = closedate ? Date.parse(closedate) : NaN;

    const existing = byAccountId.get(entry.pylonAccountId);
    if (!existing) {
      byAccountId.set(entry.pylonAccountId, {
        pylonAccountId: entry.pylonAccountId,
        accountName: entry.accountName,
        pylonSentiment: entry.sentiment,
        csmName: ownerId ? (owners[ownerId] ?? null) : null,
        totalArr: arr,
        earliestClosedate: closedate,
        dealCount: 1,
        earliestCloseMs: Number.isFinite(closeMs) ? closeMs : Infinity,
      });
      continue;
    }

    existing.totalArr = (existing.totalArr ?? 0) + arr;
    existing.dealCount += 1;
    if (!existing.csmName && ownerId) {
      existing.csmName = owners[ownerId] ?? null;
    }
    if (Number.isFinite(closeMs) && closeMs < existing.earliestCloseMs) {
      existing.earliestCloseMs = closeMs;
      existing.earliestClosedate = closedate;
    }
  }

  const results = Array.from(byAccountId.values());
  results.sort((a, b) => a.earliestCloseMs - b.earliestCloseMs);
  return results.map(({ earliestCloseMs: _earliestCloseMs, ...rest }) => rest);
}

export async function getRiskMeetingData(): Promise<RiskMeetingData> {
  const pylonSentimentMap = await getPylonSentimentMap();
  const deals = await getRiskDeals(pylonSentimentMap);
  const flaggedPylonAccountIds = new Set(
    deals
      .map((deal) => deal.pylonAccountId)
      .filter((id): id is string => Boolean(id)),
  );
  const pylonOnlyDeals = await getPylonOnlyRiskDeals(
    pylonSentimentMap,
    flaggedPylonAccountIds,
  );

  return {
    deals,
    pylonOnlyDeals,
    total: deals.length,
  };
}
