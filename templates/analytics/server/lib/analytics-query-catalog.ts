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
  type SourceIndexScanCoverage,
  type SourceIndexFreshness,
} from "./source-index-store";

const DATA_DICTIONARY_KEY_PREFIX = "data-dict-";
const MAX_QUERY_LENGTH = 12_000;
const MAX_CATALOG_DASHBOARD_HYDRATION = 24;
// ponytail: scan the 200 most recently updated summaries; a search-backed index is the upgrade path if larger workspaces need older references.
const MAX_CATALOG_DASHBOARD_SUMMARIES = 200;
const MAX_CATALOG_DICTIONARY_ENTRIES = 200;
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
    };

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
        ? candidate.query
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

function hasAggregateShape(candidate: AnalyticsQueryCatalogCandidate) {
  const fields =
    candidate.kind === "data-dictionary"
      ? [
          candidate.metric,
          candidate.table,
          candidate.columnsUsed,
          candidate.grain,
        ]
      : [candidate.query ? JSON.stringify(candidate.query) : ""];
  const searchable = fields
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (candidate.kind === "data-dictionary") {
    const grain = (candidate.grain ?? "").toLowerCase().replace(/[_-]+/g, " ");
    const declaredRosterRowGrain =
      /\b(?:one|single)\s+row\s+per\b/.test(grain) &&
      /\b(?:users?|people|persons?|members?)\b/.test(grain) &&
      /\b(?:organizations?|orgs?|workspaces?|teams?)\b/.test(grain);
    const temporalDefinition = [candidate.definition]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[_-]+/g, " ");
    const temporalMembershipGrain =
      /\b(?:per\s+)?(?:day|daily|week|weekly|month|monthly|quarter|quarterly|year|yearly)\b/.test(
        grain,
      ) ||
      /\b(?:historical|history|month end|as of (?:the )?(?:day|week|month|quarter|year))\b|\b(?:daily|weekly|monthly|quarterly|yearly)\s+snapshots?\b|\bsnapshots?\s+(?:by|per)\s+(?:date|day|week|month|quarter|year)\b/.test(
        temporalDefinition,
      );
    if (temporalMembershipGrain) return true;
    // An explicit user-organization row grain is stronger than incidental
    // field names such as member_count. Temporal grains remain snapshots.
    if (declaredRosterRowGrain) return false;
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
      !hasAggregateShape(candidate) &&
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
    ? candidate.query.toLowerCase().replace(/[_-]+/g, " ")
    : JSON.stringify(candidate.query ?? "")
        .toLowerCase()
        .replace(/[_-]+/g, " ");
}

function hasMembershipRelationEvidence(value: string): boolean {
  return (
    /\bmembership\b/.test(value) ||
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
      : [candidate.query];
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
      : [candidate.panelTitle, candidate.panelDescription, candidate.query];
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
  if (requestsRoleDetail) {
    return (
      hasMembershipRosterEvidence(candidate) &&
      hasMembershipRoleField(candidate)
    );
  }
  if (isRosterDimensionCandidate(candidate)) return true;
  return hasMembershipRosterEvidence(candidate);
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
  const aggregateRequest =
    /\b(?:how many|counts?|number of|total|highest|lowest|most|fewest|average|avg|median|sum|trend|rate|percentage|share|distribution|breakdowns?|split\s+by|daily|weekly|monthly|quarterly|yearly|day|week|month|quarter|year)\b/i.test(
      rankingIntent,
    );
  const plainMembershipRequest =
    requestedScope === "membership" && !aggregateRequest;
  const rosterRequest = isMembershipRosterRequest(rankingIntent);
  const requestsRoleDetail = requestsMembershipRoleDetail(rankingIntent);
  const requestedActiveMembers =
    (requestedScope === "membership" ||
      requestedScope === "membership_roster") &&
    requestsActiveMembers(rankingIntent);
  const requestedTerms = new Set(searchTerms(rankingIntent));
  const staleSourceIndex = isStaleGeneratedSourceIndexEntry(candidate);

  return {
    rosterSpecificity:
      !staleSourceIndex && rosterRequest
        ? hasMembershipRosterEvidence(candidate) &&
          (!requestsRoleDetail || hasMembershipRoleField(candidate))
          ? 2
          : !requestsRoleDetail && isRosterDimensionCandidate(candidate)
            ? 1
            : 0
        : 0,
    membershipRowSpecificity:
      !staleSourceIndex &&
      plainMembershipRequest &&
      hasMembershipRosterEvidence(candidate)
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
  const aggregateRequest =
    /\b(?:how many|counts?|number of|total|highest|lowest|most|fewest|average|avg|median|sum|trend|rate|percentage|share|distribution|breakdowns?|split\s+by|daily|weekly|monthly|quarterly|yearly|day|week|month|quarter|year)\b/i.test(
      rankingIntent,
    );
  const plainMembershipRequest =
    requestedScope === "membership" && !aggregateRequest;
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
        excludesActiveOnlyMembership &&
        hasActiveOnlyMembershipEvidence(candidate)
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
  if (sourceIndexResult.status === "fulfilled") {
    sourceIndexStatus = sourceIndexResult.value.status;
    if (sourceIndexResult.value.status === "available") {
      sourceIndexFreshnessMetadata = sourceIndexFreshness(
        sourceIndexResult.value.bundle.generatedAt,
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
  };
}
