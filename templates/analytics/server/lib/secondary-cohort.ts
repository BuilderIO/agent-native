import { z } from "zod";

import { scopedCredentialCacheKey } from "./credentials-context";
import {
  batchGetAssociations,
  getDealOwners,
  readHubSpotObjects,
  searchHubSpotCompaniesByProperty,
  searchHubSpotDealsByPropertyValues,
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

function uniqueMatchingPylonEntries(
  pylonSentimentMap: PylonSentimentMap,
  config: SecondaryCohortConfig,
): PylonSentimentEntry[] {
  const byAccountId = new Map<string, PylonSentimentEntry>();
  for (const entry of pylonSentimentMap.values()) {
    if (!isRiskSentiment(entry.sentiment, config.pylonSentimentValues))
      continue;
    if (!byAccountId.has(entry.pylonAccountId)) {
      byAccountId.set(entry.pylonAccountId, entry);
    }
  }
  return Array.from(byAccountId.values());
}

async function fetchDealsByPropertyValues(
  config: SecondaryCohortConfig,
): Promise<Deal[]> {
  const deals: Deal[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await searchHubSpotDealsByPropertyValues({
      propertyValues: config.dealPropertyValues,
      propertyName: config.dealProperty,
      limit: 100,
      after,
      extraProperties: [config.dealProperty],
    });
    deals.push(...result.deals);
    after = result.nextAfter ?? undefined;
    if (!after) break;
  }
  return deals;
}

async function findEnterpriseCompaniesForJoinKeys(
  entries: PylonSentimentEntry[],
  config: SecondaryCohortConfig,
): Promise<Map<string, CompanyInfo>> {
  const companyById = new Map<string, CompanyInfo>();
  const rootOrgIds = Array.from(
    new Set(
      entries
        .map((entry) => entry.rootOrgId)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const domains = Array.from(
    new Set(
      entries
        .map((entry) => entry.domain)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const companyProps = [
    config.companyRootOrgIdProperty,
    config.companyDomainProperty,
    config.companySegmentProperty,
  ];

  const ingest = (records: HubSpotObjectRecord[]) => {
    for (const company of records) {
      const info = companyInfoFromRecord(company, config);
      if (!isSegmentMatch(info, config)) continue;
      companyById.set(company.id, info);
    }
  };

  for (let i = 0; i < rootOrgIds.length; i += 50) {
    ingest(
      await searchHubSpotCompaniesByProperty({
        propertyName: config.companyRootOrgIdProperty,
        operator: "IN",
        values: rootOrgIds.slice(i, i + 50),
        properties: companyProps,
        limit: 100,
      }),
    );
  }

  for (let i = 0; i < domains.length; i += 50) {
    ingest(
      await searchHubSpotCompaniesByProperty({
        propertyName: config.companyDomainProperty,
        operator: "IN",
        values: domains.slice(i, i + 50),
        properties: companyProps,
        limit: 100,
      }),
    );
  }

  return companyById;
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
      "secondary-cohort:v3",
      config.pylonSentimentField,
      config.pylonSentimentValues.join(","),
      config.companySegmentValue,
      config.dealProperty,
      config.dealPropertyValues.join(","),
    ].join(":"),
    "HUBSPOT_ACCESS_TOKEN",
  );
}

async function computeSecondaryCohort(
  config: SecondaryCohortConfig,
): Promise<SecondaryCohortAccount[]> {
  const [pylonSentimentMap, flaggedDeals, owners] = await Promise.all([
    getPylonSentimentMap({
      sentimentField: config.pylonSentimentField,
      rootOrgIdField: config.pylonRootOrgIdField,
      domainField: config.pylonDomainField,
    }),
    fetchDealsByPropertyValues(config),
    getDealOwners(),
  ]);

  const riskEntries = uniqueMatchingPylonEntries(pylonSentimentMap, config);
  if (!riskEntries.length) return [];

  const flaggedCompanyMap = await buildDealCompanyMap(
    flaggedDeals.map((deal) => deal.id),
    config,
  );
  const flaggedPylonAccountIds = new Set<string>();
  for (const deal of flaggedDeals) {
    const entry = lookupPylon(
      flaggedCompanyMap.get(deal.id),
      pylonSentimentMap,
    );
    if (entry) flaggedPylonAccountIds.add(entry.pylonAccountId);
  }

  const candidateEntries = riskEntries.filter(
    (entry) => !flaggedPylonAccountIds.has(entry.pylonAccountId),
  );
  if (!candidateEntries.length) return [];

  const companyById = await findEnterpriseCompaniesForJoinKeys(
    candidateEntries,
    config,
  );
  if (!companyById.size) return [];

  const companyToDeals = await batchGetAssociations({
    fromObjectType: "companies",
    toObjectType: "deals",
    fromObjectIds: Array.from(companyById.keys()),
  });

  const dealIds = Array.from(
    new Set(Array.from(companyToDeals.values()).flat()),
  );
  if (!dealIds.length) return [];

  const dealRecords = await readHubSpotObjects({
    objectType: "deals",
    ids: dealIds,
    properties: [
      config.ownerProperty,
      config.arrProperty,
      "closedate",
      "hubspot_owner_id",
    ],
  });
  const dealById = new Map(
    dealRecords.map((record) => [
      record.id,
      {
        id: record.id,
        properties: record.properties as Deal["properties"],
      } satisfies Deal,
    ]),
  );

  interface Accumulator extends SecondaryCohortAccount {
    earliestCloseMs: number;
  }

  const byAccountId = new Map<string, Accumulator>();

  for (const [companyId, company] of companyById) {
    const entry = lookupPylon(company, pylonSentimentMap);
    if (
      !entry ||
      !isRiskSentiment(entry.sentiment, config.pylonSentimentValues) ||
      flaggedPylonAccountIds.has(entry.pylonAccountId)
    ) {
      continue;
    }

    for (const dealId of companyToDeals.get(companyId) ?? []) {
      const deal = dealById.get(dealId);
      if (!deal) continue;

      const props = deal.properties;
      const ownerId = String(
        props[config.ownerProperty] ?? props.hubspot_owner_id ?? "",
      );
      const arr = toNumber(props[config.arrProperty]) ?? 0;
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
  }

  const results = Array.from(byAccountId.values());
  results.sort((a, b) => a.earliestCloseMs - b.earliestCloseMs);
  return results.map(({ earliestCloseMs: _earliestCloseMs, ...rest }) => rest);
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
