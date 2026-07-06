import {
  requireRequestCredentialContext,
  scopedCredentialCacheKey,
} from "./credentials-context";
import {
  HUBSPOT_ANALYTICS_CREDENTIAL_KEYS,
  resolveAnalyticsProviderCredential,
} from "./provider-credentials";

const API_BASE = "https://api.hubapi.com";

// In-memory cache
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE = 120;

async function getToken(): Promise<string> {
  const ctx = requireRequestCredentialContext("HUBSPOT_PRIVATE_APP_TOKEN");
  const credential = await resolveAnalyticsProviderCredential({
    provider: "hubspot",
    keys: HUBSPOT_ANALYTICS_CREDENTIAL_KEYS,
    ctx,
  });
  if (!credential) {
    throw new Error(
      "HUBSPOT_PRIVATE_APP_TOKEN or HUBSPOT_ACCESS_TOKEN not configured",
    );
  }
  return credential.value;
}

async function hubspotFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "1", 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    return res;
  }
  throw new Error("HubSpot rate limit: max retries exceeded");
}

async function apiGet<T>(path: string, cacheKey?: string): Promise<T> {
  const key = scopedCredentialCacheKey(
    cacheKey ?? path,
    "HUBSPOT_ACCESS_TOKEN",
  );
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const res = await hubspotFetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${await getToken()}` },
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

async function apiPost<T>(
  path: string,
  body: unknown,
  cacheKey?: string,
): Promise<T> {
  const key = scopedCredentialCacheKey(
    cacheKey ?? `POST:${path}:${JSON.stringify(body)}`,
    "HUBSPOT_ACCESS_TOKEN",
  );
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const res = await hubspotFetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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

export const HUBSPOT_OBJECT_TYPES = [
  "contacts",
  "companies",
  "deals",
  "tickets",
] as const;

export type HubSpotObjectType = (typeof HUBSPOT_OBJECT_TYPES)[number];
export type HubSpotAssociatedObjectType =
  | HubSpotObjectType
  | "notes"
  | "emails";

function isHubSpotObjectType(
  objectType: HubSpotAssociatedObjectType,
): objectType is HubSpotObjectType {
  return (HUBSPOT_OBJECT_TYPES as readonly string[]).includes(objectType);
}

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

export interface HubSpotOwner {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  userId?: number;
}

export interface HubSpotDealProperty {
  name: string;
  label: string;
  type?: string;
  fieldType?: string;
  description?: string;
}

export interface HubSpotObjectRecord {
  id: string;
  properties: Record<string, string | null | undefined>;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
}

interface HubSpotListResponse {
  results: Deal[];
  paging?: { next?: { after: string } };
}

interface HubSpotObjectListResponse {
  results: HubSpotObjectRecord[];
  total?: number;
  paging?: { next?: { after: string } };
}

interface HubSpotOwnerListResponse {
  results: HubSpotOwner[];
  paging?: { next?: { after: string } };
}

interface HubSpotDealPropertyListResponse {
  results: HubSpotDealProperty[];
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

const REQUIRED_DEAL_PROPERTIES = [
  "dealname",
  "dealstage",
  "amount",
  "closedate",
  "createdate",
  "hs_lastmodifieddate",
  "pipeline",
  "hubspot_owner_id",
  "hs_deal_stage_probability",
];

const OPTIONAL_DEAL_PROPERTIES = [
  "hs_object_id",
  "associatedcompanyid",
  "company_name",
  "hs_primary_company_name",
  "hs_deal_stage_probability_label",
  "hs_manual_forecast_category",
  "nbm_meeting_booked_date",
  "nbm_meeting_complete_date",
  "products",
  "closed_lost_reason",
  "hs_closed_lost_reason",
  "closed_lost_detail_reason",
  "notes_last_updated",
  "notes_last_contacted",
  "num_associated_contacts",
  "num_notes",
  "hs_next_step",
  "risk_status",
  "risk_summary",
  "risk_category",
  "risk_status_last_updated",
  "total_contract_value",
  "churn_notes",
  "customer_success_owner",
  // POV stage entry dates (hs_v2_date_entered_{stageId})
  "hs_v2_date_entered_2121599", // Enterprise: New Business — S2 - Proof of Value
  "hs_v2_date_entered_1166928645", // Enterprise: Expansion — S2 - Proof of Value
];

const DEFAULT_OBJECT_PROPERTIES: Record<HubSpotObjectType, string[]> = {
  contacts: [
    "hs_object_id",
    "email",
    "firstname",
    "lastname",
    "company",
    "jobtitle",
    "phone",
    "lifecyclestage",
    "hubspot_owner_id",
    "createdate",
    "lastmodifieddate",
    "hs_lead_status",
    "hubspotscore",
    "linkedin_profile",
    "hs_email_last_open_date",
    "notes_last_updated",
    "hs_last_sales_activity_timestamp",
  ],
  companies: [
    "hs_object_id",
    "name",
    "domain",
    "industry",
    "type",
    "lifecyclestage",
    "num_associated_contacts",
    "num_associated_deals",
    "hubspot_owner_id",
    "createdate",
    "hs_lastmodifieddate",
  ],
  deals: [...REQUIRED_DEAL_PROPERTIES, ...OPTIONAL_DEAL_PROPERTIES],
  tickets: [
    "hs_object_id",
    "subject",
    "content",
    "hs_pipeline",
    "hs_pipeline_stage",
    "hs_ticket_priority",
    "source_type",
    "hubspot_owner_id",
    "createdate",
    "hs_lastmodifieddate",
  ],
};

const DEFAULT_ASSOCIATED_OBJECT_PROPERTIES: Record<
  HubSpotAssociatedObjectType,
  string[]
> = {
  ...DEFAULT_OBJECT_PROPERTIES,
  notes: ["hs_object_id", "hs_note_body", "hs_timestamp", "createdate"],
  emails: [
    "hs_object_id",
    "hs_email_direction",
    "hs_email_from_email",
    "hs_email_from_firstname",
    "hs_email_from_lastname",
    "hs_email_subject",
    "hs_email_text",
    "hs_timestamp",
    "createdate",
  ],
};

function uniqueProperties(properties: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const property of properties) {
    const trimmed = property.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export async function getObjectProperties(
  objectType: HubSpotObjectType,
): Promise<HubSpotDealProperty[]> {
  const data = await apiGet<HubSpotDealPropertyListResponse>(
    `/crm/v3/properties/${objectType}`,
    `${objectType}-properties`,
  );
  return data.results;
}

export async function getDealProperties(): Promise<HubSpotDealProperty[]> {
  return getObjectProperties("deals");
}

async function getAvailableDealPropertyNames(): Promise<Set<string>> {
  const definitions = await getObjectProperties("deals");
  return new Set(definitions.map((property) => property.name));
}

async function getAvailableObjectPropertyNames(
  objectType: HubSpotObjectType,
): Promise<Set<string>> {
  const definitions = await getObjectProperties(objectType);
  return new Set(definitions.map((property) => property.name));
}

async function resolveDealProperties(extraProperties: string[] = []) {
  const available = await getAvailableDealPropertyNames();
  return uniqueProperties([
    ...REQUIRED_DEAL_PROPERTIES,
    ...OPTIONAL_DEAL_PROPERTIES,
    ...extraProperties,
  ]).filter((property) => available.has(property));
}

async function resolveObjectProperties(
  objectType: HubSpotAssociatedObjectType,
  extraProperties: string[] = [],
) {
  if (!isHubSpotObjectType(objectType)) {
    return uniqueProperties([
      ...(DEFAULT_ASSOCIATED_OBJECT_PROPERTIES[objectType] ?? []),
      ...extraProperties,
    ]);
  }
  const available = await getAvailableObjectPropertyNames(objectType);
  return uniqueProperties([
    ...(DEFAULT_ASSOCIATED_OBJECT_PROPERTIES[objectType] ?? []),
    ...extraProperties,
  ]).filter((property) => available.has(property));
}

export async function searchHubSpotObjects(options: {
  objectType: HubSpotObjectType;
  query?: string;
  properties?: string[];
  limit?: number;
  after?: string;
}): Promise<{
  records: HubSpotObjectRecord[];
  total: number;
  nextAfter: string | null;
  properties: string[];
}> {
  const objectType = options.objectType;
  const limit = Math.max(1, Math.min(100, options.limit ?? 25));
  const query = options.query?.trim();
  const properties = await resolveObjectProperties(
    objectType,
    options.properties ?? [],
  );

  if (query) {
    const body: Record<string, unknown> = {
      query,
      limit,
      properties,
    };
    if (options.after) body.after = options.after;
    const data = await apiPost<HubSpotObjectListResponse>(
      `/crm/v3/objects/${objectType}/search`,
      body,
    );
    return {
      records: data.results,
      total: data.total ?? data.results.length,
      nextAfter: data.paging?.next?.after ?? null,
      properties,
    };
  }

  const params = new URLSearchParams({ limit: String(limit) });
  if (properties.length > 0) params.set("properties", properties.join(","));
  if (options.after) params.set("after", options.after);

  const data = await apiGet<HubSpotObjectListResponse>(
    `/crm/v3/objects/${objectType}?${params.toString()}`,
    `${objectType}:list:${params.toString()}`,
  );
  return {
    records: data.results,
    total: data.results.length,
    nextAfter: data.paging?.next?.after ?? null,
    properties,
  };
}

function objectRecordToDeal(record: HubSpotObjectRecord): Deal {
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

// CRM search on a deal property with IN — bypasses scanning the full deal catalog.
export async function searchHubSpotDealsByPropertyValues(options: {
  propertyValues: string[];
  propertyName: string;
  limit?: number;
  after?: string;
  extraProperties?: string[];
}): Promise<{
  deals: Deal[];
  total: number;
  nextAfter: string | null;
}> {
  const propertyValues = uniqueProperties(options.propertyValues);
  if (!propertyValues.length) {
    return { deals: [], total: 0, nextAfter: null };
  }

  const propertyName = options.propertyName.trim();
  if (!propertyName) {
    throw new Error(
      "propertyName is required for HubSpot deal property search",
    );
  }
  const limit = Math.max(1, Math.min(100, options.limit ?? 100));
  const properties = await resolveDealProperties(options.extraProperties ?? []);

  const body: Record<string, unknown> = {
    filterGroups: [
      {
        filters: [
          {
            propertyName,
            operator: "IN",
            values: propertyValues,
          },
        ],
      },
    ],
    properties,
    limit,
  };
  if (options.after) body.after = options.after;

  const data = await apiPost<HubSpotObjectListResponse>(
    "/crm/v3/objects/deals/search",
    body,
    `deal-property-search:${propertyName}:${propertyValues.join(",")}:${limit}:${options.after ?? ""}`,
  );

  return {
    deals: data.results.map(objectRecordToDeal),
    total: data.total ?? data.results.length,
    nextAfter: data.paging?.next?.after ?? null,
  };
}

export async function getHubSpotAssociations(options: {
  fromObjectType: HubSpotAssociatedObjectType;
  fromObjectId: string;
  toObjectType: HubSpotAssociatedObjectType;
  limit?: number;
}): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  let after: string | undefined;

  for (let page = 0; page < 10 && ids.length < limit; page++) {
    const params = new URLSearchParams({
      limit: String(Math.min(100, limit - ids.length)),
    });
    if (after) params.set("after", after);
    const data = await apiGet<{
      results?: Array<{ id?: string; toObjectId?: string | number }>;
      paging?: { next?: { after?: string } };
    }>(
      `/crm/v3/objects/${options.fromObjectType}/${options.fromObjectId}/associations/${options.toObjectType}?${params.toString()}`,
      `assoc:${options.fromObjectType}:${options.fromObjectId}:${options.toObjectType}:${params.toString()}`,
    );

    for (const result of data.results ?? []) {
      const id =
        typeof result.id === "string"
          ? result.id
          : result.toObjectId != null
            ? String(result.toObjectId)
            : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= limit) break;
    }
    after = data.paging?.next?.after;
    if (!after) break;
  }

  return ids;
}

export async function readHubSpotObjects(options: {
  objectType: HubSpotAssociatedObjectType;
  ids: string[];
  properties?: string[];
}): Promise<HubSpotObjectRecord[]> {
  const ids = Array.from(new Set(options.ids.filter(Boolean)));
  if (!ids.length) return [];
  const properties = await resolveObjectProperties(
    options.objectType,
    options.properties ?? [],
  );
  const records: HubSpotObjectRecord[] = [];

  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const data = await apiPost<HubSpotObjectListResponse>(
      `/crm/v3/objects/${options.objectType}/batch/read`,
      {
        inputs: batch.map((id) => ({ id })),
        properties,
      },
      `batch:${options.objectType}:${batch.join(",")}:${properties.join(",")}`,
    );
    records.push(...(data.results ?? []));
  }

  return records;
}

export async function getAssociatedHubSpotObjects(options: {
  fromObjectType: HubSpotAssociatedObjectType;
  fromObjectId: string;
  toObjectType: HubSpotAssociatedObjectType;
  limit?: number;
  properties?: string[];
}): Promise<HubSpotObjectRecord[]> {
  const ids = await getHubSpotAssociations(options);
  return readHubSpotObjects({
    objectType: options.toObjectType,
    ids,
    properties: options.properties,
  });
}

export function stripHubSpotHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

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

export async function getDealOwners(): Promise<Record<string, string>> {
  const fullCacheKey = scopedCredentialCacheKey(
    "owners-full",
    "HUBSPOT_ACCESS_TOKEN",
  );
  const cached = cache.get(fullCacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as Record<string, string>;
  }

  const owners: Record<string, string> = {};
  let after: string | undefined;
  for (let i = 0; i < 100; i++) {
    const url = `/crm/v3/owners?limit=100&archived=false${after ? `&after=${after}` : ""}`;
    const res = await hubspotFetch(`${API_BASE}${url}`, {
      headers: { Authorization: `Bearer ${await getToken()}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HubSpot API error ${res.status}: ${text}`);
    }
    const data = (await res.json()) as HubSpotOwnerListResponse;
    for (const owner of data.results) {
      const name = [owner.firstName, owner.lastName].filter(Boolean).join(" ");
      owners[owner.id] = name || owner.email || owner.id;
    }
    after = data.paging?.next?.after;
    if (!after) break;
  }

  cache.set(fullCacheKey, { data: owners, ts: Date.now() });
  return owners;
}

export async function getAllDeals(
  extraProperties: string[] = [],
): Promise<Deal[]> {
  const properties = await resolveDealProperties(extraProperties);
  const propertyKey = properties.slice().sort().join(",");
  // Check full-result cache first
  const fullCacheKey = scopedCredentialCacheKey(
    `all-deals-full:${propertyKey}`,
    "HUBSPOT_ACCESS_TOKEN",
  );
  const cached = cache.get(fullCacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as Deal[];
  }

  const all: Deal[] = [];
  let after: string | undefined;
  const props = properties.join(",");

  // Paginate through all deals (up to 10K)
  for (let i = 0; i < 100; i++) {
    const url = `/crm/v3/objects/deals?limit=100&properties=${props}${after ? `&after=${after}` : ""}`;
    const res = await hubspotFetch(`${API_BASE}${url}`, {
      headers: { Authorization: `Bearer ${await getToken()}` },
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

  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) {
      stageMap.set(stage.id, stage);
      const label = stage.label.toLowerCase();
      const prob = parseFloat(stage.metadata?.probability ?? "");
      if (prob === 1 || label.includes("closed won") || label === "won") {
        wonStageIds.add(stage.id);
      }
      if (prob === 0 || label.includes("closed lost") || label === "lost") {
        lostStageIds.add(stage.id);
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
