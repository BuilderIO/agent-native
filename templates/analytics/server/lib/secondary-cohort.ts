import { z } from "zod";

import { scopedCredentialCacheKey } from "./credentials-context";
import {
  batchGetAssociations,
  getAllDeals,
  getDealOwners,
  readHubSpotObjects,
  type Deal,
  type HubSpotObjectRecord,
} from "./hubspot";
import {
  getPylonSentimentMap,
  isRiskSentiment,
  type PylonSentimentEntry,
  type PylonSentimentMap,
} from "./pylon";

/** Caller-supplied HubSpot + Pylon property names for secondary cohort joins. */
function normalizeSecondaryCohortInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const raw = input as Record<string, unknown>;
  return {
    ...raw,
    dealProperty: raw.dealProperty ?? raw.statusProperty,
    dealPropertyValues: raw.dealPropertyValues ?? raw.activeStatusValues,
    pylonSentimentValues: raw.pylonSentimentValues ?? raw.pylonRiskSentiments,
    excludePastCloseDateForRollup:
      raw.excludePastCloseDateForRollup ?? raw.excludePastCloseDate,
  };
}

export const secondaryCohortConfigSchema = z.preprocess(
  normalizeSecondaryCohortInput,
  z.object({
    dealProperty: z.string().min(1),
    dealPropertyValues: z.array(z.string().min(1)).min(1),
    companyRootOrgIdProperty: z.string().min(1),
    companyDomainProperty: z.string().min(1),
    companySegmentProperty: z.string().min(1),
    companySegmentValue: z.string().min(1).optional(),
    pylonSentimentField: z.string().min(1),
    pylonRootOrgIdField: z.string().min(1),
    pylonDomainField: z.string().min(1),
    pylonSentimentValues: z.array(z.string().min(1)).min(1),
    ownerProperty: z.string().min(1),
    arrProperty: z.string().min(1),
    /** When true, ARR/dealCount/close-date rollups use only future-dated deals. */
    excludePastCloseDateForRollup: z.boolean().optional(),
  }),
);

export type SecondaryCohortConfig = z.infer<typeof secondaryCohortConfigSchema>;

export interface SecondaryCohortAccount {
  pylonAccountId: string;
  accountName: string;
  pylonSentiment: string;
  csmName: string | null;
  totalArr: number | null;
  earliestClosedate: string | null;
  dealCount: number;
}

interface CompanyInfo {
  rootOrgId: string | null;
  domain: string | null;
  accountProfile: string | null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toNumber(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function companyInfoFromRecord(
  company: HubSpotObjectRecord,
  config: SecondaryCohortConfig,
): CompanyInfo {
  return {
    rootOrgId: strOrNull(company.properties[config.companyRootOrgIdProperty]),
    domain:
      strOrNull(
        company.properties[config.companyDomainProperty],
      )?.toLowerCase() ?? null,
    accountProfile: strOrNull(
      company.properties[config.companySegmentProperty],
    ),
  };
}

async function buildDealCompanyMap(
  dealIds: string[],
  config: SecondaryCohortConfig,
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
    properties: [
      config.companyRootOrgIdProperty,
      config.companyDomainProperty,
      config.companySegmentProperty,
    ],
  });
  const companyById = new Map<string, CompanyInfo>();
  for (const company of companies) {
    companyById.set(company.id, companyInfoFromRecord(company, config));
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

function lookupPylon(
  company: CompanyInfo | undefined,
  pylonSentimentMap: PylonSentimentMap,
): PylonSentimentEntry | undefined {
  if (!company) return undefined;
  return (
    (company.rootOrgId && pylonSentimentMap.get(company.rootOrgId)) ||
    (company.domain && pylonSentimentMap.get(company.domain)) ||
    undefined
  );
}

function isSegmentMatch(
  info: CompanyInfo | undefined,
  config: SecondaryCohortConfig,
): boolean {
  if (!config.companySegmentValue?.trim()) return true;
  return info?.accountProfile === config.companySegmentValue;
}

function badSentimentAccountsById(
  pylonSentimentMap: PylonSentimentMap,
  config: SecondaryCohortConfig,
): Map<string, PylonSentimentEntry> {
  const byAccountId = new Map<string, PylonSentimentEntry>();
  for (const entry of pylonSentimentMap.values()) {
    if (!isRiskSentiment(entry.sentiment, config.pylonSentimentValues))
      continue;
    if (!byAccountId.has(entry.pylonAccountId)) {
      byAccountId.set(entry.pylonAccountId, entry);
    }
  }
  return byAccountId;
}

const ALL_DEAL_CONTEXT_CACHE_TTL_MS = 10 * 60 * 1000;
const allDealContextCache = new Map<
  string,
  {
    data: { allDeals: Deal[]; companyMap: Map<string, CompanyInfo> };
    ts: number;
  }
>();
const allDealContextInflight = new Map<
  string,
  Promise<{ allDeals: Deal[]; companyMap: Map<string, CompanyInfo> }>
>();

async function getAllDealContext(config: SecondaryCohortConfig): Promise<{
  allDeals: Deal[];
  companyMap: Map<string, CompanyInfo>;
}> {
  const cacheKey = scopedCredentialCacheKey(
    [
      "all-deal-context",
      config.companyRootOrgIdProperty,
      config.companyDomainProperty,
      config.companySegmentProperty,
      config.dealProperty,
      config.ownerProperty,
      config.arrProperty,
    ].join(":"),
    "HUBSPOT_ACCESS_TOKEN",
  );
  const cached = allDealContextCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ALL_DEAL_CONTEXT_CACHE_TTL_MS) {
    return cached.data;
  }

  const inflight = allDealContextInflight.get(cacheKey);
  if (inflight) return inflight;

  const promise = (async () => {
    const allDeals = await getAllDeals([
      config.dealProperty,
      config.ownerProperty,
      config.arrProperty,
      "closedate",
      "hubspot_owner_id",
    ]);
    const companyMap = await buildDealCompanyMap(
      allDeals.map((deal) => deal.id),
      config,
    );
    const data = { allDeals, companyMap };
    allDealContextCache.set(cacheKey, { data, ts: Date.now() });
    return data;
  })().finally(() => {
    allDealContextInflight.delete(cacheKey);
  });
  allDealContextInflight.set(cacheKey, promise);
  return promise;
}

function isFutureCloseDate(
  closedate: string | null | undefined,
  today: Date,
): boolean {
  if (!closedate) return true;
  return new Date(closedate) >= today;
}

async function computeSecondaryCohort(
  config: SecondaryCohortConfig,
): Promise<SecondaryCohortAccount[]> {
  const excludePastCloseDate = config.excludePastCloseDateForRollup !== false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const pylonFields = {
    sentimentField: config.pylonSentimentField,
    rootOrgIdField: config.pylonRootOrgIdField,
    domainField: config.pylonDomainField,
  };

  const [pylonSentimentMap, dealContext, owners] = await Promise.all([
    // Full map (all sentiments) — join lookups must resolve Pylon accounts even
    // when sentiment is not in the secondary cohort filter (e.g. already flagged).
    getPylonSentimentMap(pylonFields),
    getAllDealContext(config),
    getDealOwners(),
  ]);
  const { allDeals, companyMap: allDealCompanyMap } = dealContext;

  const badSentimentAccounts = badSentimentAccountsById(
    pylonSentimentMap,
    config,
  );
  if (!badSentimentAccounts.size) return [];

  // Scan all HubSpot deals for primary-property matches — not only a bounded
  // CRM search page — so secondary cohort excludes accounts already flagged.
  const hubspotFlaggedPylonIds = new Set<string>();
  for (const deal of allDeals) {
    const status = strOrNull(deal.properties[config.dealProperty]);
    if (!status || !config.dealPropertyValues.includes(status)) continue;
    const entry = lookupPylon(
      allDealCompanyMap.get(deal.id),
      pylonSentimentMap,
    );
    if (entry) hubspotFlaggedPylonIds.add(entry.pylonAccountId);
  }

  const enterprisePylonIds = new Set<string>();
  for (const deal of allDeals) {
    const company = allDealCompanyMap.get(deal.id);
    if (!isSegmentMatch(company, config)) continue;
    const entry = lookupPylon(company, pylonSentimentMap);
    if (entry) enterprisePylonIds.add(entry.pylonAccountId);
  }

  type DealRollup = {
    closedate: string | null;
    arr: number | null;
    csmName: string | null;
  };

  const accountDeals = new Map<string, DealRollup[]>();
  for (const deal of allDeals) {
    const company = allDealCompanyMap.get(deal.id);
    if (!isSegmentMatch(company, config)) continue;
    const entry = lookupPylon(company, pylonSentimentMap);
    if (
      !entry ||
      !isRiskSentiment(entry.sentiment, config.pylonSentimentValues) ||
      hubspotFlaggedPylonIds.has(entry.pylonAccountId)
    ) {
      continue;
    }
    if (
      excludePastCloseDate &&
      !isFutureCloseDate(deal.properties.closedate, today)
    ) {
      continue;
    }

    const ownerId = String(
      deal.properties[config.ownerProperty] ??
        deal.properties.hubspot_owner_id ??
        "",
    );
    const existing = accountDeals.get(entry.pylonAccountId) ?? [];
    existing.push({
      closedate: deal.properties.closedate ?? null,
      arr: toNumber(deal.properties[config.arrProperty]),
      csmName: ownerId ? (owners[ownerId] ?? null) : null,
    });
    accountDeals.set(entry.pylonAccountId, existing);
  }

  const results: SecondaryCohortAccount[] = [];
  for (const [pylonAccountId, entry] of badSentimentAccounts) {
    if (hubspotFlaggedPylonIds.has(pylonAccountId)) continue;
    if (!enterprisePylonIds.has(pylonAccountId)) continue;

    const deals = accountDeals.get(pylonAccountId) ?? [];
    deals.sort((a, b) => {
      if (!a.closedate && !b.closedate) return 0;
      if (!a.closedate) return 1;
      if (!b.closedate) return -1;
      return new Date(a.closedate).getTime() - new Date(b.closedate).getTime();
    });

    const soonest = deals[0] ?? null;
    const totalArr =
      deals.reduce((sum, deal) => sum + (deal.arr ?? 0), 0) || null;

    results.push({
      pylonAccountId,
      accountName: entry.accountName || pylonAccountId,
      pylonSentiment: entry.sentiment,
      csmName: soonest?.csmName ?? null,
      totalArr,
      earliestClosedate: soonest?.closedate ?? null,
      dealCount: deals.length,
    });
  }

  results.sort((a, b) => {
    if (!a.earliestClosedate && !b.earliestClosedate) return 0;
    if (!a.earliestClosedate) return 1;
    if (!b.earliestClosedate) return -1;
    return (
      new Date(a.earliestClosedate).getTime() -
      new Date(b.earliestClosedate).getTime()
    );
  });

  return results;
}

const SECONDARY_COHORT_CACHE_TTL_MS = 10 * 60 * 1000;
const secondaryCohortCache = new Map<
  string,
  { data: SecondaryCohortAccount[]; ts: number }
>();
const secondaryCohortInflight = new Map<
  string,
  Promise<SecondaryCohortAccount[]>
>();

function secondaryCohortCacheKey(config: SecondaryCohortConfig): string {
  return scopedCredentialCacheKey(
    [
      "secondary-cohort:v6",
      config.pylonSentimentField,
      config.pylonSentimentValues.join(","),
      config.companySegmentValue,
      config.dealProperty,
      config.dealPropertyValues.join(","),
      String(config.excludePastCloseDateForRollup !== false),
    ].join(":"),
    "HUBSPOT_ACCESS_TOKEN",
  );
}

/** Join a secondary provider cohort to HubSpot deals; exclude primary-property matches. */
export async function buildSecondaryCohort(
  config: SecondaryCohortConfig,
): Promise<SecondaryCohortAccount[]> {
  const cacheKey = secondaryCohortCacheKey(config);
  const cached = secondaryCohortCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SECONDARY_COHORT_CACHE_TTL_MS) {
    return cached.data;
  }

  const inflight = secondaryCohortInflight.get(cacheKey);
  if (inflight) return inflight;

  const promise = computeSecondaryCohort(config)
    .then((accounts) => {
      secondaryCohortCache.set(cacheKey, { data: accounts, ts: Date.now() });
      return accounts;
    })
    .finally(() => {
      secondaryCohortInflight.delete(cacheKey);
    });
  secondaryCohortInflight.set(cacheKey, promise);
  return promise;
}
