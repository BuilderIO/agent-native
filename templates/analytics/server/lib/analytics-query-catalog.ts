import { getAllSettings, listOrgSettings } from "@agent-native/core/settings";

import { dashboardCatalogEntries } from "./dashboard-catalog";
import {
  listDashboards,
  type DashboardRecord,
} from "./dashboards-store";

const DATA_DICTIONARY_KEY_PREFIX = "data-dict-";
const MAX_QUERY_LENGTH = 12_000;
const STOP_WORDS = new Set([
  "a",
  "all",
  "an",
  "and",
  "are",
  "by",
  "count",
  "data",
  "day",
  "days",
  "do",
  "exact",
  "find",
  "for",
  "from",
  "get",
  "give",
  "how",
  "i",
  "in",
  "last",
  "look",
  "many",
  "me",
  "metric",
  "number",
  "of",
  "on",
  "our",
  "please",
  "show",
  "that",
  "the",
  "this",
  "today",
  "total",
  "up",
  "week",
  "what",
  "were",
  "we",
  "yesterday",
]);

type DictionaryEntry = Record<string, unknown>;
type DashboardPanel = Record<string, unknown>;

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
      query: string | Record<string, unknown>;
      timeScope?: string;
    }
  | {
      kind: "data-dictionary";
      origin: "data-dictionary";
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
      approved?: boolean;
      aiGenerated?: boolean;
      sourceUrl?: string;
    };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function searchTerms(search: string): string[] {
  const normalized = search
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!normalized) return [];
  const meaningful = normalized
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
  return meaningful.length ? Array.from(new Set(meaningful)) : [normalized];
}

function matchScore(
  search: string,
  weightedFields: Array<{ value: unknown; weight: number }>,
): { score: number; matchedTerms: string[] } {
  const terms = searchTerms(search);
  if (!terms.length) return { score: 0, matchedTerms: [] };

  const normalizedSearch = search.toLowerCase().trim();
  const matched = new Set<string>();
  let score = 0;
  for (const field of weightedFields) {
    const value = text(field.value).toLowerCase();
    if (!value) continue;
    if (normalizedSearch.length > 2 && value.includes(normalizedSearch)) {
      score += field.weight * 4;
    }
    for (const term of terms) {
      if (!value.includes(term)) continue;
      matched.add(term);
      score += field.weight;
    }
  }

  if (matched.size === terms.length) score += 40;
  return { score, matchedTerms: [...matched] };
}

function dashboardPanelCandidates(args: {
  dashboardId: string;
  dashboardTitle: string;
  dashboardDescription?: string;
  config: Record<string, unknown>;
  origin: "saved-dashboard" | "dashboard-template";
  search: string;
}): AnalyticsQueryCatalogCandidate[] {
  const panels = Array.isArray(args.config.panels)
    ? (args.config.panels as DashboardPanel[])
    : [];

  return panels.flatMap((panel) => {
    const query = compactQuery(panel.sql);
    if (!query) return [];
    const panelConfig =
      panel.config &&
      typeof panel.config === "object" &&
      !Array.isArray(panel.config)
        ? (panel.config as Record<string, unknown>)
        : {};
    const panelTitle = text(panel.title) || text(panel.id);
    const panelDescription = text(panelConfig.description);
    const { score, matchedTerms } = matchScore(args.search, [
      { value: panelTitle, weight: 24 },
      { value: panelDescription, weight: 12 },
      { value: args.dashboardTitle, weight: 10 },
      { value: args.dashboardDescription, weight: 6 },
      { value: panel.source, weight: 5 },
      {
        value: typeof query === "string" ? query : JSON.stringify(query),
        weight: 2,
      },
    ]);
    if (!score) return [];

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
        query,
        ...(text(panelConfig.timeScope)
          ? { timeScope: text(panelConfig.timeScope) }
          : {}),
      },
    ];
  });
}

function dictionaryCandidates(
  entries: DictionaryEntry[],
  search: string,
): AnalyticsQueryCatalogCandidate[] {
  return entries.flatMap((entry) => {
    const { score, matchedTerms } = matchScore(search, [
      { value: entry.metric, weight: 28 },
      { value: entry.commonQuestions, weight: 16 },
      { value: entry.definition, weight: 12 },
      { value: entry.table, weight: 8 },
      { value: entry.columnsUsed, weight: 6 },
      { value: entry.queryTemplate, weight: 5 },
      { value: entry.source, weight: 5 },
      { value: entry.action, weight: 5 },
      { value: entry.knownGotchas, weight: 2 },
    ]);
    if (!score) return [];

    const id = text(entry.id);
    const metric = text(entry.metric);
    if (!id || !metric) return [];
    return [
      {
        kind: "data-dictionary" as const,
        origin: "data-dictionary" as const,
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
        ...(typeof entry.approved === "boolean"
          ? { approved: entry.approved }
          : {}),
        ...(typeof entry.aiGenerated === "boolean"
          ? { aiGenerated: entry.aiGenerated }
          : {}),
        ...(text(entry.sourceUrl) ? { sourceUrl: text(entry.sourceUrl) } : {}),
      },
    ];
  });
}

export function rankAnalyticsQueryCatalog(args: {
  search: string;
  dashboards: Array<{
    id: string;
    title: string;
    description?: string;
    config: Record<string, unknown>;
    origin: "saved-dashboard" | "dashboard-template";
  }>;
  dictionaryEntries: DictionaryEntry[];
  limit: number;
}): AnalyticsQueryCatalogCandidate[] {
  const candidates = [
    ...args.dashboards.flatMap((dashboard) =>
      dashboardPanelCandidates({
        dashboardId: dashboard.id,
        dashboardTitle: dashboard.title,
        dashboardDescription: dashboard.description,
        config: dashboard.config,
        origin: dashboard.origin,
        search: args.search,
      }),
    ),
    ...dictionaryCandidates(args.dictionaryEntries, args.search),
  ];

  return candidates
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.kind !== b.kind) return a.kind === "data-dictionary" ? -1 : 1;
      return JSON.stringify(a).localeCompare(JSON.stringify(b));
    })
    .slice(0, args.limit);
}

async function listDictionaryEntries(args: {
  email: string;
  orgId: string | null;
}): Promise<DictionaryEntry[]> {
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

  if (args.orgId) {
    const orgEntries = await listOrgSettings(
      args.orgId,
      DATA_DICTIONARY_KEY_PREFIX,
    );
    for (const value of Object.values(orgEntries)) collect(value);
  }

  const userPrefix = `u:${args.email}:${DATA_DICTIONARY_KEY_PREFIX}`;
  const all = await getAllSettings();
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(userPrefix)) collect(value);
  }
  return entries;
}

function savedDashboardInput(dashboard: DashboardRecord) {
  const config = dashboard.config as Record<string, unknown>;
  return {
    id: dashboard.id,
    title: text(config.name) || dashboard.title,
    description: text(config.description) || undefined,
    config,
    origin: "saved-dashboard" as const,
  };
}

export async function searchAnalyticsQueryCatalog(args: {
  search: string;
  email: string;
  orgId: string | null;
  limit: number;
}): Promise<AnalyticsQueryCatalogCandidate[]> {
  const [savedDashboards, dictionaryEntries] = await Promise.all([
    listDashboards(
      { email: args.email, orgId: args.orgId },
      { kind: "sql", archived: "active", hidden: "visible" },
    ),
    listDictionaryEntries({ email: args.email, orgId: args.orgId }),
  ]);

  const savedIds = new Set(savedDashboards.map((dashboard) => dashboard.id));
  const templateDashboards = dashboardCatalogEntries
    .filter((entry) => !savedIds.has(entry.defaultDashboardId))
    .map((entry) => {
      const config = entry.buildConfig() as unknown as Record<string, unknown>;
      return {
        id: entry.defaultDashboardId,
        title: text(config.name) || entry.name,
        description: text(config.description) || entry.description,
        config,
        origin: "dashboard-template" as const,
      };
    });

  return rankAnalyticsQueryCatalog({
    search: args.search,
    dashboards: [
      ...savedDashboards.map(savedDashboardInput),
      ...templateDashboards,
    ],
    dictionaryEntries,
    limit: args.limit,
  });
}
