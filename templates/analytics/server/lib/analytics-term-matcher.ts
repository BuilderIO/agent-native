import { createHash } from "node:crypto";

const STOP_WORDS = new Set([
  "a",
  "about",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "could",
  "count",
  "data",
  "day",
  "days",
  "did",
  "do",
  "does",
  "exact",
  "find",
  "for",
  "from",
  "get",
  "give",
  "has",
  "have",
  "hello",
  "her",
  "here",
  "hey",
  "hi",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "last",
  "look",
  "many",
  "me",
  "metric",
  "my",
  "no",
  "not",
  "number",
  "of",
  "ok",
  "okay",
  "on",
  "or",
  "our",
  "out",
  "over",
  "please",
  "should",
  "show",
  "so",
  "some",
  "than",
  "thank",
  "thanks",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "time",
  "to",
  "today",
  "total",
  "up",
  "was",
  "we",
  "week",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "yes",
  "yesterday",
  "you",
  "your",
]);

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
  member: ["user", "person", "seat"],
  mau: ["monthly", "active", "user"],
  organization: ["org", "workspace", "team", "company"],
  org: ["organization", "workspace", "team", "company"],
  mql: ["marketing", "qualified", "lead"],
  mrr: ["monthly", "recurring", "revenue"],
  pageview: ["page", "view", "traffic", "session"],
  pipeline: ["deal", "opportunity", "forecast"],
  poc: ["proof", "concept", "trial", "pilot"],
  revenue: ["bookings", "arr", "mrr", "won"],
  signup: ["registration", "created", "onboard"],
  traffic: ["pageview", "session", "visit"],
  team: ["organization", "org", "workspace"],
  usage: ["active", "engagement"],
  user: ["member", "person", "seat"],
  wau: ["weekly", "active", "user"],
  workspace: ["organization", "org", "team"],
};

export const LOW_INFORMATION_TERMS = new Set([
  "average",
  "percent",
  "percentage",
  "rate",
  "ratio",
  "score",
  "value",
  "volume",
]);

const PRODUCT_TERMS = new Set([
  "app",
  "chart",
  "dashboard",
  "graph",
  "page",
  "panel",
  "tab",
  "widget",
]);
const MAX_SCORED_FIELD_CHARS = 4_000;

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies"))
    return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("sses")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

function rawTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\bsign[\s_-]+up\b/gi, "signup")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function tokenize(value: string): string[] {
  return rawTokens(value).map(stem);
}

function meaningfulTerms(search: string): string[] {
  const terms = rawTokens(search)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(stem)
    .filter((term) => !STOP_WORDS.has(term));
  return Array.from(new Set(terms));
}

export function searchTerms(search: string): string[] {
  const meaningful = meaningfulTerms(search);
  if (meaningful.length) return meaningful;
  return Array.from(new Set(tokenize(search)));
}

export function relevanceTerms(search: string): string[] {
  return meaningfulTerms(search).filter(
    (term) => term.length >= 3 && !PRODUCT_TERMS.has(term),
  );
}

export function semanticScopeForSearch(value: string): string {
  const terms = new Set(searchTerms(value));
  const has = (...values: string[]) => values.some((term) => terms.has(term));
  if (
    ((has("agent") && has("native")) || has("analytics", "analytic")) &&
    has("user", "person", "people", "member")
  ) {
    return "analytics_user";
  }
  if (has("contact", "deal", "lead", "pipeline", "crm")) return "crm_record";
  if (has("session", "visitor", "pageview", "visit")) return "session";
  if (
    has(
      "event",
      "activity",
      "active",
      "usage",
      "feature",
      "funnel",
      "conversion",
      "activation",
      "adoption",
      "action",
    )
  ) {
    return "product_activity";
  }
  if (
    has("organization", "org", "company", "workspace", "team") &&
    has("membership", "member")
  ) {
    return "membership";
  }
  if (
    has("organization", "org", "company", "workspace", "team") &&
    has("user", "person", "people")
  ) {
    return "membership";
  }
  if (has("builder", "product") && has("user", "person", "people", "member")) {
    return "product_user";
  }
  if (has("organization", "org", "company", "workspace", "team")) {
    return "organization";
  }
  if (has("user", "person", "people", "profile", "seat")) return "person";
  return "unknown";
}

export function semanticScopeCompatibility(
  candidateScope: string,
  requestedScope: string,
): number {
  if (candidateScope === "unknown" || requestedScope === "unknown") return 1;
  if (candidateScope === requestedScope) return 2;
  if (
    requestedScope === "person" &&
    ["product_user", "analytics_user", "membership"].includes(candidateScope)
  ) {
    return 2;
  }
  if (
    candidateScope === "person" &&
    (requestedScope === "product_user" || requestedScope === "analytics_user")
  ) {
    return 1;
  }
  return 0;
}

export function matchSearchFields(
  search: string,
  weightedFields: Array<{ value: unknown; weight: number }>,
): { score: number; matchedTerms: string[] } {
  const terms = searchTerms(search);
  if (!terms.length) return { score: 0, matchedTerms: [] };
  const normalizedSearch = search.toLowerCase().trim();
  const matched = new Set<string>();
  let score = 0;
  for (const field of weightedFields) {
    const raw =
      typeof field.value === "string"
        ? field.value.trim().slice(0, MAX_SCORED_FIELD_CHARS)
        : "";
    if (!raw) continue;
    const lowered = raw.toLowerCase();
    const tokens = new Set(tokenize(raw));
    if (normalizedSearch.length > 2 && lowered.includes(normalizedSearch)) {
      score += field.weight * 4;
    }
    for (const term of terms) {
      if (!tokens.has(term)) continue;
      matched.add(term);
      score += field.weight * (LOW_INFORMATION_TERMS.has(term) ? 0.3 : 1);
    }
    for (const term of terms) {
      for (const synonym of SYNONYM_EXPANSIONS[term] ?? []) {
        if (!tokens.has(stem(synonym))) continue;
        matched.add(term);
        score += field.weight * 0.4;
      }
    }
  }
  const coverageWeight = Math.min(terms.length, 3) / 3;
  score += 40 * (matched.size / terms.length) * coverageWeight;
  return { score: Math.round(score), matchedTerms: [...matched] };
}

function cursorQueryHash(search: string): string {
  return createHash("sha256")
    .update(search.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

export function encodeSearchCursor(search: string, offset: number): string {
  return `v1.${cursorQueryHash(search)}.${Math.max(0, Math.trunc(offset))}`;
}

export function decodeSearchCursor(search: string, cursor?: string): number {
  if (!cursor) return 0;
  const match = cursor.match(/^v1\.([a-f0-9]{16})\.(\d+)$/);
  if (!match || match[1] !== cursorQueryHash(search)) {
    throw new Error("The search cursor does not match this query.");
  }
  const offset = Number(match[2]);
  if (!Number.isSafeInteger(offset)) {
    throw new Error("The search cursor is invalid.");
  }
  return offset;
}

export function paginateSearchResults<T>(args: {
  search: string;
  results: T[];
  searched: number;
  limit: number;
  offset: number;
  truncated?: boolean;
}) {
  if (args.offset > args.results.length) {
    throw new Error(
      "The search cursor is no longer valid; restart the search.",
    );
  }
  const end = args.offset + args.limit;
  const hasMoreResults = end < args.results.length;
  return {
    results: args.results.slice(args.offset, end),
    searched: args.searched,
    of: args.results.length,
    truncated: args.truncated === true || hasMoreResults,
    nextPage: hasMoreResults ? encodeSearchCursor(args.search, end) : null,
  };
}
