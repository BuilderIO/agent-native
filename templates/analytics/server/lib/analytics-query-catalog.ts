import { getAllSettings, listOrgSettings } from "@agent-native/core/settings";

import { dashboardCatalogEntries } from "./dashboard-catalog";
import { listDashboards, type DashboardRecord } from "./dashboards-store";

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
  "over",
  "our",
  "please",
  "show",
  "that",
  "the",
  "this",
  "time",
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
      /** Absent for extension/embed panels, which are matched on title and description. */
      query?: string | Record<string, unknown>;
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

// Analytics vocabulary the corpus spells out but users abbreviate (or vice versa).
// Expansions match at reduced weight so they break ties without outranking a literal hit.
const SYNONYM_EXPANSIONS: Record<string, string[]> = {
  account: ["company", "customer", "org"],
  active: ["engaged"],
  arr: ["annual", "recurring", "revenue"],
  churn: ["cancel", "attrition", "downgrade"],
  csql: ["sale", "qualified", "lead", "opportunity"],
  customer: ["account", "company"],
  dau: ["daily", "active", "user"],
  deal: ["opportunity", "pipeline"],
  error: ["5xx", "4xx", "exception", "failure", "fault"],
  icp: ["ideal", "customer", "profile"],
  mau: ["monthly", "active", "user"],
  mql: ["marketing", "qualified", "lead"],
  mrr: ["monthly", "recurring", "revenue"],
  pageview: ["page", "view", "traffic", "session"],
  pipeline: ["deal", "opportunity", "forecast"],
  poc: ["proof", "concept", "trial", "pilot"],
  revenue: ["bookings", "arr", "mrr", "won"],
  signup: ["registration", "created", "onboard"],
  traffic: ["pageview", "session", "visit"],
  usage: ["active", "engagement"],
  user: ["member", "person", "seat"],
  wau: ["weekly", "active", "user"],
};

// Metric-shaped words that appear in a large share of titles and so discriminate
// almost nothing on their own. Scored down rather than dropped: "error rate" must
// still beat "rate", but four unrelated "... Rate" entries must not tie above the
// panel that actually matches "error".
const LOW_INFORMATION_TERMS = new Set([
  "average",
  "percent",
  "percentage",
  "rate",
  "ratio",
  "score",
  "value",
  "volume",
]);

// Cheap plural folding. The corpus writes "Template"/"Deal" while users type
// "templates"/"deals"; exact substring matching missed every one of those.
function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies"))
    return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("sses")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

// Splits camelCase and snake_case so warehouse identifiers are searchable:
// `dim_hs_deals` -> dim, hs, deal.
function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(stem);
}

function searchTerms(search: string): string[] {
  const tokens = tokenize(search);
  if (!tokens.length) return [];
  const meaningful = tokens.filter(
    (term) => term.length > 1 && !STOP_WORDS.has(term),
  );
  return Array.from(new Set(meaningful.length ? meaningful : tokens));
}

function expandedTerms(primary: string[]): string[] {
  const primarySet = new Set(primary);
  const expanded = new Set<string>();
  for (const term of primary) {
    for (const synonym of SYNONYM_EXPANSIONS[term] ?? []) {
      const stemmed = stem(synonym);
      if (!primarySet.has(stemmed)) expanded.add(stemmed);
    }
  }
  return [...expanded];
}

// SQL bodies run to 12k chars; scoring only needs the leading identifiers.
const MAX_SCORED_FIELD_CHARS = 4_000;

function matchScore(
  search: string,
  weightedFields: Array<{ value: unknown; weight: number }>,
): { score: number; matchedTerms: string[] } {
  const terms = searchTerms(search);
  if (!terms.length) return { score: 0, matchedTerms: [] };
  const synonyms = expandedTerms(terms);

  const normalizedSearch = search.toLowerCase().trim();
  const matched = new Set<string>();
  let score = 0;
  for (const field of weightedFields) {
    const raw = text(field.value).slice(0, MAX_SCORED_FIELD_CHARS);
    if (!raw) continue;
    const lowered = raw.toLowerCase();
    const tokens = new Set(tokenize(raw));

    if (normalizedSearch.length > 2 && lowered.includes(normalizedSearch)) {
      score += field.weight * 4;
    }
    for (const term of terms) {
      if (!tokens.has(term) && !lowered.includes(term)) continue;
      matched.add(term);
      score += field.weight * (LOW_INFORMATION_TERMS.has(term) ? 0.3 : 1);
    }
    for (const synonym of synonyms) {
      if (!tokens.has(synonym)) continue;
      score += field.weight * 0.4;
    }
  }

  // Proportional, not all-or-nothing: a 7-word question could never hit the old
  // full-coverage bonus, so long real questions collapsed to near-random scores.
  // Damped for short queries — at full strength every one-of-one-token match tied
  // at the same score, so generic "... Rate" entries mass-tied above exact panels.
  const coverageWeight = Math.min(terms.length, 3) / 3;
  score += 40 * (matched.size / terms.length) * coverageWeight;
  return { score: Math.round(score), matchedTerms: [...matched] };
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

  const wantsDemo = /\bdemo\b|node exporter/i.test(args.search);

  return panels.flatMap((panel) => {
    // 38k of the ~39k indexed panels are clones of the demo Node Exporter dashboard.
    // They drown real saved work and are never the answer to a real data question.
    if (!wantsDemo && text(panel.source) === "demo") return [];
    // Panels without SQL (extensions, embeds) used to be dropped outright, which hid
    // 61% of real dashboards from search even when their titles matched exactly.
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
        // Weighted 2 against a title's 24, this 12x discount hid every panel whose
        // match lived only in its SQL — the majority of them.
        value: query
          ? typeof query === "string"
            ? query
            : JSON.stringify(query)
          : "",
        weight: 8,
      },
    ]);
    // Prefer the general panel over a narrower variant ("Signups" over "Clip Share
    // Signups 30d"), but cap it: the original uncapped -12/token buried long,
    // well-named panels under short vague ones.
    const requestedTerms = new Set(searchTerms(args.search));
    const unmatchedTitleTerms = searchTerms(panelTitle).filter(
      (term) => !requestedTerms.has(term),
    ).length;
    const titleSpecificityPenalty = Math.min(unmatchedTitleTerms, 4) * 4;
    // A panel with no SQL costs the agent another call to become useful, so it must
    // not outrank an equally-relevant runnable one. Waived when the title is clearly
    // on-topic: real questions carry clause words no title contains, so requiring
    // full coverage here never fires and buries exact-topic panels.
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
    const score =
      rawScore -
      titleSpecificityPenalty -
      missingQueryPenalty +
      aggregateIntent;
    if (score <= 0) return [];

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

  const ranked = candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Prefer something the agent can run over something it must look up again.
    const aRunnable = candidateIsRunnable(a);
    const bRunnable = candidateIsRunnable(b);
    if (aRunnable !== bRunnable) return aRunnable ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "data-dictionary" ? -1 : 1;
    return JSON.stringify(a).localeCompare(JSON.stringify(b));
  });

  // Cloned dashboards produce near-identical panels that otherwise eat every slot.
  const seen = new Set<string>();
  const deduped: AnalyticsQueryCatalogCandidate[] = [];
  for (const candidate of ranked) {
    if (deduped.length >= args.limit) break;
    if (seen.has(candidateDedupeKey(candidate))) continue;
    seen.add(candidateDedupeKey(candidate));
    deduped.push(candidate);
  }
  return deduped;
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
  const [savedDashboardsResult, dictionaryEntriesResult] =
    await Promise.allSettled([
      listDashboards(
        { email: args.email, orgId: args.orgId },
        { kind: "sql", archived: "active", hidden: "visible" },
      ),
      listDictionaryEntries({ email: args.email, orgId: args.orgId }),
    ]);
  const savedDashboards =
    savedDashboardsResult.status === "fulfilled"
      ? savedDashboardsResult.value
      : [];
  const dictionaryEntries =
    dictionaryEntriesResult.status === "fulfilled"
      ? dictionaryEntriesResult.value
      : [];

  const savedIds = new Set(savedDashboards.map((dashboard) => dashboard.id));
  const templateDashboards = dashboardCatalogEntries
    .filter((entry) => !savedIds.has(entry.defaultDashboardId))
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
