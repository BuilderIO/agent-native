import {
  getUserSetting,
  listOrgSettings,
  listSettingsByPrefix,
} from "@agent-native/core/settings";

import {
  LOW_INFORMATION_TERMS,
  dataDictionaryTrustRank,
  matchSearchFields as matchScore,
  paginateSearchResults,
  semanticScopeCompatibility,
  semanticScopeForSearch,
  searchTerms,
  stripNonPositiveInstructions,
  decodeSearchCursor,
  unrelatedNameTerms,
} from "./analytics-term-matcher";
export { relevanceTerms, searchTerms } from "./analytics-term-matcher";

import { dashboardCatalogEntries } from "./dashboard-catalog";
import {
  isDashboardCertified,
  type DashboardCertification,
} from "./dashboard-certification";
import {
  listDashboardSummaries,
  loadDashboardCatalogDashboards,
  searchDashboardReferencesPage,
  type DashboardCatalogRecord,
  type DashboardReferenceRecord,
  type DashboardSummaryRecord,
} from "./dashboards-store";
import { mergeDataDictionaryEntry } from "./data-dictionary-overlays";
import {
  readSourceIndex,
  sourceIndexScanCoverage,
  sourceIndexDictionaryEntries,
  sourceIndexFreshness,
  sourceIndexSourcesFreshness,
  type SourceIndexScanCoverage,
  type SourceIndexFreshness,
  type SourceIndexSourcesFreshness,
} from "./source-index-store";

const DATA_DICTIONARY_KEY_PREFIX = "data-dict-";
const MAX_QUERY_LENGTH = 12_000;
const MAX_CATALOG_DASHBOARD_HYDRATION = 24;
// ponytail: scan the 200 most recently updated summaries; a search-backed index is the upgrade path if larger workspaces need older references.
const MAX_CATALOG_DASHBOARD_SUMMARIES = 200;
const MAX_CATALOG_DICTIONARY_ENTRIES = 200;
const DASHBOARD_USER_DIMENSION_NAMES = new Set([
  "user",
  "users",
  "member",
  "members",
  "person",
  "persons",
  "people",
]);
const DASHBOARD_ORGANIZATION_DIMENSION_NAMES = new Set([
  "organization",
  "organizations",
  "org",
  "orgs",
  "workspace",
  "workspaces",
  "team",
  "teams",
]);
const RETIRED_CATALOG_STATES = new Set([
  "deprecated",
  "obsolete",
  "removed",
  "retired",
]);
type DictionaryEntry = Record<string, unknown>;
type DashboardPanel = Record<string, unknown>;
type SourceKind = "dbt" | "code" | "sigma";

function sourceKind(value: unknown): SourceKind | undefined {
  return value === "dbt" || value === "code" || value === "sigma"
    ? value
    : undefined;
}

function sourceEntryType(
  value: unknown,
): "model" | "event" | "semantic_model" | "metric" | undefined {
  return value === "model" ||
    value === "event" ||
    value === "semantic_model" ||
    value === "metric"
    ? value
    : undefined;
}

function sourceEntryStatus(
  value: unknown,
): "active" | "deprecated" | undefined {
  return value === "active" || value === "deprecated" ? value : undefined;
}

function isRetiredCatalogReference(value: Record<string, unknown>): boolean {
  if (value.deprecated === true) return true;
  return [value.status, value.lifecycle, value.state].some(
    (candidate) =>
      typeof candidate === "string" &&
      RETIRED_CATALOG_STATES.has(candidate.trim().toLowerCase()),
  );
}

export type AnalyticsQueryCatalogCandidate =
  | {
      kind: "dashboard-panel";
      origin: "saved-dashboard" | "dashboard-template";
      score: number;
      matchedTerms: string[];
      exactMatchedTerms?: string[];
      dashboardId: string;
      dashboardTitle: string;
      dashboardDescription?: string;
      panelId: string;
      panelTitle: string;
      panelDescription?: string;
      source?: string;
      query?: string | Record<string, unknown>;
      timeScope?: string;
      dashboardCertification?: DashboardCertification;
      dashboardCertified: boolean;
      favorite?: boolean;
    }
  | {
      kind: "data-dictionary";
      origin: "data-dictionary" | "source-index";
      score: number;
      matchedTerms: string[];
      exactMatchedTerms?: string[];
      id: string;
      metric: string;
      definition?: string;
      source?: string;
      action?: string;
      table?: string;
      columnsUsed?: string;
      sqlProjectedColumns?: string;
      inferredMembershipKeys?: string[];
      inferredMembershipKeyRoles?: { user: string; organization: string };
      queryTemplate?: string;
      knownGotchas?: string;
      commonQuestions?: string;
      cuts?: string;
      joinPattern?: string;
      updateFrequency?: string;
      dataLag?: string;
      dependencies?: string;
      validDateRange?: string;
      owner?: string;
      approved?: boolean;
      aiGenerated?: boolean;
      sourceKind?: "dbt" | "code" | "sigma";
      entryType?: "model" | "event" | "semantic_model" | "metric";
      status?: "active" | "deprecated";
      grain?: string;
      primaryEntity?: string;
      timeDimension?: string;
      semanticModel?: string;
      sourceUrl?: string;
      semanticScope?: string;
      sourcePath?: string;
      sourceRevision?: string;
      sourceIndexGeneratedAt?: string;
      sourceIndexSources?: string;
      sourceIndexAgeDays?: number;
      sourceIndexStaleAfterDays?: number;
      sourceIndexStale?: boolean;
      sourceIndexFreshnessUnknown?: boolean;
    };

type DashboardPanelCandidate = Extract<
  AnalyticsQueryCatalogCandidate,
  { kind: "dashboard-panel" }
>;

const dashboardMembershipOutputCache = new WeakMap<
  DashboardPanelCandidate,
  { query: string; result: boolean }
>();

export type AnalyticsQueryCatalogSearchResult = {
  candidates: AnalyticsQueryCatalogCandidate[];
  searched: number;
  of: number;
  truncated: boolean;
  nextPage: string | null;
  searchedDashboardCount: number;
  dashboardSearchTruncated: boolean;
  dashboardDetailHydrationTruncated: boolean;
  dashboardPanelReferenceSearchStatus: "available" | "unavailable";
  dashboardPanelReferenceSearchTruncated: boolean;
  dashboardPanelReferenceSearched: number;
  dashboardPanelReferenceOf: number;
  dashboardPanelReferenceNextPage: string | null;
  dashboardSearchStatus: "available" | "unavailable";
  searchedDictionaryEntryCount: number;
  dictionarySearchTruncated: boolean;
  dictionarySearchStatus: "available" | "partial" | "unavailable";
  sourceIndexStatus: "not-configured" | "unavailable" | "invalid" | "available";
  sourceIndexScanCoverage: SourceIndexScanCoverage | null;
  sourceIndexFreshness: SourceIndexFreshness | null;
  sourceIndexSourcesFreshness: SourceIndexSourcesFreshness | null;
};

export type AnalyticsDictionarySearchResult = {
  candidates: AnalyticsQueryCatalogCandidate[];
  searched: number;
  of: number;
  truncated: boolean;
  nextPage: string | null;
  searchedDictionaryEntryCount: number;
  dictionarySearchTruncated: boolean;
  dictionarySearchStatus: "available" | "partial" | "unavailable";
  sourceIndexStatus: "not-configured" | "unavailable" | "invalid" | "available";
  sourceIndexScanCoverage: SourceIndexScanCoverage | null;
  sourceIndexFreshness: SourceIndexFreshness | null;
  sourceIndexSourcesFreshness: SourceIndexSourcesFreshness | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function membershipKeyRoles(
  value: unknown,
): { user: string; organization: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const roles = value as Record<string, unknown>;
  const user = text(roles.user);
  const organization = text(roles.organization);
  return user &&
    organization &&
    user.toLowerCase() !== organization.toLowerCase()
    ? { user, organization }
    : undefined;
}

async function listFavoriteDashboardIds(email: string): Promise<Set<string>> {
  const value = await getUserSetting(email, "favorites");
  const ids =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).ids
      : null;
  return new Set(
    Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string")
      : [],
  );
}

function compactQuery(value: unknown): string | Record<string, unknown> | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, MAX_QUERY_LENGTH) : null;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function summaryScore(
  search: string,
  dashboard: DashboardSummaryRecord,
  favoriteIds: ReadonlySet<string>,
): number {
  const relevance = dashboardSummaryRelevance(search, dashboard);
  const certified = isDashboardCertified(
    dashboard.certification,
    dashboard.updatedAt,
  );
  return (
    relevance + (certified ? 60 : 0) + (favoriteIds.has(dashboard.id) ? 20 : 0)
  );
}

function dashboardSummaryRelevance(
  search: string,
  dashboard: DashboardSummaryRecord,
): number {
  return matchScore(search, [
    { value: dashboard.name, weight: 24 },
    { value: dashboard.description, weight: 12 },
    { value: dashboard.configName, weight: 10 },
    { value: dashboard.catalogTemplateId, weight: 6 },
    { value: dashboard.demoId, weight: 6 },
  ]).score;
}

function shortlistDashboardSummaries(
  search: string,
  dashboards: DashboardSummaryRecord[],
  limit: number,
  favoriteIds: ReadonlySet<string>,
): DashboardSummaryRecord[] {
  const maxHydration = Math.min(
    Math.max(limit * 4, 12),
    MAX_CATALOG_DASHBOARD_HYDRATION,
  );
  return dashboards
    .map((dashboard) => ({
      dashboard,
      score: summaryScore(search, dashboard, favoriteIds),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return JSON.stringify(a.dashboard).localeCompare(
        JSON.stringify(b.dashboard),
      );
    })
    .slice(0, maxHydration)
    .map(({ dashboard }) => dashboard);
}

const SEMANTIC_SCOPES = new Set([
  "analytics_user",
  "product_user",
  "person",
  "organization",
  "membership",
  "membership_roster",
  "product_activity",
  "session",
  "crm_record",
]);

function inferSemanticScope(value: string): string {
  return semanticScopeForSearch(value);
}

function isMembershipRosterRequest(search: string): boolean {
  return inferSemanticScope(search) === "membership_roster";
}

function requestedTemporalUnit(search: string): string | null {
  const match = search.match(
    /\b(?:last|past|previous|prior|this|current|next|since|before|after)\s+(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+)?(day|week|month|quarter|year)s?\b/i,
  );
  return match?.[1]?.toLowerCase() ?? null;
}

function isExplicitMembershipSnapshotRequest(search: string): boolean {
  return /\b(?:as of|at (?:the )?end of|snapshot|snapshots|historical|history|month[- ]end)\b/i.test(
    search,
  );
}

function requestedHistoricalTemporalUnit(search: string): string | null {
  const unit =
    requestedTemporalUnit(search) ??
    (/\b(?:as of|at (?:the )?end of)\s+(?:the\s+)?month[- ]end\b/i.test(search)
      ? "month"
      : null);
  const hasUnmarkedPastCalendarPeriod =
    /\b(?:last|past|previous|prior)\s+(?:month|quarter|year)\b/i.test(search) &&
    !/\b(?:joined|signed\s+up|created|added|invited|started)\b/i.test(search);
  if (
    !unit ||
    (!isExplicitMembershipSnapshotRequest(search) &&
      !hasUnmarkedPastCalendarPeriod) ||
    (!/\b(?:last|past|previous|prior)\b/i.test(search) &&
      !/\b(?:as of|at (?:the )?end of)\b/i.test(search)) ||
    /\b(?:this|current|next)\s+(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+)?(?:day|week|month|quarter|year)s?\b/i.test(
      search,
    )
  ) {
    return null;
  }
  return unit;
}

function isAggregateRequest(search: string): boolean {
  const asksForAggregation =
    /\b(?:how many|counts?|number of|total|highest|lowest|most|fewest|average|avg|median|sum|trends?|rate|percentage|share|distribution|breakdowns?|split\s+by|growth|grow(?:s|n|ing)?|grew|increases?|increased|decreases?|decreased|declines?|declined|changes?|changed|variance|delta)\b|\b(?:month|year)[- ]over[- ](?:month|year)\b|\bover time\b/i.test(
      search,
    );
  const asksForTemporalGrouping =
    /\b(?:(?:group(?:ed)?\s+)?by|per)\s+(?:date|day|week|month|quarter|year)\b/i.test(
      search,
    );
  const recurringCadence =
    /\b(?:daily|weekly|monthly|quarterly|yearly)\b/i.test(search);
  const explicitSnapshot = isExplicitMembershipSnapshotRequest(search);
  return (
    asksForAggregation ||
    (!explicitSnapshot && asksForTemporalGrouping) ||
    (!explicitSnapshot && recurringCadence)
  );
}

function candidateTextFields(
  candidate: AnalyticsQueryCatalogCandidate,
): string[] {
  if (candidate.kind === "data-dictionary") {
    return [
      candidate.metric,
      candidate.definition,
      candidate.table,
      candidate.columnsUsed,
      candidate.sqlProjectedColumns,
      candidate.grain,
      candidate.primaryEntity,
      candidate.semanticModel,
      candidate.joinPattern,
    ].filter((value): value is string => Boolean(value));
  }
  return [
    candidate.dashboardTitle,
    candidate.dashboardDescription,
    candidate.panelTitle,
    candidate.panelDescription,
    candidate.query
      ? typeof candidate.query === "string"
        ? (stripSqlComments(candidate.query) ?? candidate.query)
        : JSON.stringify(candidate.query)
      : "",
  ].filter((value): value is string => Boolean(value));
}

function normalizedCandidateText(candidate: AnalyticsQueryCatalogCandidate) {
  return candidateTextFields(candidate)
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function hasTemporalMembershipSnapshotShape(
  candidate: AnalyticsQueryCatalogCandidate,
) {
  if (candidate.kind !== "data-dictionary") return false;
  const normalize = (value: string | undefined) =>
    (value ?? "").toLowerCase().replace(/[_-]+/g, " ");
  const grain = normalize(candidate.grain);
  const hasMembershipRowGrain = hasDeclaredMembershipRowGrain(candidate);
  const explicitTemporalGrain =
    /\b(?:one|single)\s+row\s+per\s+(?:date|day|week|month|quarter|year)\b/.test(
      grain,
    ) ||
    /\b(?:per|by)\s+(?:date|day(?:ly)?|week(?:ly)?|month(?:ly)?|quarter(?:ly)?|year(?:ly)?)\b/.test(
      grain,
    ) ||
    /\b(?:snapshot|snapshots)\s+(?:by|per)\s+(?:date|day|week|month|quarter|year)\b/.test(
      grain,
    ) ||
    /\b(?:historical|history)\b/.test(grain);
  const describesExplicitSnapshot = (value: string | undefined) => {
    const normalized = normalize(value);
    return (
      /\b(?:historical|history)\b[\s\S]{0,60}\bsnapshots?\b|\bsnapshots?\b[\s\S]{0,60}\b(?:historical|history)\b/.test(
        normalized,
      ) ||
      /\b(?:day|daily|week|weekly|month|monthly|quarter|quarterly|year|yearly)(?:\s+(?:user|member|membership|workspace|organization|org|team|role)){0,2}\s+snapshots?\b/.test(
        normalized,
      ) ||
      /\b(?:month|quarter|year)[ -]end\s+snapshots?\b/.test(normalized) ||
      /\bsnapshots?\s+(?:by|per)\s+(?:date|day|week|month|quarter|year)\b/.test(
        normalized,
      )
    );
  };
  const definitionDescribesSnapshot = describesExplicitSnapshot(
    candidate.definition,
  );
  const structuredDescriptor = [
    candidate.metric,
    candidate.primaryEntity,
    candidate.semanticModel,
  ]
    .map(normalize)
    .filter(Boolean)
    .join(" ");
  const structuredDescriptorDescribesSnapshot =
    describesExplicitSnapshot(structuredDescriptor);
  // A declared membership grain describes the row shape. Refresh cadence in
  // descriptive prose must not turn that current-state relation into a
  // historical snapshot. Only explicit temporal grain or snapshot labels can do so.
  if (
    hasMembershipRowGrain &&
    !explicitTemporalGrain &&
    !definitionDescribesSnapshot &&
    !structuredDescriptorDescribesSnapshot
  ) {
    return false;
  }
  const descriptor = [
    structuredDescriptor,
    definitionDescribesSnapshot ? normalize(candidate.definition) : "",
  ].join(" ");
  return (
    explicitTemporalGrain ||
    /\b(?:per\s+)?(?:day|daily|week|weekly|month|monthly|quarter|quarterly|year|yearly)\b/.test(
      grain,
    ) ||
    /\b(?:month end|as of (?:the )?(?:day|week|month|quarter|year))\b/.test(
      descriptor,
    ) ||
    /\b(?:historical|history)\b[\s\S]{0,60}\bsnapshots?\b|\bsnapshots?\b[\s\S]{0,60}\b(?:historical|history)\b/.test(
      descriptor,
    ) ||
    /\b(?:day|daily|week|weekly|month|monthly|quarter|quarterly|year|yearly)\b[\s\S]{0,40}\bsnapshots?\b/.test(
      descriptor,
    ) ||
    /\bsnapshots?\s+(?:by|per)\s+(?:date|day|week|month|quarter|year)\b/.test(
      descriptor,
    )
  );
}

function hasDeclaredRowLevelMembershipGrain(
  candidate: AnalyticsQueryCatalogCandidate,
) {
  return (
    hasDeclaredMembershipRowGrain(candidate) &&
    !hasTemporalMembershipSnapshotShape(candidate)
  );
}

function hasDeclaredMembershipRowGrain(
  candidate: AnalyticsQueryCatalogCandidate,
) {
  if (candidate.kind !== "data-dictionary" || !candidate.grain?.trim()) {
    return false;
  }
  const declaredShape = candidate.grain.toLowerCase().replace(/[_-]+/g, " ");
  return (
    /\b(?:one|single)\s+row\s+per\b/.test(declaredShape) &&
    /\b(?:users?|people|persons?|members?)\b/.test(declaredShape) &&
    /\b(?:organizations?|orgs?|workspaces?|teams?)\b/.test(declaredShape)
  );
}

function hasMatchingHistoricalMembershipSnapshot(
  candidate: AnalyticsQueryCatalogCandidate,
  search: string,
) {
  const requestedScope = requestedSemanticScope(search);
  const requestedUnit = requestedHistoricalTemporalUnit(search);
  if (
    candidate.kind !== "data-dictionary" ||
    !["membership", "membership_roster"].includes(requestedScope) ||
    !requestedUnit ||
    !hasDeclaredMembershipRowGrain(candidate) ||
    !hasTemporalMembershipSnapshotShape(candidate)
  ) {
    return false;
  }

  const temporalDescriptor = [
    candidate.metric,
    candidate.table,
    candidate.columnsUsed,
    candidate.grain,
    candidate.definition,
    candidate.primaryEntity,
    candidate.semanticModel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  const unitPattern: Record<string, RegExp> = {
    day: /\b(?:day|daily)\b/,
    week: /\b(?:week|weekly)\b/,
    month: /\b(?:month|monthly)\b/,
    quarter: /\b(?:quarter|quarterly)\b/,
    year: /\b(?:year|yearly|annual)\b/,
  };
  return unitPattern[requestedUnit]?.test(temporalDescriptor) ?? false;
}

function isHistoricalMembershipRequest(search: string) {
  return (
    !isAggregateRequest(search) &&
    requestedHistoricalTemporalUnit(search) !== null &&
    ["membership", "membership_roster"].includes(requestedSemanticScope(search))
  );
}

function hasAggregateShape(candidate: AnalyticsQueryCatalogCandidate) {
  const fields =
    candidate.kind === "data-dictionary"
      ? [
          candidate.metric,
          candidate.table,
          candidate.columnsUsed,
          candidate.grain,
        ]
      : [
          typeof candidate.query === "string"
            ? (stripSqlComments(candidate.query) ?? candidate.query)
            : candidate.query
              ? JSON.stringify(candidate.query)
              : "",
        ];
  const searchable = fields
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (candidate.kind === "data-dictionary") {
    if (hasTemporalMembershipSnapshotShape(candidate)) return true;
    // An explicit user-organization row grain is stronger than incidental
    // field names such as member_count. Temporal grains remain snapshots.
    if (hasDeclaredRowLevelMembershipGrain(candidate)) return false;
  }
  if (
    /\b(?:aggregate|aggregated|rollup|summary|snapshot|count|total|average|avg|sum|median)\b/.test(
      searchable,
    )
  ) {
    return true;
  }
  if (candidate.kind === "dashboard-panel") {
    return /\bgroup\s+by\b|\b(?:count|sum|avg|average|min|max|median)\s*\(/i.test(
      searchable,
    );
  }
  return false;
}

function hasMembershipRoleContext(candidate: AnalyticsQueryCatalogCandidate) {
  const searchable = normalizedCandidateText(candidate);
  const scope = candidateSemanticScope(candidate);
  return (
    /\b(?:users?|people|persons?|members?)\b/.test(searchable) &&
    /\b(?:organizations?|orgs?|workspaces?|teams?)\b/.test(searchable) &&
    (scope === "membership" || scope === "membership_roster") &&
    !hasExplicitActivityEvidence(candidate) &&
    hasMembershipRoleField(candidate)
  );
}

function hasMembershipRoleField(candidate: AnalyticsQueryCatalogCandidate) {
  const values =
    candidate.kind === "data-dictionary"
      ? [
          candidate.columnsUsed,
          candidate.sqlProjectedColumns,
          candidate.table,
          candidate.joinPattern,
          candidate.semanticModel,
        ]
      : [candidate.query ? JSON.stringify(candidate.query) : ""];
  const searchable = values
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  return /\b(?:roles?|permissions?|authorization)\b|\baccess\s+(?:level|role|scope|grant|permission|policy|control)\b/.test(
    searchable,
  );
}

function requestsMembershipRoleDetail(search: string): boolean {
  return /\b(?:roles?|permissions?|authorization)\b|\baccess\s+(?:level|role|scope|grant|permission|policy|control)\b|\bby\s+access\b/i.test(
    search,
  );
}

function hasMembershipIdentityKey(columns: string): boolean {
  return /\b(?:user|member|person)\s+id\b/.test(columns);
}

function hasOrganizationIdentityKey(columns: string): boolean {
  return /\b(?:organization|org|workspace|team)\s+id\b/.test(columns);
}

function hasInferredMembershipIdentityKeys(
  candidate: AnalyticsQueryCatalogCandidate,
): boolean {
  if (
    candidate.kind !== "data-dictionary" ||
    candidate.origin !== "source-index" ||
    candidate.sourceKind !== "dbt"
  ) {
    return false;
  }
  const roles = candidate.inferredMembershipKeyRoles;
  if (!roles) return false;
  const inferredKeys = new Set(
    (candidate.inferredMembershipKeys ?? []).map((key) => key.toLowerCase()),
  );
  const projectedColumns = new Set(
    (candidate.sqlProjectedColumns ?? "")
      .split(",")
      .map((column) => column.trim().toLowerCase())
      .filter(Boolean),
  );
  return (
    roles.user.toLowerCase() !== roles.organization.toLowerCase() &&
    inferredKeys.has(roles.user.toLowerCase()) &&
    inferredKeys.has(roles.organization.toLowerCase()) &&
    projectedColumns.has(roles.user.toLowerCase()) &&
    projectedColumns.has(roles.organization.toLowerCase())
  );
}

function isStaleGeneratedSourceIndexEntry(
  candidate: AnalyticsQueryCatalogCandidate,
): boolean {
  return (
    candidate.kind === "data-dictionary" &&
    candidate.origin === "source-index" &&
    candidate.sourceIndexStale === true
  );
}

function hasMembershipRosterEvidence(
  candidate: AnalyticsQueryCatalogCandidate,
): boolean {
  if (isStaleGeneratedSourceIndexEntry(candidate)) return false;
  if (
    hasExplicitNonMembershipScope(candidate) ||
    hasExplicitActivityEvidence(candidate)
  ) {
    return false;
  }
  const searchable = normalizedCandidateText(candidate);
  const hasUserEntity = /\b(?:users?|people|persons?|members?)\b/.test(
    searchable,
  );
  const hasOrganizationEntity =
    /\b(?:organizations?|orgs?|workspaces?|teams?)\b/.test(searchable);
  if (!hasUserEntity || !hasOrganizationEntity) return false;

  const grain =
    candidate.kind === "data-dictionary" ? (candidate.grain ?? "") : "";
  const normalizedGrain = grain.toLowerCase().replace(/[_-]+/g, " ");
  const grainDescribesMembershipRows =
    /\b(?:one|single)\s+row\s+per\b/.test(normalizedGrain) &&
    /\b(?:users?|people|persons?|members?)\b/.test(normalizedGrain) &&
    /\b(?:organizations?|orgs?|workspaces?|teams?)\b/.test(normalizedGrain);
  const membershipGrain =
    /\bmembership\b/.test(normalizedGrain) &&
    /\b(?:users?|people|persons?|members?)\b/.test(normalizedGrain) &&
    /\b(?:organizations?|orgs?|workspaces?|teams?)\b/.test(normalizedGrain);
  const columns =
    candidate.kind === "data-dictionary"
      ? (candidate.columnsUsed ?? "").toLowerCase().replace(/[_-]+/g, " ")
      : "";
  const hasMembershipKeys =
    (hasMembershipIdentityKey(columns) &&
      hasOrganizationIdentityKey(columns)) ||
    hasInferredMembershipIdentityKeys(candidate);
  if (candidate.kind === "dashboard-panel") {
    const queryText = dashboardQueryText(candidate);
    const hasUserKey = hasMembershipIdentityKey(queryText);
    const hasOrganizationKey = hasOrganizationIdentityKey(queryText);
    return (
      hasRowLevelDashboardMembershipOutput(candidate) &&
      hasUserKey &&
      hasOrganizationKey &&
      hasMembershipRelationEvidence(queryText)
    );
  }
  const declaredMembershipScope =
    candidate.semanticScope === "membership" ||
    candidate.semanticScope === "membership_roster";
  const hasRelationshipEvidence =
    grainDescribesMembershipRows ||
    membershipGrain ||
    declaredMembershipScope ||
    hasMembershipRelationEvidence(searchable);
  const hasSingleEntityGrain =
    /\b(?:one|single)\s+row\s+per\b/.test(normalizedGrain) &&
    /\b(?:users?|people|persons?|members?)\b/.test(normalizedGrain) !==
      /\b(?:organizations?|orgs?|workspaces?|teams?)\b/.test(normalizedGrain);
  return (
    !hasAggregateShape(candidate) &&
    !hasSingleEntityGrain &&
    hasMembershipKeys &&
    hasRelationshipEvidence
  );
}

function dashboardQueryText(
  candidate: Extract<
    AnalyticsQueryCatalogCandidate,
    { kind: "dashboard-panel" }
  >,
): string {
  return typeof candidate.query === "string"
    ? (stripSqlComments(candidate.query) ?? candidate.query)
        .toLowerCase()
        .replace(/[_-]+/g, " ")
    : JSON.stringify(candidate.query ?? "")
        .toLowerCase()
        .replace(/[_-]+/g, " ");
}

function isSqlWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[a-z0-9_$]/i.test(value);
}

function sqlKeywordEndAt(
  sql: string,
  index: number,
  keyword: string,
): number | null {
  if (isSqlWordCharacter(sql[index - 1])) return null;
  let cursor = index;
  const words = keyword.toLowerCase().split(" ");
  for (const [wordIndex, word] of words.entries()) {
    if (sql.slice(cursor, cursor + word.length).toLowerCase() !== word) {
      return null;
    }
    cursor += word.length;
    if (isSqlWordCharacter(sql[cursor])) return null;
    if (wordIndex < words.length - 1) {
      const whitespaceStart = cursor;
      while (/\s/.test(sql[cursor] ?? "")) cursor += 1;
      if (cursor === whitespaceStart) return null;
    }
  }
  return cursor;
}

function findTopLevelSqlKeyword(
  sql: string,
  keyword: string,
  start = 0,
): { start: number; end: number } | null {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (quote) {
      if (character === quote) {
        if (sql[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      } else if (character === "\\") {
        index += 1;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth -= 1;
      if (depth < 0) return null;
      continue;
    }
    if (depth === 0 && index >= start) {
      const end = sqlKeywordEndAt(sql, index, keyword);
      if (end !== null) return { start: index, end };
    }
  }
  return null;
}

function splitTopLevelSqlList(value: string): string[] | null {
  const expressions: string[] = [];
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let expressionStart = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote) {
      if (character === quote) {
        if (value[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      } else if (character === "\\") {
        index += 1;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth < 0) return null;
    } else if (character === "," && depth === 0) {
      expressions.push(value.slice(expressionStart, index).trim());
      expressionStart = index + 1;
    }
  }
  if (quote || depth !== 0) return null;
  expressions.push(value.slice(expressionStart).trim());
  return expressions.some((expression) => !expression) ? null : expressions;
}

function stripSqlComments(sql: string): string | null {
  const output: string[] = [];
  let quote: "'" | '"' | "`" | null = null;
  let blockComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (blockComment) {
      if (character === "*" && sql[index + 1] === "/") {
        blockComment = false;
        output.push(" ");
        index += 1;
      } else if (character === "\n") {
        output.push("\n");
      }
      continue;
    }
    if (quote) {
      output.push(character);
      if (character === quote) {
        if (sql[index + 1] === quote) {
          output.push(sql[index + 1]!);
          index += 1;
        } else {
          quote = null;
        }
      } else if (character === "\\") {
        if (sql[index + 1] !== undefined) {
          output.push(sql[index + 1]!);
          index += 1;
        }
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      output.push(character);
    } else if (character === "-" && sql[index + 1] === "-") {
      while (index < sql.length && sql[index] !== "\n") index += 1;
      if (sql[index] === "\n") output.push("\n");
    } else if (character === "#") {
      while (index < sql.length && sql[index] !== "\n") index += 1;
      if (sql[index] === "\n") output.push("\n");
    } else if (character === "/" && sql[index + 1] === "*") {
      blockComment = true;
      output.push(" ");
      index += 1;
    } else {
      output.push(character);
    }
  }
  return blockComment ? null : output.join("");
}

function maskSqlStringLiterals(sql: string): string {
  const output: string[] = [];
  let inString = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (!inString) {
      if (character === "'") {
        inString = true;
        output.push(" ");
      } else {
        output.push(character);
      }
      continue;
    }
    if (character === "'" && sql[index + 1] === "'") {
      output.push("  ");
      index += 1;
    } else if (character === "\\" && sql[index + 1] !== undefined) {
      output.push("  ");
      index += 1;
    } else if (character === "'") {
      inString = false;
      output.push(" ");
    } else {
      output.push(character === "\n" ? "\n" : " ");
    }
  }
  return output.join("");
}

function stripSingleTrailingSqlTerminator(sql: string): string | null {
  const semicolonPositions: number[] = [];
  let quote: "'" | '"' | "`" | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (quote) {
      if (character === quote) {
        if (sql[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      } else if (character === "\\") {
        index += 1;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === ";") {
      semicolonPositions.push(index);
    }
  }
  if (quote) return null;
  if (semicolonPositions.length === 0) return sql.trim();
  const finalNonWhitespace = sql.trimEnd().length - 1;
  if (
    semicolonPositions.length !== 1 ||
    semicolonPositions[0] !== finalNonWhitespace
  ) {
    return null;
  }
  return sql.slice(0, finalNonWhitespace).trim();
}

function splitTopLevelSqlSetOperations(sql: string): string[] | null {
  const parts: string[] = [];
  let start = 0;
  while (start < sql.length) {
    const operator = ["union", "intersect", "except"]
      .map((keyword) => findTopLevelSqlKeyword(sql, keyword, start))
      .filter(
        (match): match is { start: number; end: number } => match !== null,
      )
      .sort((left, right) => left.start - right.start)[0];
    if (!operator) break;
    const part = sql.slice(start, operator.start).trim();
    if (!part) return null;
    parts.push(part);

    let next = operator.end;
    const modifier = sql.slice(next).match(/^\s+(?:all|distinct)\b/i);
    if (modifier) next += modifier[0].length;
    start = next;
  }
  const finalPart = sql.slice(start).trim();
  if (!finalPart) return null;
  parts.push(finalPart);
  return parts;
}

function parseSimpleDashboardMembershipSelect(sql: string): {
  sql: string;
  selectExpressions: string[];
  groupByExpressions: string[] | null;
  qualifyExpression: string | null;
} | null {
  const statement = sql.trim();
  if (!statement) return null;
  if (!splitTopLevelSqlList(statement)) return null;
  const select = findTopLevelSqlKeyword(statement, "select");
  const from = select
    ? findTopLevelSqlKeyword(statement, "from", select.end)
    : null;
  if (
    !select ||
    !from ||
    findTopLevelSqlKeyword(statement, "select", select.end)
  ) {
    return null;
  }
  const selectList = statement.slice(select.end, from.start);
  const selectModifier = selectList.match(/^\s*(?:all|distinct)\b\s*/i);
  const selectExpressions = splitTopLevelSqlList(
    selectList.slice(selectModifier?.[0].length ?? 0),
  );
  if (!selectExpressions) return null;

  const groupBy = findTopLevelSqlKeyword(statement, "group by", from.end);
  const having = findTopLevelSqlKeyword(statement, "having", from.end);
  const qualify = findTopLevelSqlKeyword(statement, "qualify", from.end);
  const qualifyEnd = qualify
    ? ["order by", "limit", "fetch"]
        .map((keyword) =>
          findTopLevelSqlKeyword(statement, keyword, qualify.end),
        )
        .filter(
          (match): match is { start: number; end: number } => match !== null,
        )
        .reduce((end, match) => Math.min(end, match.start), statement.length)
    : null;
  const qualifyExpression =
    qualify && qualifyEnd !== null
      ? statement.slice(qualify.end, qualifyEnd).trim()
      : null;
  if (qualify && !qualifyExpression) return null;
  if (!groupBy) {
    if (having) return null;
    return {
      sql: statement,
      selectExpressions,
      groupByExpressions: null,
      qualifyExpression,
    };
  }
  const clauseEnd = ["order by", "having", "qualify", "limit", "fetch"]
    .map((keyword) => findTopLevelSqlKeyword(statement, keyword, groupBy.end))
    .filter((match): match is { start: number; end: number } => match !== null)
    .reduce((end, match) => Math.min(end, match.start), statement.length);
  const rawGroupByExpressions = splitTopLevelSqlList(
    statement.slice(groupBy.end, clauseEnd),
  );
  if (!rawGroupByExpressions) return null;
  const groupByExpressions = rawGroupByExpressions.map((expression) => {
    const position = /^\d+$/.test(expression) ? Number(expression) : 0;
    return position > 0 && position <= selectExpressions.length
      ? selectExpressions[position - 1]!
      : expression;
  });
  if (rawGroupByExpressions.some((expression) => /^\d+$/.test(expression))) {
    if (
      rawGroupByExpressions.some(
        (expression) =>
          /^\d+$/.test(expression) &&
          (Number(expression) < 1 ||
            Number(expression) > selectExpressions.length),
      )
    ) {
      return null;
    }
  }
  return {
    sql: statement,
    selectExpressions,
    groupByExpressions,
    qualifyExpression,
  };
}

function parseSimpleDashboardMembershipQuery(sql: string): Array<{
  sql: string;
  selectExpressions: string[];
  groupByExpressions: string[] | null;
  qualifyExpression: string | null;
}> | null {
  const withoutComments = stripSqlComments(sql);
  const statement = withoutComments
    ? stripSingleTrailingSqlTerminator(withoutComments)
    : null;
  if (!statement || !statement.trim()) return null;
  const branches = splitTopLevelSqlSetOperations(statement);
  if (!branches) return null;
  const parsed = branches.map(parseSimpleDashboardMembershipSelect);
  if (parsed.some((branch) => branch === null)) return null;
  return parsed as Array<{
    sql: string;
    selectExpressions: string[];
    groupByExpressions: string[] | null;
    qualifyExpression: string | null;
  }>;
}

function splitDashboardProjectionAlias(expression: string): {
  expression: string;
  alias: string | null;
} {
  const trimmed = expression.trim();
  const asKeyword = findTopLevelSqlKeyword(trimmed, "as");
  const identifier = (value: string) => {
    const match = value
      .trim()
      .match(
        /^(?:"([a-z_][a-z0-9_$]*)"|`([a-z_][a-z0-9_$]*)`|([a-z_][a-z0-9_$]*))$/i,
      );
    return match ? (match[1] ?? match[2] ?? match[3]!).toLowerCase() : null;
  };
  if (asKeyword) {
    const source = trimmed.slice(0, asKeyword.start).trim();
    const alias = identifier(trimmed.slice(asKeyword.end));
    if (source && alias) return { expression: source, alias };
  }

  const implicitAlias = trimmed.match(
    /^(.*\S)\s+(?:"([a-z_][a-z0-9_$]*)"|`([a-z_][a-z0-9_$]*)`|([a-z_][a-z0-9_$]*))$/i,
  );
  if (implicitAlias) {
    return {
      expression: implicitAlias[1]!.trim(),
      alias: (
        implicitAlias[2] ??
        implicitAlias[3] ??
        implicitAlias[4]!
      ).toLowerCase(),
    };
  }
  return { expression: trimmed, alias: null };
}

type DashboardCteDefinition = {
  query: string;
  columns: string[] | null;
};

type DashboardRelationReference = {
  name: string;
  alias: string;
  derived: boolean;
  start: number;
  end: number;
  joinKind: string | null;
};

const DERIVED_DASHBOARD_RELATION = "__derived_relation__";
const DASHBOARD_RELATION_ALIAS_KEYWORDS = new Set([
  "cross",
  "fetch",
  "full",
  "group",
  "having",
  "inner",
  "join",
  "left",
  "limit",
  "on",
  "order",
  "outer",
  "right",
  "qualify",
  "where",
  "window",
  "union",
]);

function skipSqlWhitespace(sql: string, start: number): number {
  let cursor = start;
  while (/\s/.test(sql[cursor] ?? "")) cursor += 1;
  return cursor;
}

function readSqlIdentifier(
  sql: string,
  start: number,
): {
  value: string;
  end: number;
} | null {
  const cursor = skipSqlWhitespace(sql, start);
  const match = sql
    .slice(cursor)
    .match(
      /^(?:"([a-z_][a-z0-9_$]*)"|`([a-z_][a-z0-9_$]*)`|([a-z_][a-z0-9_$]*))/i,
    );
  if (!match) return null;
  return {
    value: (match[1] ?? match[2] ?? match[3]!).toLowerCase(),
    end: cursor + match[0].length,
  };
}

function readSqlIdentifierPath(
  sql: string,
  start: number,
): {
  value: string;
  end: number;
} | null {
  const cursor = skipSqlWhitespace(sql, start);
  const match = sql
    .slice(cursor)
    .match(
      /^(?:"[a-z_][a-z0-9_$]*"|`[a-z_][a-z0-9_$]*`|[a-z_][a-z0-9_$]*)(?:\s*\.\s*(?:"[a-z_][a-z0-9_$]*"|`[a-z_][a-z0-9_$]*`|[a-z_][a-z0-9_$]*))*/i,
    );
  if (!match) return null;
  return {
    value: match[0]
      .replace(/["`]/g, "")
      .split(".")
      .slice(-1)[0]!
      .trim()
      .toLowerCase(),
    end: cursor + match[0].length,
  };
}

function matchingSqlParenthesis(sql: string, openIndex: number): number | null {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  for (let index = openIndex; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (quote) {
      if (character === quote) {
        if (sql[index + 1] === quote) index += 1;
        else quote = null;
      } else if (character === "\\") {
        index += 1;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) return null;
    }
  }
  return null;
}

function dashboardCteDefinitions(
  query: string,
): Map<string, DashboardCteDefinition> | null {
  const definitions = new Map<string, DashboardCteDefinition>();
  const sql = stripSqlComments(query);
  if (!sql) return definitions;
  let cursor = skipSqlWhitespace(sql, 0);
  const withEnd = sqlKeywordEndAt(sql, cursor, "with");
  if (withEnd === null) return definitions;
  cursor = skipSqlWhitespace(sql, withEnd);

  const recursiveEnd = sqlKeywordEndAt(sql, cursor, "recursive");
  if (recursiveEnd !== null) cursor = skipSqlWhitespace(sql, recursiveEnd);

  while (cursor < sql.length) {
    const name = readSqlIdentifier(sql, cursor);
    if (!name || definitions.has(name.value)) return null;
    cursor = skipSqlWhitespace(sql, name.end);
    let columns: string[] | null = null;
    if (sql[cursor] === "(") {
      const close = matchingSqlParenthesis(sql, cursor);
      if (close === null) return null;
      const parsedColumns = splitTopLevelSqlList(sql.slice(cursor + 1, close));
      if (!parsedColumns) return null;
      columns = parsedColumns.map((column) => {
        const identifier = readSqlIdentifier(column, 0);
        return identifier?.value ?? "";
      });
      if (columns.some((column) => !column)) return null;
      cursor = skipSqlWhitespace(sql, close + 1);
    }

    const asEnd = sqlKeywordEndAt(sql, cursor, "as");
    if (asEnd === null) return null;
    cursor = skipSqlWhitespace(sql, asEnd);
    const materializedEnd = sqlKeywordEndAt(sql, cursor, "materialized");
    if (materializedEnd !== null)
      cursor = skipSqlWhitespace(sql, materializedEnd);
    else {
      const notMaterializedEnd = sqlKeywordEndAt(
        sql,
        cursor,
        "not materialized",
      );
      if (notMaterializedEnd !== null) {
        cursor = skipSqlWhitespace(sql, notMaterializedEnd);
      }
    }
    if (sql[cursor] !== "(") return null;
    const close = matchingSqlParenthesis(sql, cursor);
    if (close === null) return null;
    definitions.set(name.value, {
      query: sql.slice(cursor + 1, close),
      columns,
    });
    cursor = skipSqlWhitespace(sql, close + 1);
    if (sql[cursor] === ",") {
      cursor = skipSqlWhitespace(sql, cursor + 1);
      if (cursor >= sql.length) return null;
      continue;
    }
    if (sqlKeywordEndAt(sql, cursor, "select") === null) return null;
    return definitions;
  }
  return null;
}

function dashboardTopLevelRelationReferences(
  query: string,
): DashboardRelationReference[] {
  const sql = stripSqlComments(query);
  if (!sql) return [];
  const relations: DashboardRelationReference[] = [];
  let searchStart = 0;
  while (searchStart < sql.length) {
    const next = ["from", "join"]
      .map((keyword) => findTopLevelSqlKeyword(sql, keyword, searchStart))
      .filter(
        (match): match is { start: number; end: number } => match !== null,
      )
      .map((match) => ({
        ...match,
        keyword:
          sqlKeywordEndAt(sql, match.start, "from") === match.end
            ? "from"
            : "join",
      }))
      .sort((left, right) => left.start - right.start)[0];
    if (!next) break;

    let cursor = skipSqlWhitespace(sql, next.end);
    let name: string;
    let alias: string;
    let derived = false;
    if (sql[cursor] === "(") {
      const close = matchingSqlParenthesis(sql, cursor);
      if (close === null) return [];
      cursor = skipSqlWhitespace(sql, close + 1);
      const asEnd = sqlKeywordEndAt(sql, cursor, "as");
      if (asEnd !== null) cursor = skipSqlWhitespace(sql, asEnd);
      const derivedAlias = readSqlIdentifier(sql, cursor);
      name = DERIVED_DASHBOARD_RELATION;
      alias = derivedAlias?.value ?? name;
      if (derivedAlias) cursor = derivedAlias.end;
      derived = true;
    } else {
      const relation = readSqlIdentifierPath(sql, cursor);
      if (!relation) {
        searchStart = next.end;
        continue;
      }
      name = relation.value;
      cursor = skipSqlWhitespace(sql, relation.end);
      const asEnd = sqlKeywordEndAt(sql, cursor, "as");
      if (asEnd !== null) cursor = skipSqlWhitespace(sql, asEnd);
      const candidateAlias = readSqlIdentifier(sql, cursor);
      alias =
        candidateAlias &&
        !DASHBOARD_RELATION_ALIAS_KEYWORDS.has(candidateAlias.value)
          ? candidateAlias.value
          : name;
      if (alias !== name && candidateAlias) cursor = candidateAlias.end;
    }
    const joinPrefix = sql
      .slice(0, next.start)
      .match(
        /\b((?:(?:natural)\s+)?(?:cross|inner|left|right|full)(?:\s+outer)?|natural)\s*$/i,
      );
    relations.push({
      name,
      alias,
      derived,
      start: next.start,
      end: cursor,
      joinKind:
        next.keyword === "join"
          ? (joinPrefix?.[1]?.toLowerCase().replace(/\s+/g, " ") ?? "inner")
          : null,
    });
    searchStart = Math.max(next.end, cursor);
  }
  return relations;
}

function dashboardRelationAliases(query: string): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const relation of dashboardTopLevelRelationReferences(query)) {
    aliases.set(relation.alias, relation.name);
    if (!relation.derived) aliases.set(relation.name, relation.name);
  }
  return aliases;
}

function simpleSqlIdentifierPath(expression: string): string[] | null {
  const pathPattern =
    /^(?:"[a-z_][a-z0-9_$]*"|`[a-z_][a-z0-9_$]*`|[a-z_][a-z0-9_$]*)(?:\s*\.\s*(?:"[a-z_][a-z0-9_$]*"|`[a-z_][a-z0-9_$]*`|[a-z_][a-z0-9_$]*))*$/i;
  if (!pathPattern.test(expression.trim())) return null;
  return expression
    .trim()
    .split(".")
    .map((part) => part.trim().replace(/["`]/g, "").toLowerCase());
}

function dashboardCteProjection(
  definition: DashboardCteDefinition,
  column: string,
): Array<{
  expression: string;
  query: string;
  selectExpressions: string[];
}> | null {
  const branches = parseSimpleDashboardMembershipQuery(definition.query);
  if (!branches?.length) return null;
  const firstBranch = branches[0]!;
  const outputNames = firstBranch.selectExpressions.map((expression) => {
    const parsed = splitDashboardProjectionAlias(expression);
    if (parsed.alias) return parsed.alias;
    const path = simpleSqlIdentifierPath(parsed.expression);
    return path?.[path.length - 1] ?? null;
  });
  const columnNames = definition.columns ?? outputNames;
  const position = columnNames.findIndex(
    (name) => name === column.toLowerCase(),
  );
  if (position < 0) return null;
  const projections = branches.map((branch) => {
    const expression = branch.selectExpressions[position];
    return expression
      ? {
          expression,
          query: branch.sql,
          selectExpressions: branch.selectExpressions,
        }
      : null;
  });
  return projections.every(Boolean)
    ? projections.filter(
        (
          projection,
        ): projection is {
          expression: string;
          query: string;
          selectExpressions: string[];
        } => projection !== null,
      )
    : null;
}

function dashboardPhysicalRelationNames(
  query: string,
  inheritedCtes: Map<string, DashboardCteDefinition> = new Map(),
  visiting = new Set<string>(),
): string[] {
  const ctes = new Map(inheritedCtes);
  const queryCtes = dashboardCteDefinitions(query);
  if (queryCtes === null) return [];
  for (const [name, definition] of queryCtes) {
    ctes.set(name, definition);
  }
  return dashboardTopLevelRelationReferences(query).flatMap((relation) =>
    dashboardPhysicalRelationNamesForReference(relation, ctes, visiting),
  );
}

function dashboardPhysicalRelationNamesForReference(
  relation: DashboardRelationReference,
  inheritedCtes: Map<string, DashboardCteDefinition>,
  visiting: Set<string> = new Set(),
): string[] {
  if (relation.derived) return [];
  const definition = inheritedCtes.get(relation.name);
  if (!definition || visiting.has(relation.name)) return [relation.name];
  const nextVisiting = new Set(visiting).add(relation.name);
  const branches = parseSimpleDashboardMembershipQuery(definition.query);
  return (
    branches?.flatMap((branch) =>
      dashboardPhysicalRelationNames(branch.sql, inheritedCtes, nextVisiting),
    ) ?? []
  );
}

function dashboardJoinOnExpression(
  query: string,
  relation: DashboardRelationReference,
): string | null {
  const clauseEnd = [
    "join",
    "where",
    "group by",
    "having",
    "qualify",
    "order by",
    "limit",
    "fetch",
    "union",
    "intersect",
    "except",
  ]
    .map((keyword) => findTopLevelSqlKeyword(query, keyword, relation.end))
    .filter((match): match is { start: number; end: number } => match !== null)
    .reduce((end, match) => Math.min(end, match.start), query.length);
  const joinBody = query.slice(relation.end, clauseEnd);
  const on = findTopLevelSqlKeyword(joinBody, "on");
  if (!on) return null;
  return joinBody.slice(on.end).trim();
}

function dashboardJoinIdentityRole(
  column: string,
  role: "user" | "organization",
  relationNames: string[],
): boolean {
  const normalizedColumn = column.replace(/[_-]+/g, " ").toLowerCase();
  if (!isCanonicalDashboardIdentityDimension(relationNames, role)) return false;
  if (role === "user") {
    return /^(?:id|user id|member id|person id|user key|member key|person key)$/.test(
      normalizedColumn,
    );
  }
  return /^(?:id|organization id|org id|workspace id|team id|organization key|org key|workspace key|team key)$/.test(
    normalizedColumn,
  );
}

function isCanonicalDashboardIdentityDimension(
  relationNames: string[],
  entity: "user" | "organization",
): boolean {
  if (relationNames.length !== 1) return false;
  const leaf = relationNames[0]!.split(".").pop() ?? "";
  const normalized = leaf
    .replace(/["`]/g, "")
    .toLowerCase()
    .replace(/^(?:dim|dimension)_/, "");
  const canonicalNames =
    entity === "user"
      ? DASHBOARD_USER_DIMENSION_NAMES
      : DASHBOARD_ORGANIZATION_DIMENSION_NAMES;
  return canonicalNames.has(normalized);
}

function dashboardJoinEqualityPairs(expression: string): Array<{
  leftAlias: string;
  leftColumn: string;
  rightAlias: string;
  rightColumn: string;
}> {
  const safeExpression = maskSqlStringLiterals(expression);
  if (/\bor\b/i.test(safeExpression)) return [];
  const identifier =
    '(?:"[a-z_][a-z0-9_$]*"|`[a-z_][a-z0-9_$]*`|[a-z_][a-z0-9_$]*)';
  const equality = new RegExp(
    `(${identifier})\\s*\\.\\s*(${identifier})\\s*=\\s*(${identifier})\\s*\\.\\s*(${identifier})`,
    "gi",
  );
  return Array.from(safeExpression.matchAll(equality), (match) => ({
    leftAlias: match[1]!.replace(/["`]/g, "").toLowerCase(),
    leftColumn: match[2]!.replace(/["`]/g, "").toLowerCase(),
    rightAlias: match[3]!.replace(/["`]/g, "").toLowerCase(),
    rightColumn: match[4]!.replace(/["`]/g, "").toLowerCase(),
  }));
}

function dashboardJoinConnectsMembershipIdentity(
  expression: string,
  joinedAlias: string,
  joinedRole: "user" | "organization",
  joinedRelations: string[],
  membershipAliases: Map<string, string[]>,
): boolean {
  for (const pair of dashboardJoinEqualityPairs(expression)) {
    const otherAlias =
      pair.leftAlias === joinedAlias
        ? pair.rightAlias
        : pair.rightAlias === joinedAlias
          ? pair.leftAlias
          : null;
    const otherColumn =
      pair.leftAlias === joinedAlias
        ? pair.rightColumn
        : pair.rightAlias === joinedAlias
          ? pair.leftColumn
          : null;
    const joinedColumn =
      pair.leftAlias === joinedAlias
        ? pair.leftColumn
        : pair.rightAlias === joinedAlias
          ? pair.rightColumn
          : null;
    if (!otherAlias || !otherColumn || !joinedColumn) continue;
    const membershipRelations = membershipAliases.get(otherAlias);
    if (
      !membershipRelations?.some((relation) =>
        hasDashboardIdentityColumnAtSource(otherColumn, relation, joinedRole),
      ) ||
      !dashboardJoinIdentityRole(joinedColumn, joinedRole, joinedRelations)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function dashboardJoinConnectsJoinedMembership(
  expression: string,
  joinedAlias: string,
  joinedMembershipRelations: string[],
  joinedRoles: Map<string, "user" | "organization">,
  physicalRelationsByAlias: Map<string, string[]>,
): boolean {
  for (const pair of dashboardJoinEqualityPairs(expression)) {
    const otherAlias =
      pair.leftAlias === joinedAlias
        ? pair.rightAlias
        : pair.rightAlias === joinedAlias
          ? pair.leftAlias
          : null;
    const membershipColumn =
      pair.leftAlias === joinedAlias
        ? pair.leftColumn
        : pair.rightAlias === joinedAlias
          ? pair.rightColumn
          : null;
    const identityColumn =
      pair.leftAlias === joinedAlias
        ? pair.rightColumn
        : pair.rightAlias === joinedAlias
          ? pair.leftColumn
          : null;
    const role = otherAlias ? joinedRoles.get(otherAlias) : null;
    if (!otherAlias || !membershipColumn || !identityColumn || !role) continue;
    if (
      joinedMembershipRelations.some((relation) =>
        hasDashboardIdentityColumnAtSource(membershipColumn, relation, role),
      ) &&
      dashboardJoinIdentityRole(
        identityColumn,
        role,
        physicalRelationsByAlias.get(otherAlias) ?? [],
      )
    ) {
      return true;
    }
  }
  return false;
}

function dashboardJoinsPreserveMembershipIdentity(
  query: string,
  inheritedCtes: Map<string, DashboardCteDefinition>,
): boolean {
  const relations = dashboardTopLevelRelationReferences(query);
  const joins = relations.filter((relation) => relation.joinKind !== null);
  if (!joins.length) return true;
  if (
    joins.some((relation) =>
      /\b(?:cross|natural|right|full)\b/.test(relation.joinKind ?? ""),
    )
  ) {
    return false;
  }

  const memberships = new Map<string, string[]>();
  const joinedRoles = new Map<string, "user" | "organization">();
  const physicalRelationsByAlias = new Map<string, string[]>();
  for (const relation of relations) {
    const physical = dashboardPhysicalRelationNamesForReference(
      relation,
      inheritedCtes,
    );
    if (
      hasMembershipRelationEvidence(physical.join(" ").replace(/[_-]+/g, " "))
    ) {
      memberships.set(relation.alias, physical);
      continue;
    }
    const normalized = physical.join(" ").replace(/[_-]+/g, " ");
    const isUser = /\b(?:users?|members?|people|persons?)\b/i.test(normalized);
    const isOrganization =
      /\b(?:organizations?|orgs?|workspaces?|teams?)\b/i.test(normalized);
    if (isUser === isOrganization) continue;
    physicalRelationsByAlias.set(relation.alias, physical);
    joinedRoles.set(relation.alias, isUser ? "user" : "organization");
  }
  if (!memberships.size) return false;

  const sql = stripSqlComments(query);
  if (!sql) return false;
  for (const join of joins) {
    const membershipRelations = memberships.get(join.alias);
    if (membershipRelations) {
      const on = dashboardJoinOnExpression(sql, join);
      if (
        join.joinKind !== "inner" ||
        !on ||
        !dashboardJoinConnectsJoinedMembership(
          on,
          join.alias,
          membershipRelations,
          joinedRoles,
          physicalRelationsByAlias,
        )
      ) {
        return false;
      }
      continue;
    }
    const role = joinedRoles.get(join.alias);
    const on = dashboardJoinOnExpression(sql, join);
    if (
      !role ||
      !on ||
      !dashboardJoinConnectsMembershipIdentity(
        on,
        join.alias,
        role,
        physicalRelationsByAlias.get(join.alias) ?? [],
        memberships,
      )
    ) {
      return false;
    }
  }
  return true;
}

function hasDashboardIdentityColumnAtSource(
  column: string,
  relation: string,
  entity: "user" | "organization",
): boolean {
  const normalizedColumn = column.replace(/[_-]+/g, " ");
  const normalizedRelation = relation.replace(/[_-]+/g, " ");
  const isUserTable = /\b(?:users?|members?|people|persons?)\b/.test(
    normalizedRelation,
  );
  const isOrganizationTable =
    /\b(?:organizations?|orgs?|workspaces?|teams?)\b/.test(normalizedRelation);
  const isMembershipTable = hasMembershipRelationEvidence(normalizedRelation);

  if (entity === "user") {
    if (hasMembershipIdentityKey(normalizedColumn)) {
      return isMembershipTable || isUserTable;
    }
    if (/\b(?:user|member|person)\s+(?:email|key)\b/.test(normalizedColumn)) {
      return isMembershipTable || isUserTable;
    }
    return (
      isUserTable &&
      /^(?:id|email|email_address|full_name|display_name|name)$/.test(column)
    );
  }

  if (hasOrganizationIdentityKey(normalizedColumn)) {
    return isMembershipTable || isOrganizationTable;
  }
  if (
    /\b(?:organization|org|workspace|team)\s+(?:key|name)\b/.test(
      normalizedColumn,
    )
  ) {
    return isMembershipTable || isOrganizationTable;
  }
  return isOrganizationTable && /^(?:id|name|slug|key)$/.test(column);
}

function dashboardProjectionExpressionHasIdentity(
  expression: string,
  entity: "user" | "organization",
  query: string,
  aliasExpressions: string[],
  inheritedCtes: Map<string, DashboardCteDefinition>,
  visitedAliases: Set<string>,
  visitedCtes: Set<string>,
): boolean {
  const parsed = splitDashboardProjectionAlias(expression);
  const path = simpleSqlIdentifierPath(parsed.expression);
  if (!path) return false;
  const ctes = new Map(inheritedCtes);
  const queryCtes = dashboardCteDefinitions(query);
  if (queryCtes === null) return false;
  for (const [name, definition] of queryCtes) {
    ctes.set(name, definition);
  }

  const selectedAliases = new Map<string, string>();
  for (const projection of aliasExpressions) {
    const alias = splitDashboardProjectionAlias(projection);
    if (alias.alias) selectedAliases.set(alias.alias, alias.expression);
  }
  if (path.length === 1 && selectedAliases.has(path[0]!)) {
    const alias = path[0]!;
    if (visitedAliases.has(alias)) return false;
    return dashboardProjectionExpressionHasIdentity(
      selectedAliases.get(alias)!,
      entity,
      query,
      aliasExpressions,
      ctes,
      new Set(visitedAliases).add(alias),
      visitedCtes,
    );
  }

  const relations = dashboardTopLevelRelationReferences(query);
  const relationAliases = dashboardRelationAliases(query);
  const relation =
    path.length > 1
      ? relationAliases.get(path[path.length - 2]!)
      : relations.length === 1
        ? relations[0]!.name
        : undefined;
  if (!relation || relation === DERIVED_DASHBOARD_RELATION) return false;

  const column = path[path.length - 1]!;
  const cte = ctes.get(relation);
  if (cte) {
    if (visitedCtes.has(relation)) return false;
    const projections = dashboardCteProjection(cte, column);
    if (!projections?.length) return false;
    const nextVisited = new Set(visitedCtes).add(relation);
    return projections.every((projection) =>
      dashboardProjectionExpressionHasIdentity(
        projection.expression,
        entity,
        projection.query,
        projection.selectExpressions,
        ctes,
        new Set(),
        nextVisited,
      ),
    );
  }
  return hasDashboardIdentityColumnAtSource(column, relation, entity);
}

function hasDashboardProjectionEntity(
  expressions: string[],
  entity: "user" | "organization",
  query: string,
  aliasExpressions = expressions,
  inheritedCtes: Map<string, DashboardCteDefinition> = new Map(),
): boolean {
  const ctes = new Map(inheritedCtes);
  const queryCtes = dashboardCteDefinitions(query);
  if (queryCtes === null) return false;
  for (const [name, definition] of queryCtes) {
    ctes.set(name, definition);
  }
  return expressions.some((projection) =>
    dashboardProjectionExpressionHasIdentity(
      projection,
      entity,
      query,
      aliasExpressions,
      ctes,
      new Set(),
      new Set(),
    ),
  );
}

function hasRowLevelDashboardMembershipOutput(
  candidate: DashboardPanelCandidate,
) {
  if (typeof candidate.query !== "string") return false;
  const cached = dashboardMembershipOutputCache.get(candidate);
  if (cached?.query === candidate.query) return cached.result;
  const parsed = parseSimpleDashboardMembershipQuery(candidate.query);
  if (!parsed) {
    dashboardMembershipOutputCache.set(candidate, {
      query: candidate.query,
      result: false,
    });
    return false;
  }
  const inheritedCtes = dashboardCteDefinitions(candidate.query);
  if (inheritedCtes === null) {
    dashboardMembershipOutputCache.set(candidate, {
      query: candidate.query,
      result: false,
    });
    return false;
  }
  const result = parsed.every((branch) => {
    const physicalRelations = dashboardPhysicalRelationNames(
      branch.sql,
      inheritedCtes,
    );
    if (
      dashboardHasTopLevelCommaJoin(branch.sql) ||
      !dashboardJoinsPreserveMembershipIdentity(branch.sql, inheritedCtes) ||
      !physicalRelations.length ||
      !hasMembershipRelationEvidence(
        physicalRelations
          .map((relation) => relation.replace(/[_-]+/g, " "))
          .join(" "),
      ) ||
      !hasDashboardProjectionEntity(
        branch.selectExpressions,
        "user",
        branch.sql,
        branch.selectExpressions,
        inheritedCtes,
      ) ||
      !hasDashboardProjectionEntity(
        branch.selectExpressions,
        "organization",
        branch.sql,
        branch.selectExpressions,
        inheritedCtes,
      )
    ) {
      return false;
    }
    if (
      branch.qualifyExpression &&
      !hasRowLevelMembershipQualify(
        branch.qualifyExpression,
        branch.sql,
        branch.selectExpressions,
        inheritedCtes,
      )
    ) {
      return false;
    }
    if (!branch.groupByExpressions) {
      return !hasAggregateSelectExpression(branch.selectExpressions);
    }
    const normalizedGroupBy = branch.groupByExpressions
      .join(" ")
      .toLowerCase()
      .replace(/[_-]+/g, " ");
    if (
      /\b(?:date|day|week|month|quarter|year|period|snapshot)\b/.test(
        normalizedGroupBy,
      )
    ) {
      return false;
    }
    return (
      hasDashboardProjectionEntity(
        branch.groupByExpressions,
        "user",
        branch.sql,
        branch.selectExpressions,
        inheritedCtes,
      ) &&
      hasDashboardProjectionEntity(
        branch.groupByExpressions,
        "organization",
        branch.sql,
        branch.selectExpressions,
        inheritedCtes,
      )
    );
  });
  dashboardMembershipOutputCache.set(candidate, {
    query: candidate.query,
    result,
  });
  return result;
}

function dashboardHasTopLevelCommaJoin(query: string): boolean {
  const sql = stripSqlComments(query);
  if (!sql) return true;
  const from = findTopLevelSqlKeyword(sql, "from");
  if (!from) return true;
  const clauseEnd = [
    "where",
    "group by",
    "having",
    "qualify",
    "order by",
    "limit",
    "fetch",
    "union",
    "intersect",
    "except",
  ]
    .map((keyword) => findTopLevelSqlKeyword(sql, keyword, from.end))
    .filter((match): match is { start: number; end: number } => match !== null)
    .reduce((end, match) => Math.min(end, match.start), sql.length);
  const fromClause = sql.slice(from.end, clauseEnd);
  return (splitTopLevelSqlList(fromClause)?.length ?? 0) > 1;
}

function hasAggregateSelectExpression(expressions: string[]): boolean {
  return expressions.some((expression) => {
    const sql = maskNestedDashboardSubqueries(
      maskSqlStringLiterals(expression),
    );
    const aggregateCalls = /\b(?:count|sum|avg|average|min|max|median)\s*\(/gi;
    for (const aggregate of sql.matchAll(aggregateCalls)) {
      const openParen = aggregate.index! + aggregate[0].lastIndexOf("(");
      const closeParen = matchingSqlParenthesis(sql, openParen);
      if (closeParen === null) return true;

      let cursor = skipSqlWhitespace(sql, closeParen + 1);
      const filterEnd = sqlKeywordEndAt(sql, cursor, "filter");
      if (filterEnd !== null) {
        cursor = skipSqlWhitespace(sql, filterEnd);
        if (sql[cursor] !== "(") return true;
        const filterClose = matchingSqlParenthesis(sql, cursor);
        if (filterClose === null) return true;
        cursor = skipSqlWhitespace(sql, filterClose + 1);
      }

      const overEnd = sqlKeywordEndAt(sql, cursor, "over");
      if (overEnd === null || sql[skipSqlWhitespace(sql, overEnd)] !== "(") {
        return true;
      }
    }
    return false;
  });
}

function maskNestedDashboardSubqueries(sql: string): string {
  const output = sql.split("");
  for (let index = 0; index < sql.length; index += 1) {
    if (sql[index] !== "(") continue;
    const close = matchingSqlParenthesis(sql, index);
    if (close === null) continue;
    const queryStart = skipSqlWhitespace(sql, index + 1);
    if (
      sqlKeywordEndAt(sql, queryStart, "select") === null &&
      sqlKeywordEndAt(sql, queryStart, "with") === null
    ) {
      continue;
    }
    for (let cursor = index; cursor <= close; cursor += 1) {
      if (output[cursor] !== "\n") output[cursor] = " ";
    }
    index = close;
  }
  return output.join("");
}

function hasRowLevelMembershipQualify(
  qualifyExpression: string,
  query: string,
  selectExpressions: string[],
  inheritedCtes: Map<string, DashboardCteDefinition>,
): boolean {
  const rowNumber = /\brow_number\s*\(\s*\)\s*over\s*\(/i.exec(
    qualifyExpression,
  );
  if (!rowNumber) return false;
  const openParen = rowNumber.index + rowNumber[0].lastIndexOf("(");
  const closeParen = matchingSqlParenthesis(qualifyExpression, openParen);
  if (
    closeParen === null ||
    !/^\s*(?:=|<=)\s*1\b/i.test(qualifyExpression.slice(closeParen + 1))
  ) {
    return false;
  }
  const window = qualifyExpression.slice(openParen + 1, closeParen);
  const partition = findTopLevelSqlKeyword(window, "partition by");
  if (!partition) return false;
  const orderBy = findTopLevelSqlKeyword(window, "order by", partition.end);
  const partitionExpressions = splitTopLevelSqlList(
    window.slice(partition.end, orderBy?.start ?? window.length),
  );
  return (
    partitionExpressions !== null &&
    hasDashboardProjectionEntity(
      partitionExpressions,
      "user",
      query,
      selectExpressions,
      inheritedCtes,
    ) &&
    hasDashboardProjectionEntity(
      partitionExpressions,
      "organization",
      query,
      selectExpressions,
      inheritedCtes,
    )
  );
}

function hasMembershipRelationEvidence(value: string): boolean {
  return (
    /\bmemberships?\b/.test(value) ||
    /\b(?:(?:user|member)\s+)?(?:organization|org|workspace|team)\s+memberships?\b/.test(
      value,
    ) ||
    /\b(?:workspace|team)\s+members?\b/.test(value) ||
    /\b(?:user|member)\s+(?:organization|org|workspace|team)\s+roles?\b/.test(
      value,
    ) ||
    /\b(?:user|member)\s+(?:organizations?|orgs?|workspaces?|teams?)\b/.test(
      value,
    )
  );
}

function hasExplicitNonMembershipScope(
  candidate: AnalyticsQueryCatalogCandidate,
): boolean {
  if (
    candidate.kind !== "data-dictionary" ||
    isStaleGeneratedSourceIndexEntry(candidate)
  ) {
    return false;
  }
  const scope = candidate.semanticScope;
  return (
    typeof scope === "string" &&
    scope !== "unknown" &&
    SEMANTIC_SCOPES.has(scope) &&
    scope !== "membership" &&
    scope !== "membership_roster"
  );
}

function hasExplicitActivityEvidence(
  candidate: AnalyticsQueryCatalogCandidate,
): boolean {
  const values =
    candidate.kind === "data-dictionary"
      ? [
          candidate.metric,
          candidate.definition,
          candidate.source,
          candidate.table,
          candidate.semanticModel,
        ]
      : [
          typeof candidate.query === "string"
            ? (stripSqlComments(candidate.query) ?? candidate.query)
            : candidate.query,
        ];
  const searchable = values
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (
    /\b(?:events?|activities?|usage(?: logs?)?|sessions?|funnels?|conversions?)\b/.test(
      searchable,
    )
  ) {
    return true;
  }
  if (
    candidate.kind === "data-dictionary" &&
    !isStaleGeneratedSourceIndexEntry(candidate) &&
    (candidate.semanticScope === "membership" ||
      candidate.semanticScope === "membership_roster")
  ) {
    return false;
  }
  return inferSemanticScope(searchable) === "product_activity";
}

function hasActiveOnlyMembershipEvidence(
  candidate: AnalyticsQueryCatalogCandidate,
): boolean {
  const scope = candidateSemanticScope(candidate);
  if (scope !== "membership" && scope !== "membership_roster") return false;
  const values =
    candidate.kind === "data-dictionary"
      ? [
          candidate.metric,
          candidate.definition,
          candidate.table,
          candidate.semanticModel,
        ]
      : [
          candidate.panelTitle,
          candidate.panelDescription,
          typeof candidate.query === "string"
            ? (stripSqlComments(candidate.query) ?? candidate.query)
            : candidate.query,
        ];
  const searchable = values
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  return /(?:\b(?<!non )active\s+(?:(?:workspace|organization|org|team)\s+)?(?:users?|members?)\b|\b(?:(?:workspace|organization|org|team)\s+)?(?:users?|members?)\s+(?:who\s+)?(?:are\s+)?(?<!non )active\b)/.test(
    searchable,
  );
}

function activeMemberPhrasePolarity(search: string): {
  positive: boolean;
  negated: boolean;
} {
  const intent = stripNonPositiveInstructions(search);
  const activeMemberPhrase =
    /\b(?<!non[- ])(?:active\s+(?:(?:workspace|organization|org|team)\s+)?(?:users?|members?)|(?:(?:workspace|organization|org|team)\s+)?(?:users?|members?)\s+(?:who\s+)?(?:are\s+)?active)\b/gi;
  const negativeInstructionBeforePhrase =
    /\b(?:no|not|never|don't|do\s+not|cannot|can't|without)\b(?:\s+[\p{L}\p{N}'-]+){0,4}\s*$/iu;
  const removalInstruction =
    /\b(?:exclud(?:e|ing|ed|es)|skip(?:ped|ping|s)?|omit(?:ted|ting|s)?|remov(?:e|ing|ed|es)|filter(?:s|ed|ing)?(?:\s+out)?|leav(?:e|ing)\s+out)\b/giu;
  const negatedRemovalOperatorBefore =
    /\b(?:(?:do|does|did)\s+not|don't|doesn't|didn't|never|cannot|can't|not(?:\s+to)?|without)\s*$/iu;
  const exceptionBeforePhrase =
    /\b(?:but|except(?:\s+for)?|other\s+than|aside\s+from|apart\s+from)\s*$/iu;
  const negativeInstructionAfterPhrase =
    /^\s*(?:(?:are|were|will be|should be|must be|need to be|have been)\s+)?(?:excluded|omitted|removed|left\s+out|filtered\s+out|not\s+included)\b/iu;
  const positiveContinuation =
    /(?:^|[;,.!?]|\b(?:but|and)\b)\s*(?:please\s+)?(?:show|include|report|return|provide|display|list|find|compare|calculate|summarize)\b/giu;

  const matches = Array.from(intent.matchAll(activeMemberPhrase));
  const isNegated = (match: RegExpMatchArray) => {
    const prefix = intent.slice(0, match.index ?? 0);
    const continuations = Array.from(prefix.matchAll(positiveContinuation));
    const lastContinuation = continuations[continuations.length - 1];
    const scopedPrefix = lastContinuation
      ? prefix.slice((lastContinuation.index ?? 0) + lastContinuation[0].length)
      : prefix;
    const removals = Array.from(scopedPrefix.matchAll(removalInstruction));
    const lastRemoval = removals[removals.length - 1];
    if (lastRemoval) {
      const beforeRemoval = scopedPrefix.slice(0, lastRemoval.index ?? 0);
      const afterRemoval = scopedPrefix.slice(
        (lastRemoval.index ?? 0) + lastRemoval[0].length,
      );
      if (exceptionBeforePhrase.test(afterRemoval)) return false;
      if (!negatedRemovalOperatorBefore.test(beforeRemoval)) return true;
      if (negativeInstructionBeforePhrase.test(afterRemoval)) return true;
      const end = (match.index ?? 0) + match[0].length;
      return negativeInstructionAfterPhrase.test(intent.slice(end));
    }
    if (exceptionBeforePhrase.test(scopedPrefix)) return true;
    if (negativeInstructionBeforePhrase.test(scopedPrefix)) return true;
    const end = (match.index ?? 0) + match[0].length;
    return negativeInstructionAfterPhrase.test(intent.slice(end));
  };
  const negated = matches.some(isNegated);
  const positive = matches.some((match) => {
    return !isNegated(match);
  });
  return { positive, negated };
}

function requestsActiveMembers(search: string): boolean {
  return activeMemberPhrasePolarity(search).positive;
}

function isRosterDimensionCandidate(
  candidate: AnalyticsQueryCatalogCandidate,
): boolean {
  if (candidate.kind !== "data-dictionary" || hasAggregateShape(candidate)) {
    return false;
  }
  if (
    hasExplicitNonMembershipScope(candidate) ||
    hasExplicitActivityEvidence(candidate)
  ) {
    return false;
  }
  const grain = (candidate.grain ?? "").toLowerCase().replace(/[_-]+/g, " ");
  if (!/\b(?:one|single)\s+row\s+per\b/.test(grain)) return false;
  if (/\bmembership\b/.test(grain)) return false;
  if (/\bper\s+(?:day|week|month|quarter|year)\b/.test(grain)) return false;
  const isUserGrain = /\b(?:users?|people|persons?|members?)\b/.test(grain);
  const isOrganizationGrain =
    /\b(?:organizations?|orgs?|workspaces?|teams?)\b/.test(grain);
  const columns = (candidate.columnsUsed ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  const hasMembershipKeys =
    hasMembershipIdentityKey(columns) && hasOrganizationIdentityKey(columns);
  return isUserGrain && isOrganizationGrain && hasMembershipKeys;
}

function rosterCandidateSupportsRequestedDetail(
  candidate: AnalyticsQueryCatalogCandidate,
  search: string,
): boolean {
  // Keep stale entries available as leads; ranking must not trust their claims.
  if (isStaleGeneratedSourceIndexEntry(candidate)) return true;
  if (
    hasExplicitNonMembershipScope(candidate) ||
    hasExplicitActivityEvidence(candidate) ||
    candidateSemanticScope(candidate) === "product_activity"
  ) {
    return false;
  }
  const requestsRoleDetail = requestsMembershipRoleDetail(search);
  const hasRosterEvidence =
    hasMembershipRosterEvidence(candidate) ||
    hasMatchingHistoricalMembershipSnapshot(candidate, search);
  if (requestsRoleDetail) {
    return hasRosterEvidence && hasMembershipRoleField(candidate);
  }
  if (isRosterDimensionCandidate(candidate)) return true;
  return hasRosterEvidence;
}

export function candidateSemanticScope(
  candidate: AnalyticsQueryCatalogCandidate,
): string {
  if (isStaleGeneratedSourceIndexEntry(candidate)) {
    return "unknown";
  }
  if (candidate.kind === "data-dictionary") {
    const declared = candidate.semanticScope;
    if (declared && declared !== "unknown" && SEMANTIC_SCOPES.has(declared)) {
      return declared;
    }
    return inferSemanticScope(
      [
        candidate.metric,
        candidate.definition,
        candidate.source,
        candidate.table,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  if (hasMembershipRosterEvidence(candidate)) return "membership_roster";
  return inferSemanticScope(
    [
      candidate.dashboardTitle,
      candidate.dashboardDescription,
      candidate.panelTitle,
      candidate.panelDescription,
      candidate.query
        ? typeof candidate.query === "string"
          ? candidate.query
          : JSON.stringify(candidate.query)
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function requestedSemanticScope(search: string): string {
  return inferSemanticScope(search);
}

export function candidateScopeCompatibility(
  candidate: AnalyticsQueryCatalogCandidate,
  search: string,
): number {
  const requested = requestedSemanticScope(search);
  if (requested === "unknown") return 1;
  const candidateScope = candidateSemanticScope(candidate);
  return semanticScopeCompatibility(candidateScope, requested);
}

function dashboardPanelCandidates(args: {
  dashboardId: string;
  dashboardTitle: string;
  dashboardDescription?: string;
  config: Record<string, unknown>;
  origin: "saved-dashboard" | "dashboard-template";
  search: string;
  certification: DashboardCertification | null;
  dashboardUpdatedAt?: string;
  favorite: boolean;
}): AnalyticsQueryCatalogCandidate[] {
  const panels = Array.isArray(args.config.panels)
    ? (args.config.panels as DashboardPanel[])
    : [];

  const wantsDemo = /\bdemo\b|node exporter/i.test(args.search);

  return panels.flatMap((panel) => {
    if (isRetiredCatalogReference(panel)) return [];
    if (!wantsDemo && text(panel.source) === "demo") return [];
    const query = compactQuery(panel.sql);
    const panelConfig =
      panel.config &&
      typeof panel.config === "object" &&
      !Array.isArray(panel.config)
        ? (panel.config as Record<string, unknown>)
        : {};
    const panelTitle = text(panel.title) || text(panel.id);
    const panelDescription = text(panelConfig.description);
    const {
      score: rawScore,
      matchedTerms,
      exactMatchedTerms,
    } = matchScore(args.search, [
      { value: panelTitle, weight: 24 },
      { value: panelDescription, weight: 12 },
      { value: args.dashboardTitle, weight: 10 },
      { value: args.dashboardDescription, weight: 6 },
      { value: panel.source, weight: 5 },
      {
        value: query
          ? typeof query === "string"
            ? query
            : JSON.stringify(query)
          : "",
        weight: 8,
      },
    ]);
    const requestedTerms = new Set(searchTerms(args.search));
    const titleMatchedTerms = matchScore(args.search, [
      { value: panelTitle, weight: 1 },
    ]).matchedTerms;
    const strongTitleTerms = titleMatchedTerms.filter(
      (term) => !LOW_INFORMATION_TERMS.has(term),
    ).length;
    const dashboardTitleMatchedTerms = matchScore(args.search, [
      { value: args.dashboardTitle, weight: 1 },
    ]).matchedTerms;
    const titleSpecificityPenalty =
      (titleMatchedTerms.length
        ? Math.min(unrelatedNameTerms(args.search, panelTitle).length, 4) * 12
        : 0) +
      (dashboardTitleMatchedTerms.length
        ? Math.min(
            unrelatedNameTerms(args.search, args.dashboardTitle).length,
            4,
          ) * 4
        : 0);
    const titleIsOnTopic =
      requestedTerms.size > 0 &&
      (strongTitleTerms >= 2 ||
        titleMatchedTerms.length / requestedTerms.size >= 0.6);
    const missingQueryPenalty = query || titleIsOnTopic ? 0 : 10;
    const aggregateIntent =
      /\b(how many|count|number|total)\b/i.test(args.search) &&
      text(panel.chartType) === "metric"
        ? 20
        : 0;
    const relevanceScore =
      rawScore -
      titleSpecificityPenalty -
      missingQueryPenalty +
      aggregateIntent;
    if (rawScore <= 0) return [];
    const adjustedRelevanceScore = Math.max(1, relevanceScore);
    const dashboardCertified = Boolean(
      args.dashboardUpdatedAt &&
      isDashboardCertified(args.certification, args.dashboardUpdatedAt),
    );
    const score =
      adjustedRelevanceScore +
      (dashboardCertified ? 60 : 0) +
      (args.favorite ? 20 : 0);

    return [
      {
        kind: "dashboard-panel" as const,
        origin: args.origin,
        score,
        matchedTerms,
        exactMatchedTerms,
        dashboardId: args.dashboardId,
        dashboardTitle: args.dashboardTitle,
        ...(args.dashboardDescription
          ? { dashboardDescription: args.dashboardDescription }
          : {}),
        panelId: text(panel.id),
        panelTitle,
        ...(panelDescription ? { panelDescription } : {}),
        ...(text(panel.source) ? { source: text(panel.source) } : {}),
        ...(query ? { query } : {}),
        ...(text(panelConfig.timeScope)
          ? { timeScope: text(panelConfig.timeScope) }
          : {}),
        ...(args.certification
          ? { dashboardCertification: args.certification }
          : {}),
        dashboardCertified,
        ...(args.favorite ? { favorite: true } : {}),
      },
    ];
  });
}

function dictionaryCandidates(
  entries: DictionaryEntry[],
  search: string,
): AnalyticsQueryCatalogCandidate[] {
  const candidates = entries.flatMap((entry) => {
    if (isRetiredCatalogReference(entry)) return [];
    const {
      score: rawScore,
      matchedTerms,
      exactMatchedTerms,
    } = matchScore(search, [
      { value: entry.metric, weight: 28 },
      { value: entry.commonQuestions, weight: 16 },
      { value: entry.definition, weight: 12 },
      { value: entry.table, weight: 8 },
      { value: entry.columnsUsed, weight: 6 },
      { value: entry.sqlProjectedColumns, weight: 4 },
      { value: entry.queryTemplate, weight: 5 },
      { value: entry.source, weight: 5 },
      { value: entry.action, weight: 5 },
      { value: entry.knownGotchas, weight: 2 },
      { value: entry.grain, weight: 10 },
      { value: entry.primaryEntity, weight: 7 },
      { value: entry.timeDimension, weight: 5 },
      { value: entry.semanticModel, weight: 8 },
      { value: entry.owner, weight: 3 },
    ]);
    const metricMatch = matchScore(search, [
      { value: entry.metric, weight: 1 },
    ]);
    const requestedTerms = searchTerms(search);
    const exactSingleTermMetricMatch =
      requestedTerms.length === 1 &&
      metricMatch.exactMatchedTerms.includes(requestedTerms[0] ?? "");
    const metricNamePenalty =
      metricMatch.matchedTerms.length && !exactSingleTermMetricMatch
        ? Math.min(unrelatedNameTerms(search, text(entry.metric)).length, 4) *
          12
        : 0;
    if (rawScore <= 0) return [];
    const score = Math.max(1, rawScore - metricNamePenalty);
    const isSourceIndex = entry.sourceIndex === true;
    const declaredScope = text(entry.semanticScope);
    const semanticScope =
      declaredScope && declaredScope !== "unknown"
        ? declaredScope
        : inferSemanticScope(
            [entry.metric, entry.definition, entry.source, entry.table]
              .filter(Boolean)
              .join(" "),
          );
    const entrySourceKind = sourceKind(entry.sourceKind);
    const entryType = sourceEntryType(entry.entryType);
    const status = sourceEntryStatus(entry.status);
    const id = text(entry.id);
    const metric = text(entry.metric);
    const inferredMembershipKeyRoles =
      isSourceIndex && entrySourceKind === "dbt"
        ? membershipKeyRoles(entry.inferredMembershipKeyRoles)
        : undefined;
    if (!id || !metric) return [];
    return [
      {
        kind: "data-dictionary" as const,
        origin: isSourceIndex
          ? ("source-index" as const)
          : ("data-dictionary" as const),
        score:
          score +
          (entry.approved === true && entry.sourceIndexStale !== true ? 12 : 0),
        matchedTerms,
        exactMatchedTerms,
        id,
        metric,
        ...(text(entry.definition)
          ? { definition: text(entry.definition) }
          : {}),
        ...(text(entry.source) ? { source: text(entry.source) } : {}),
        ...(text(entry.action) ? { action: text(entry.action) } : {}),
        ...(text(entry.table) ? { table: text(entry.table) } : {}),
        ...(text(entry.columnsUsed)
          ? { columnsUsed: text(entry.columnsUsed) }
          : {}),
        ...(text(entry.sqlProjectedColumns)
          ? { sqlProjectedColumns: text(entry.sqlProjectedColumns) }
          : {}),
        ...(isSourceIndex &&
        entrySourceKind === "dbt" &&
        Array.isArray(entry.inferredMembershipKeys) &&
        entry.inferredMembershipKeys.every(
          (key): key is string => typeof key === "string",
        )
          ? { inferredMembershipKeys: entry.inferredMembershipKeys }
          : {}),
        ...(inferredMembershipKeyRoles ? { inferredMembershipKeyRoles } : {}),
        ...(text(entry.queryTemplate)
          ? { queryTemplate: text(entry.queryTemplate) }
          : {}),
        ...(text(entry.knownGotchas)
          ? { knownGotchas: text(entry.knownGotchas) }
          : {}),
        ...(text(entry.commonQuestions)
          ? { commonQuestions: text(entry.commonQuestions) }
          : {}),
        ...(text(entry.cuts) ? { cuts: text(entry.cuts) } : {}),
        ...(text(entry.joinPattern)
          ? { joinPattern: text(entry.joinPattern) }
          : {}),
        ...(text(entry.updateFrequency)
          ? { updateFrequency: text(entry.updateFrequency) }
          : {}),
        ...(text(entry.dataLag) ? { dataLag: text(entry.dataLag) } : {}),
        ...(text(entry.dependencies)
          ? { dependencies: text(entry.dependencies) }
          : {}),
        ...(text(entry.validDateRange)
          ? { validDateRange: text(entry.validDateRange) }
          : {}),
        ...(text(entry.owner) ? { owner: text(entry.owner) } : {}),
        ...(typeof entry.approved === "boolean"
          ? { approved: entry.approved }
          : {}),
        ...(typeof entry.aiGenerated === "boolean"
          ? { aiGenerated: entry.aiGenerated }
          : {}),
        ...(entrySourceKind ? { sourceKind: entrySourceKind } : {}),
        ...(entryType ? { entryType } : {}),
        ...(status ? { status } : {}),
        ...(text(entry.grain) ? { grain: text(entry.grain) } : {}),
        ...(text(entry.primaryEntity)
          ? { primaryEntity: text(entry.primaryEntity) }
          : {}),
        ...(text(entry.timeDimension)
          ? { timeDimension: text(entry.timeDimension) }
          : {}),
        ...(text(entry.semanticModel)
          ? { semanticModel: text(entry.semanticModel) }
          : {}),
        ...(text(entry.sourceUrl) ? { sourceUrl: text(entry.sourceUrl) } : {}),
        ...(semanticScope !== "unknown" ? { semanticScope } : {}),
        ...(text(entry.sourcePath)
          ? { sourcePath: text(entry.sourcePath) }
          : {}),
        ...(text(entry.sourceRevision)
          ? { sourceRevision: text(entry.sourceRevision) }
          : {}),
        ...(text(entry.sourceIndexGeneratedAt)
          ? { sourceIndexGeneratedAt: text(entry.sourceIndexGeneratedAt) }
          : {}),
        ...(text(entry.sourceIndexSources)
          ? { sourceIndexSources: text(entry.sourceIndexSources) }
          : {}),
        ...(typeof entry.sourceIndexAgeDays === "number"
          ? { sourceIndexAgeDays: entry.sourceIndexAgeDays }
          : {}),
        ...(typeof entry.sourceIndexStaleAfterDays === "number"
          ? { sourceIndexStaleAfterDays: entry.sourceIndexStaleAfterDays }
          : {}),
        ...(typeof entry.sourceIndexStale === "boolean"
          ? { sourceIndexStale: entry.sourceIndexStale }
          : {}),
        ...(typeof entry.sourceIndexFreshnessUnknown === "boolean"
          ? { sourceIndexFreshnessUnknown: entry.sourceIndexFreshnessUnknown }
          : {}),
      },
    ];
  });
  const strongestHumanOrApprovedScore = candidates.reduce(
    (strongest, candidate) =>
      candidate.approved === true || candidate.aiGenerated !== true
        ? Math.max(strongest, candidate.score)
        : strongest,
    0,
  );
  return candidates.filter(
    (candidate) =>
      candidate.origin === "source-index" ||
      candidate.aiGenerated !== true ||
      candidate.approved === true ||
      candidate.score > strongestHumanOrApprovedScore,
  );
}

function candidateIsRunnable(
  candidate: AnalyticsQueryCatalogCandidate,
): boolean {
  return candidate.kind === "dashboard-panel"
    ? Boolean(candidate.query)
    : Boolean(candidate.queryTemplate);
}

function candidateExactMatchedTerms(
  candidate: AnalyticsQueryCatalogCandidate,
): string[] {
  return candidate.exactMatchedTerms ?? [];
}

function candidateDedupeKey(candidate: AnalyticsQueryCatalogCandidate): string {
  if (candidate.kind === "data-dictionary") return `dict:${candidate.id}`;
  const query =
    typeof candidate.query === "string"
      ? candidate.query
      : JSON.stringify(candidate.query ?? "");
  return `panel:${candidate.panelTitle.toLowerCase()}:${query
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()}`;
}

export function candidateTrustTier(
  candidate: AnalyticsQueryCatalogCandidate,
): number {
  if (candidate.kind === "data-dictionary") {
    return dataDictionaryTrustRank(candidate);
  }
  if (candidate.dashboardCertified) return 2;
  return candidate.favorite ? 1 : 0;
}

function candidateQueryRankingTierForTerms(
  candidate: AnalyticsQueryCatalogCandidate,
  requestedTerms: ReadonlySet<string>,
): number {
  const hasExactQueryCoverage =
    requestedTerms.size > 0 &&
    [...requestedTerms].every((term) =>
      candidateExactMatchedTerms(candidate).includes(term),
    );
  if (
    candidate.kind === "data-dictionary" &&
    candidate.approved === true &&
    !isStaleGeneratedSourceIndexEntry(candidate) &&
    hasExactQueryCoverage
  ) {
    return 2;
  }
  if (
    candidate.kind === "dashboard-panel" &&
    ((candidate.dashboardCertified && hasExactQueryCoverage) ||
      (candidateIsRunnable(candidate) &&
        requestedTerms.size > 1 &&
        hasExactQueryCoverage))
  ) {
    return 1;
  }
  return 0;
}

export function candidateQueryPriority(
  candidate: AnalyticsQueryCatalogCandidate,
  search: string,
): {
  rosterSpecificity: number;
  membershipRowSpecificity: number;
  rankingTier: number;
  trust: number;
  activeSubsetSpecificity: number;
  scope: number;
  freshness: number;
} {
  const rankingIntent = stripNonPositiveInstructions(search);
  const requestedScope = requestedSemanticScope(rankingIntent);
  const aggregateRequest = isAggregateRequest(rankingIntent);
  const plainMembershipRequest =
    requestedScope === "membership" && !aggregateRequest;
  const historicalMembershipRequest =
    isHistoricalMembershipRequest(rankingIntent);
  const rosterRequest = isMembershipRosterRequest(rankingIntent);
  const requestsRoleDetail = requestsMembershipRoleDetail(rankingIntent);
  const requestedActiveMembers =
    (requestedScope === "membership" ||
      requestedScope === "membership_roster") &&
    requestsActiveMembers(rankingIntent);
  const requestedTerms = new Set(searchTerms(rankingIntent));
  const staleSourceIndex = isStaleGeneratedSourceIndexEntry(candidate);
  const hasRosterEvidence =
    hasMembershipRosterEvidence(candidate) ||
    hasMatchingHistoricalMembershipSnapshot(candidate, rankingIntent);

  return {
    rosterSpecificity:
      !staleSourceIndex && rosterRequest
        ? hasRosterEvidence &&
          (!requestsRoleDetail || hasMembershipRoleField(candidate))
          ? 2
          : !requestsRoleDetail && isRosterDimensionCandidate(candidate)
            ? 1
            : 0
        : 0,
    membershipRowSpecificity:
      !staleSourceIndex &&
      (plainMembershipRequest || historicalMembershipRequest) &&
      hasRosterEvidence
        ? 1
        : 0,
    rankingTier: candidateQueryRankingTierForTerms(candidate, requestedTerms),
    trust: candidateTrustTier(candidate),
    activeSubsetSpecificity:
      !staleSourceIndex &&
      requestedActiveMembers &&
      hasActiveOnlyMembershipEvidence(candidate)
        ? 1
        : 0,
    scope: staleSourceIndex
      ? 0
      : requestedScope === "unknown"
        ? 1
        : semanticScopeCompatibility(
            candidateSemanticScope(candidate),
            requestedScope,
          ),
    freshness: staleSourceIndex ? 0 : 1,
  };
}

export function rankAnalyticsQueryCatalogPage(args: {
  search: string;
  dashboards: Array<{
    id: string;
    title: string;
    description?: string;
    config: Record<string, unknown>;
    origin: "saved-dashboard" | "dashboard-template";
    certification?: DashboardCertification | null;
    updatedAt?: string;
    favorite?: boolean;
  }>;
  dictionaryEntries: DictionaryEntry[];
  limit: number;
  offset?: number;
}): {
  candidates: AnalyticsQueryCatalogCandidate[];
  searched: number;
  of: number;
  truncated: boolean;
  nextPage: string | null;
} {
  const rankingIntent = stripNonPositiveInstructions(args.search);
  const candidates = [
    ...args.dashboards.flatMap((dashboard) =>
      dashboardPanelCandidates({
        dashboardId: dashboard.id,
        dashboardTitle: dashboard.title,
        dashboardDescription: dashboard.description,
        config: dashboard.config,
        origin: dashboard.origin,
        search: rankingIntent,
        certification: dashboard.certification ?? null,
        dashboardUpdatedAt: dashboard.updatedAt,
        favorite: dashboard.favorite === true,
      }),
    ),
    ...dictionaryCandidates(args.dictionaryEntries, rankingIntent),
  ];

  const requestedScope = requestedSemanticScope(rankingIntent);
  const requestedActiveMembers =
    (requestedScope === "membership" ||
      requestedScope === "membership_roster") &&
    requestsActiveMembers(rankingIntent);
  const aggregateRequest = isAggregateRequest(rankingIntent);
  const plainMembershipRequest =
    requestedScope === "membership" && !aggregateRequest;
  const historicalMembershipRequest =
    isHistoricalMembershipRequest(rankingIntent);
  const aggregateMembershipIsNotRelevant =
    plainMembershipRequest || historicalMembershipRequest;
  const rosterRequest = isMembershipRosterRequest(rankingIntent);
  const requestsRoleDetail = requestsMembershipRoleDetail(rankingIntent);
  const activeMemberIntent = activeMemberPhrasePolarity(rankingIntent);
  const excludesMembershipForActivity = requestedScope === "product_activity";
  const excludesActiveOnlyMembership =
    !requestedActiveMembers &&
    (rosterRequest || plainMembershipRequest || activeMemberIntent.negated);
  const roleBreakdownRequest =
    !rosterRequest && requestedScope === "membership" && requestsRoleDetail;
  // Strong definitions and proven panels outrank generic hits before coverage.
  const rankedCandidates = candidates.map((candidate) => ({
    candidate,
    ...candidateQueryPriority(candidate, rankingIntent),
    coverage:
      candidateExactMatchedTerms(candidate).length +
      (candidate.kind === "dashboard-panel" && candidate.dashboardCertified
        ? 1
        : 0),
    runnable: candidateIsRunnable(candidate),
    tieBreak: JSON.stringify(candidate),
  }));
  const eligibleCandidates = rankedCandidates.filter(
    ({ candidate }) =>
      !(
        historicalMembershipRequest &&
        !hasMatchingHistoricalMembershipSnapshot(candidate, rankingIntent)
      ) &&
      !(
        excludesActiveOnlyMembership &&
        hasActiveOnlyMembershipEvidence(candidate)
      ) &&
      !(
        aggregateMembershipIsNotRelevant &&
        hasAggregateShape(candidate) &&
        !hasDeclaredRowLevelMembershipGrain(candidate) &&
        !hasMatchingHistoricalMembershipSnapshot(candidate, rankingIntent) &&
        !(
          candidate.kind === "dashboard-panel" &&
          hasRowLevelDashboardMembershipOutput(candidate)
        )
      ) &&
      !(
        excludesMembershipForActivity &&
        ["membership", "membership_roster"].includes(
          candidateSemanticScope(candidate),
        )
      ),
  );
  const strongestScopeMatch = Math.max(
    ...eligibleCandidates.map(({ scope }) => scope),
    0,
  );
  const bestScopeTrust = eligibleCandidates.reduce(
    (strongest, candidate) =>
      candidate.scope === 2 ? Math.max(strongest, candidate.trust) : strongest,
    0,
  );
  const scopeFiltered = rosterRequest
    ? eligibleCandidates.filter(({ candidate }) =>
        rosterCandidateSupportsRequestedDetail(candidate, rankingIntent),
      )
    : roleBreakdownRequest
      ? eligibleCandidates.filter(({ candidate }) =>
          hasMembershipRoleContext(candidate),
        )
      : strongestScopeMatch === 2
        ? eligibleCandidates.filter(({ candidate, scope, trust }) => {
            if (isStaleGeneratedSourceIndexEntry(candidate)) return true;
            if (scope === 2) return true;
            if (requestedScope === "product_activity") {
              return scope === 1 && trust > bestScopeTrust;
            }
            return trust > bestScopeTrust;
          })
        : eligibleCandidates;
  const ranked = scopeFiltered
    .sort((a, b) => {
      if (b.rosterSpecificity !== a.rosterSpecificity) {
        return b.rosterSpecificity - a.rosterSpecificity;
      }
      if (b.membershipRowSpecificity !== a.membershipRowSpecificity) {
        return b.membershipRowSpecificity - a.membershipRowSpecificity;
      }
      if (b.rankingTier !== a.rankingTier) {
        return b.rankingTier - a.rankingTier;
      }
      if (b.trust !== a.trust) return b.trust - a.trust;
      if (b.activeSubsetSpecificity !== a.activeSubsetSpecificity) {
        return b.activeSubsetSpecificity - a.activeSubsetSpecificity;
      }
      if (b.scope !== a.scope) return b.scope - a.scope;
      if (b.freshness !== a.freshness) return b.freshness - a.freshness;
      if (b.coverage !== a.coverage) return b.coverage - a.coverage;
      if (b.candidate.score !== a.candidate.score) {
        return b.candidate.score - a.candidate.score;
      }
      if (a.runnable !== b.runnable) return a.runnable ? -1 : 1;
      if (a.candidate.kind !== b.candidate.kind) {
        return a.candidate.kind === "data-dictionary" ? -1 : 1;
      }
      return a.tieBreak.localeCompare(b.tieBreak);
    })
    .map(({ candidate }) => candidate);

  const seen = new Set<string>();
  const deduped: AnalyticsQueryCatalogCandidate[] = [];
  for (const candidate of ranked) {
    if (seen.has(candidateDedupeKey(candidate))) continue;
    seen.add(candidateDedupeKey(candidate));
    deduped.push(candidate);
  }
  const page = paginateSearchResults({
    search: args.search,
    results: deduped,
    searched: args.dashboards.length + args.dictionaryEntries.length,
    limit: args.limit,
    offset: args.offset ?? 0,
  });
  return {
    candidates: page.results,
    searched: page.searched,
    of: page.of,
    truncated: page.truncated,
    nextPage: page.nextPage,
  };
}

export function rankAnalyticsQueryCatalog(args: {
  search: string;
  dashboards: Array<{
    id: string;
    title: string;
    description?: string;
    config: Record<string, unknown>;
    origin: "saved-dashboard" | "dashboard-template";
    certification?: DashboardCertification | null;
    updatedAt?: string;
    favorite?: boolean;
  }>;
  dictionaryEntries: DictionaryEntry[];
  limit: number;
}): AnalyticsQueryCatalogCandidate[] {
  return rankAnalyticsQueryCatalogPage(args).candidates;
}

async function listDictionaryEntries(args: {
  email: string;
  orgId: string | null;
}): Promise<{
  entries: DictionaryEntry[];
  searchedEntryCount: number;
  truncated: boolean;
  status: "available" | "partial" | "unavailable";
  sourceIndexStatus: "not-configured" | "unavailable" | "invalid" | "available";
  sourceIndexScanCoverage: SourceIndexScanCoverage | null;
  sourceIndexFreshness: SourceIndexFreshness | null;
  sourceIndexSourcesFreshness: SourceIndexSourcesFreshness | null;
}> {
  const entries: DictionaryEntry[] = [];
  const seen = new Map<string, number>();
  const collect = (raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const entry = raw as DictionaryEntry;
    const id = text(entry.id);
    if (!id) return;
    const existingIndex = seen.get(id);
    if (existingIndex !== undefined) {
      const existing = entries[existingIndex];
      if (existing)
        entries[existingIndex] = mergeDataDictionaryEntry(existing, entry);
      return;
    }
    seen.set(id, entries.length);
    entries.push(entry);
  };

  const userPrefix = `u:${args.email}:${DATA_DICTIONARY_KEY_PREFIX}`;
  const [orgResult, userResult, sourceIndexResult] = await Promise.allSettled([
    args.orgId
      ? listOrgSettings(args.orgId, DATA_DICTIONARY_KEY_PREFIX, {
          limit: MAX_CATALOG_DICTIONARY_ENTRIES + 1,
        })
      : Promise.resolve(null),
    listSettingsByPrefix(userPrefix, {
      limit: MAX_CATALOG_DICTIONARY_ENTRIES + 1,
    }),
    readSourceIndex(args.orgId),
  ]);
  if (orgResult.status === "fulfilled" && orgResult.value) {
    const orgEntries = Object.entries(orgResult.value);
    for (const [, value] of orgEntries.slice(
      0,
      MAX_CATALOG_DICTIONARY_ENTRIES,
    )) {
      collect(value);
    }
  } else if (orgResult.status === "rejected") {
    console.warn(
      "[analytics-query-catalog] Organization dictionary lookup failed:",
      orgResult.reason,
    );
  }
  if (userResult.status === "fulfilled") {
    for (const { value } of userResult.value.slice(
      0,
      MAX_CATALOG_DICTIONARY_ENTRIES,
    )) {
      collect(value);
    }
  } else {
    console.warn(
      "[analytics-query-catalog] User dictionary lookup failed:",
      userResult.reason,
    );
  }
  let sourceIndexUnavailable = false;
  let sourceIndexStatus:
    | "not-configured"
    | "unavailable"
    | "invalid"
    | "available" = "unavailable";
  let sourceIndexCoverage: SourceIndexScanCoverage | null = null;
  let sourceIndexFreshnessMetadata: SourceIndexFreshness | null = null;
  let sourceIndexSourcesFreshnessMetadata: SourceIndexSourcesFreshness | null =
    null;
  if (sourceIndexResult.status === "fulfilled") {
    sourceIndexStatus = sourceIndexResult.value.status;
    if (sourceIndexResult.value.status === "available") {
      const now = Date.now();
      sourceIndexFreshnessMetadata = sourceIndexFreshness(
        sourceIndexResult.value.bundle.generatedAt,
        now,
      );
      sourceIndexSourcesFreshnessMetadata = sourceIndexSourcesFreshness(
        sourceIndexResult.value.bundle,
        now,
      );
      sourceIndexCoverage = sourceIndexScanCoverage(
        sourceIndexResult.value.bundle,
      );
      for (const entry of sourceIndexDictionaryEntries(
        sourceIndexResult.value.bundle,
        sourceIndexFreshnessMetadata,
      )) {
        collect(entry);
      }
    } else if (
      sourceIndexResult.value.status === "unavailable" ||
      sourceIndexResult.value.status === "invalid"
    ) {
      sourceIndexUnavailable = true;
      console.warn(
        "[analytics-query-catalog] Organization source index is unreadable.",
      );
    }
  } else {
    sourceIndexUnavailable = true;
    sourceIndexStatus = "unavailable";
    console.warn(
      "[analytics-query-catalog] Organization source index lookup failed.",
    );
  }
  const orgCount =
    orgResult.status === "fulfilled"
      ? Object.keys(orgResult.value ?? {}).length
      : 0;
  const userCount =
    userResult.status === "fulfilled" ? userResult.value.length : 0;
  const scopedResults = [
    ...(args.orgId ? [orgResult.status === "fulfilled"] : []),
    userResult.status === "fulfilled",
  ];
  const availableScopes = scopedResults.filter(Boolean).length;
  const scopeCount = args.orgId ? 2 : 1;
  return {
    entries,
    searchedEntryCount: entries.length,
    truncated:
      orgCount > MAX_CATALOG_DICTIONARY_ENTRIES ||
      userCount > MAX_CATALOG_DICTIONARY_ENTRIES,
    status: sourceIndexUnavailable
      ? "partial"
      : availableScopes === scopeCount
        ? "available"
        : availableScopes > 0
          ? "partial"
          : "unavailable",
    sourceIndexStatus,
    sourceIndexScanCoverage: sourceIndexCoverage,
    sourceIndexFreshness: sourceIndexFreshnessMetadata,
    sourceIndexSourcesFreshness: sourceIndexSourcesFreshnessMetadata,
  };
}

export async function searchAnalyticsDictionaryCatalog(args: {
  search: string;
  email: string;
  orgId: string | null;
  limit: number;
  nextPage?: string;
  offset?: number;
  signal?: AbortSignal;
}): Promise<AnalyticsDictionarySearchResult> {
  args.signal?.throwIfAborted();
  const dictionary = await listDictionaryEntries({
    email: args.email,
    orgId: args.orgId,
  });
  args.signal?.throwIfAborted();
  const page = rankAnalyticsQueryCatalogPage({
    search: args.search,
    dashboards: [],
    dictionaryEntries: dictionary.entries,
    limit: args.limit,
    offset: args.nextPage
      ? decodeSearchCursor(args.search, args.nextPage)
      : args.offset,
  });
  return {
    ...page,
    searched: dictionary.searchedEntryCount,
    truncated:
      page.truncated ||
      dictionary.truncated ||
      dictionary.status !== "available",
    searchedDictionaryEntryCount: dictionary.searchedEntryCount,
    dictionarySearchTruncated: dictionary.truncated,
    dictionarySearchStatus: dictionary.status,
    sourceIndexStatus: dictionary.sourceIndexStatus,
    sourceIndexScanCoverage: dictionary.sourceIndexScanCoverage,
    sourceIndexFreshness: dictionary.sourceIndexFreshness,
    sourceIndexSourcesFreshness: dictionary.sourceIndexSourcesFreshness,
  };
}

function warnCatalogReadFailure(source: string, error: unknown): void {
  console.warn(
    `[analytics-query-catalog] ${source} lookup failed; continuing with available references:`,
    error,
  );
}

function savedDashboardInput(
  summary: DashboardSummaryRecord,
  dashboard: DashboardCatalogRecord,
) {
  return {
    id: dashboard.id,
    title: summary.name,
    description: summary.description ?? undefined,
    config: dashboard.config,
    origin: "saved-dashboard" as const,
    certification: dashboard.certification,
    ...(dashboard.updatedAt ? { updatedAt: dashboard.updatedAt } : {}),
    favorite: summary.favorite === true,
  };
}

function dashboardSummaryFromReference(
  reference: DashboardReferenceRecord,
  favorite: boolean,
): DashboardSummaryRecord {
  return {
    id: reference.id,
    kind: reference.kind,
    name: reference.name,
    description: reference.description,
    configName: null,
    catalogTemplateId: null,
    demoId: null,
    parentId: null,
    folderId: null,
    ownerEmail: reference.ownerEmail,
    orgId: reference.orgId,
    visibility: reference.visibility,
    createdAt: reference.updatedAt,
    updatedAt: reference.updatedAt,
    archivedAt: null,
    hiddenAt: null,
    hiddenBy: null,
    ...(reference.certification
      ? { certification: reference.certification }
      : {}),
    favorite,
  };
}

export async function searchAnalyticsQueryCatalog(args: {
  search: string;
  email: string;
  orgId: string | null;
  limit: number;
  nextPage?: string;
  offset?: number;
  signal?: AbortSignal;
}): Promise<AnalyticsQueryCatalogSearchResult> {
  args.signal?.throwIfAborted();
  const rankingIntent = stripNonPositiveInstructions(args.search);
  const [
    summariesResult,
    dictionaryResult,
    favoritesResult,
    dashboardReferencesResult,
  ] = await Promise.allSettled([
    listDashboardSummaries(
      { email: args.email, orgId: args.orgId },
      {
        kind: "sql",
        archived: "active",
        hidden: "visible",
        includeCatalogMetadata: true,
        limit: MAX_CATALOG_DASHBOARD_SUMMARIES + 1,
      },
    ),
    listDictionaryEntries({ email: args.email, orgId: args.orgId }),
    listFavoriteDashboardIds(args.email),
    searchDashboardReferencesPage(
      { email: args.email, orgId: args.orgId },
      rankingIntent,
      MAX_CATALOG_DASHBOARD_HYDRATION,
    ),
  ]);
  args.signal?.throwIfAborted();
  const savedSummaries =
    summariesResult.status === "fulfilled" ? summariesResult.value : [];
  const searchedSummaries = savedSummaries.slice(
    0,
    MAX_CATALOG_DASHBOARD_SUMMARIES,
  );
  const dashboardSearchTruncated =
    savedSummaries.length > MAX_CATALOG_DASHBOARD_SUMMARIES;
  if (dashboardSearchTruncated) {
    console.warn("[analytics] Dashboard reference search truncated.", {
      searchedDashboardCount: searchedSummaries.length,
      dashboardSearchTruncated,
    });
  }
  const dictionaryEntries =
    dictionaryResult.status === "fulfilled"
      ? dictionaryResult.value.entries
      : [];
  const searchedDictionaryEntryCount =
    dictionaryResult.status === "fulfilled"
      ? dictionaryResult.value.searchedEntryCount
      : 0;
  const dictionarySearchTruncated =
    dictionaryResult.status === "fulfilled" && dictionaryResult.value.truncated;
  let dashboardSearchStatus: "available" | "unavailable" =
    summariesResult.status === "fulfilled" ? "available" : "unavailable";
  const dictionarySearchStatus =
    dictionaryResult.status === "fulfilled"
      ? dictionaryResult.value.status
      : "unavailable";
  if (dictionarySearchTruncated) {
    console.warn("[analytics] Data dictionary search truncated.", {
      searchedDictionaryEntryCount,
      dictionarySearchTruncated,
    });
  }
  const favoriteIds =
    favoritesResult.status === "fulfilled"
      ? favoritesResult.value
      : new Set<string>();
  const dashboardPanelReferenceSearchStatus =
    dashboardReferencesResult.status === "fulfilled"
      ? "available"
      : "unavailable";
  const dashboardReferences =
    dashboardReferencesResult.status === "fulfilled"
      ? dashboardReferencesResult.value.results
      : [];
  const searchedDashboardCount = new Set([
    ...searchedSummaries.map((dashboard) => dashboard.id),
    ...dashboardReferences
      .filter((reference) => reference.kind === "sql")
      .map((reference) => reference.id),
  ]).size;
  const dashboardPanelReferenceSearchTruncated =
    dashboardReferencesResult.status === "fulfilled" &&
    (dashboardReferencesResult.value.truncated ||
      dashboardReferencesResult.value.nextPage !== null);
  if (dashboardReferencesResult.status === "rejected") {
    warnCatalogReadFailure(
      "Dashboard panel reference",
      dashboardReferencesResult.reason,
    );
  }
  if (dashboardPanelReferenceSearchTruncated) {
    console.warn(
      "[analytics] Dashboard panel reference search reached its result cap.",
      { dashboardReferenceCount: dashboardReferences.length },
    );
  }
  if (summariesResult.status === "rejected") {
    warnCatalogReadFailure("Dashboard summary", summariesResult.reason);
  }
  if (dictionaryResult.status === "rejected") {
    warnCatalogReadFailure("Data dictionary", dictionaryResult.reason);
  }
  if (favoritesResult.status === "rejected") {
    warnCatalogReadFailure("Favorite dashboard", favoritesResult.reason);
  }
  const savedSummaryIds = new Set(
    savedSummaries.map((dashboard) => dashboard.id),
  );

  const shortlistedSummaries = shortlistDashboardSummaries(
    rankingIntent,
    searchedSummaries,
    args.limit,
    favoriteIds,
  );
  const summaryById = new Map(
    searchedSummaries.map((summary) => [summary.id, summary]),
  );
  const referencedSummaries = dashboardReferences
    .filter((reference) => reference.kind === "sql")
    .map(
      (reference) =>
        summaryById.get(reference.id) ??
        dashboardSummaryFromReference(reference, favoriteIds.has(reference.id)),
    );
  const seenDashboardIds = new Set<string>();
  const hydrationSummaries = [...referencedSummaries, ...shortlistedSummaries]
    .filter((summary) => {
      if (seenDashboardIds.has(summary.id)) return false;
      seenDashboardIds.add(summary.id);
      return true;
    })
    .slice(0, MAX_CATALOG_DASHBOARD_HYDRATION);
  const shortlistedIds = hydrationSummaries.map((dashboard) => dashboard.id);
  const shortlistedIdSet = new Set(shortlistedIds);
  const omittedSummaryMatch = searchedSummaries.some(
    (dashboard) =>
      dashboardSummaryRelevance(rankingIntent, dashboard) > 0 &&
      !shortlistedIdSet.has(dashboard.id),
  );
  const omittedDashboardReference = dashboardReferences.some(
    (reference) =>
      reference.kind === "sql" && !shortlistedIdSet.has(reference.id),
  );
  const dashboardDetailHydrationTruncated =
    omittedSummaryMatch ||
    omittedDashboardReference ||
    dashboardPanelReferenceSearchStatus === "unavailable" ||
    dashboardPanelReferenceSearchTruncated;
  args.signal?.throwIfAborted();
  const savedDashboardsResult = await loadDashboardCatalogDashboards(
    { email: args.email, orgId: args.orgId },
    shortlistedIds,
  ).catch((error: unknown) => {
    warnCatalogReadFailure("Dashboard detail", error);
    dashboardSearchStatus = "unavailable";
    return [];
  });
  args.signal?.throwIfAborted();
  const savedDashboards = new Map(
    savedDashboardsResult.map((dashboard) => [dashboard.id, dashboard]),
  );
  const templateDashboards = dashboardCatalogEntries
    .filter((entry) => !savedSummaryIds.has(entry.defaultDashboardId))
    .flatMap((entry) => {
      try {
        const config = entry.buildConfig() as unknown as Record<
          string,
          unknown
        >;
        return [
          {
            id: entry.defaultDashboardId,
            title: text(config.name) || entry.name,
            description: text(config.description) || entry.description,
            config,
            origin: "dashboard-template" as const,
          },
        ];
      } catch {
        return [];
      }
    });

  const page = rankAnalyticsQueryCatalogPage({
    search: args.search,
    dashboards: [
      ...hydrationSummaries.flatMap((summary) => {
        const dashboard = savedDashboards.get(summary.id);
        if (!dashboard) return [];
        return [
          savedDashboardInput(
            { ...summary, favorite: favoriteIds.has(summary.id) },
            dashboard,
          ),
        ];
      }),
      ...(dashboardSearchTruncated ? [] : templateDashboards),
    ],
    dictionaryEntries,
    limit: args.limit,
    offset: args.nextPage
      ? decodeSearchCursor(args.search, args.nextPage)
      : args.offset,
  });
  return {
    ...page,
    searched: searchedDashboardCount + searchedDictionaryEntryCount,
    truncated:
      page.truncated ||
      dashboardSearchTruncated ||
      dashboardDetailHydrationTruncated ||
      dictionarySearchTruncated ||
      dashboardSearchStatus !== "available" ||
      dictionarySearchStatus !== "available",
    searchedDashboardCount,
    dashboardSearchTruncated,
    dashboardDetailHydrationTruncated,
    dashboardPanelReferenceSearchStatus,
    dashboardPanelReferenceSearchTruncated,
    dashboardPanelReferenceSearched:
      dashboardReferencesResult.status === "fulfilled"
        ? dashboardReferencesResult.value.searched
        : 0,
    dashboardPanelReferenceOf:
      dashboardReferencesResult.status === "fulfilled"
        ? dashboardReferencesResult.value.of
        : 0,
    dashboardPanelReferenceNextPage:
      dashboardReferencesResult.status === "fulfilled"
        ? dashboardReferencesResult.value.nextPage
        : null,
    dashboardSearchStatus,
    searchedDictionaryEntryCount,
    dictionarySearchTruncated,
    dictionarySearchStatus,
    sourceIndexStatus:
      dictionaryResult.status === "fulfilled"
        ? dictionaryResult.value.sourceIndexStatus
        : "unavailable",
    sourceIndexScanCoverage:
      dictionaryResult.status === "fulfilled"
        ? dictionaryResult.value.sourceIndexScanCoverage
        : null,
    sourceIndexFreshness:
      dictionaryResult.status === "fulfilled"
        ? dictionaryResult.value.sourceIndexFreshness
        : null,
    sourceIndexSourcesFreshness:
      dictionaryResult.status === "fulfilled"
        ? dictionaryResult.value.sourceIndexSourcesFreshness
        : null,
  };
}
