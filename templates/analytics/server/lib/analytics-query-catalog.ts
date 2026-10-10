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
  decodeSearchCursor,
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
import {
  readSourceIndex,
  sourceIndexDictionaryEntries,
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
      id: string;
      metric: string;
      definition?: string;
      source?: string;
      action?: string;
      table?: string;
      columnsUsed?: string;
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
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
  "product_activity",
  "session",
  "crm_record",
]);

function inferSemanticScope(value: string): string {
  return semanticScopeForSearch(value);
}

export function candidateSemanticScope(
  candidate: AnalyticsQueryCatalogCandidate,
): string {
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
    const { score: rawScore, matchedTerms } = matchScore(args.search, [
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
    const unmatchedTitleTerms = searchTerms(panelTitle).filter(
      (term) => !requestedTerms.has(term),
    ).length;
    const titleSpecificityPenalty = Math.min(unmatchedTitleTerms, 4) * 4;
    const titleMatchedTerms = matchScore(args.search, [
      { value: panelTitle, weight: 1 },
    ]).matchedTerms;
    const strongTitleTerms = titleMatchedTerms.filter(
      (term) => !LOW_INFORMATION_TERMS.has(term),
    ).length;
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
    if (relevanceScore <= 0) return [];
    const dashboardCertified = Boolean(
      args.dashboardUpdatedAt &&
      isDashboardCertified(args.certification, args.dashboardUpdatedAt),
    );
    const score =
      relevanceScore + (dashboardCertified ? 60 : 0) + (args.favorite ? 20 : 0);

    return [
      {
        kind: "dashboard-panel" as const,
        origin: args.origin,
        score,
        matchedTerms,
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
    const { score: rawScore, matchedTerms } = matchScore(search, [
      { value: entry.metric, weight: 28 },
      { value: entry.commonQuestions, weight: 16 },
      { value: entry.definition, weight: 12 },
      { value: entry.table, weight: 8 },
      { value: entry.columnsUsed, weight: 6 },
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
    if (!rawScore) return [];
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
    const score = rawScore;
    if (!score) return [];

    const id = text(entry.id);
    const metric = text(entry.metric);
    if (!id || !metric) return [];
    return [
      {
        kind: "data-dictionary" as const,
        origin: isSourceIndex
          ? ("source-index" as const)
          : ("data-dictionary" as const),
        score: score + (entry.approved === true ? 12 : 0),
        matchedTerms,
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
  const candidates = [
    ...args.dashboards.flatMap((dashboard) =>
      dashboardPanelCandidates({
        dashboardId: dashboard.id,
        dashboardTitle: dashboard.title,
        dashboardDescription: dashboard.description,
        config: dashboard.config,
        origin: dashboard.origin,
        search: args.search,
        certification: dashboard.certification ?? null,
        dashboardUpdatedAt: dashboard.updatedAt,
        favorite: dashboard.favorite === true,
      }),
    ),
    ...dictionaryCandidates(args.dictionaryEntries, args.search),
  ];

  const requestedScope = requestedSemanticScope(args.search);
  const requestedTerms = new Set(searchTerms(args.search));
  const hasExactQueryCoverage = (candidate: AnalyticsQueryCatalogCandidate) =>
    requestedTerms.size > 0 &&
    [...requestedTerms].every((term) => candidate.matchedTerms.includes(term));
  const hasFullQueryCoverage = (candidate: AnalyticsQueryCatalogCandidate) =>
    requestedTerms.size > 1 && hasExactQueryCoverage(candidate);
  // Strong definitions and proven panels outrank generic hits before coverage.
  const rankedCandidates = candidates.map((candidate) => ({
    candidate,
    scope:
      requestedScope === "unknown"
        ? 1
        : semanticScopeCompatibility(
            candidateSemanticScope(candidate),
            requestedScope,
          ),
    trust: candidateTrustTier(candidate),
    rankingTier:
      candidate.kind === "data-dictionary" &&
      candidate.approved === true &&
      hasExactQueryCoverage(candidate)
        ? 2
        : candidate.kind === "dashboard-panel" &&
            ((candidate.dashboardCertified &&
              hasExactQueryCoverage(candidate)) ||
              (candidateIsRunnable(candidate) &&
                hasFullQueryCoverage(candidate)))
          ? 1
          : 0,
    coverage:
      candidate.matchedTerms.length +
      (candidate.kind === "dashboard-panel" && candidate.dashboardCertified
        ? 1
        : 0),
    runnable: candidateIsRunnable(candidate),
    tieBreak: JSON.stringify(candidate),
  }));
  const strongestScopeMatch = Math.max(
    ...rankedCandidates.map(({ scope }) => scope),
    0,
  );
  const bestScopeTrust = rankedCandidates.reduce(
    (strongest, candidate) =>
      candidate.scope === 2 ? Math.max(strongest, candidate.trust) : strongest,
    0,
  );
  const scopeFiltered =
    strongestScopeMatch === 2
      ? rankedCandidates.filter(
          ({ scope, trust }) => scope === 2 || trust > bestScopeTrust,
        )
      : rankedCandidates;
  const ranked = scopeFiltered
    .sort((a, b) => {
      if (b.rankingTier !== a.rankingTier) {
        return b.rankingTier - a.rankingTier;
      }
      if (b.trust !== a.trust) return b.trust - a.trust;
      if (b.scope !== a.scope) return b.scope - a.scope;
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
}> {
  const entries: DictionaryEntry[] = [];
  const seen = new Set<string>();
  const collect = (raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const entry = raw as DictionaryEntry;
    const id = text(entry.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
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
  if (sourceIndexResult.status === "fulfilled") {
    if (sourceIndexResult.value.status === "available") {
      for (const entry of sourceIndexDictionaryEntries(
        sourceIndexResult.value.bundle,
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
      args.search,
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
    args.search,
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
      dashboardSummaryRelevance(args.search, dashboard) > 0 &&
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
  };
}
