import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { accessFilter } from "@agent-native/core/sharing";
import { getDb, schema } from "../db/index.js";
import { parseJson } from "./brain.js";
import type { BrainEvidence } from "../../shared/types.js";

export type UniversalSearchType = "knowledge" | "capture" | "source";

export interface UniversalSearchResult {
  type: UniversalSearchType;
  id: string;
  title: string;
  snippet: string;
  summary: string | null;
  status: string;
  provider: string | null;
  source: {
    id: string;
    title: string;
    provider: string;
    status: string;
  } | null;
  sourceUrl: string | null;
  citation: {
    captureId?: string | null;
    captureTitle?: string | null;
    quote?: string | null;
    sourceUrl?: string | null;
  } | null;
  confidence: number | null;
  updatedAt: string;
  score: number;
}

const STOPWORDS = new Set([
  "about",
  "does",
  "from",
  "have",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "why",
  "the",
  "and",
  "for",
  "our",
  "did",
]);

export function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function normalizeSearchTerms(query: string): string[] {
  const phrase = query
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .join(" ");
  if (!phrase) return [];
  const tokens = phrase
    .split(/[^a-z0-9-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
  return Array.from(new Set([phrase, ...tokens])).slice(0, 8);
}

function likeEscaped(column: unknown, term: string): SQL {
  return sql`lower(${column}) like ${`%${escapeLikeTerm(term)}%`} escape '\\'`;
}

function anyColumnMatches(columns: unknown[], terms: string[]): SQL {
  const clauses = terms.flatMap((term) =>
    columns.map((column) => likeEscaped(column, term)),
  );
  return or(...clauses) ?? sql`1=0`;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function tokenAround(value: string, start: number, end: number): string {
  let tokenStart = start;
  while (tokenStart > 0 && !/\s/.test(value[tokenStart - 1] ?? "")) {
    tokenStart -= 1;
  }
  let tokenEnd = end;
  while (tokenEnd < value.length && !/\s/.test(value[tokenEnd] ?? "")) {
    tokenEnd += 1;
  }
  return value.slice(tokenStart, tokenEnd);
}

function shouldRedactPhoneLike(
  fullText: string,
  match: string,
  start: number,
): boolean {
  const digits = match.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 16) return false;
  const token = tokenAround(fullText, start, start + match.length);
  if (/(?:https?:\/\/|www\.)/i.test(token)) return false;
  if (/^\d{4}-\d{2}-\d{2}(?:\b|[T\s])/.test(match.trim())) return false;
  return true;
}

export function redactSensitiveText(value: string): string {
  const withoutMail = value
    .replace(/<mailto:[^>|]+(?:\|[^>]+)?>/gi, "[redacted]")
    .replace(/<@[UW][A-Z0-9]+(?:\|[^>]+)?>/g, "[redacted]")
    .replace(/\bU[A-Z0-9]{8,}\b/g, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]");
  return withoutMail.replace(
    /(?:\+?\d|\(\d{2,4}\))[\d\s().-]{6,}\d/g,
    (match, offset: number) =>
      shouldRedactPhoneLike(withoutMail, match, offset) ? "[redacted]" : match,
  );
}

export function redactSensitiveValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactSensitiveText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactSensitiveValue(item),
      ]),
    ) as T;
  }
  return value;
}

export function buildSnippet(
  value: string,
  terms: string[],
  maxLength = 260,
): string {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  const lower = text.toLowerCase();
  const firstIndex = terms.reduce((best, term) => {
    const index = lower.indexOf(term);
    return index >= 0 && (best < 0 || index < best) ? index : best;
  }, -1);
  const start = Math.max(
    0,
    (firstIndex < 0 ? 0 : firstIndex) - Math.floor(maxLength / 3),
  );
  const end = Math.min(text.length, start + maxLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

export function scoreSearchText(
  fields: {
    title?: string | null;
    summary?: string | null;
    body?: string | null;
    provider?: string | null;
    status?: string | null;
  },
  terms: string[],
): number {
  const title = cleanText(fields.title).toLowerCase();
  const summary = cleanText(fields.summary).toLowerCase();
  const body = cleanText(fields.body).toLowerCase();
  const metadata = cleanText(`${fields.provider ?? ""} ${fields.status ?? ""}`)
    .toLowerCase()
    .trim();
  let score = 0;
  terms.forEach((term, index) => {
    const phraseBoost = index === 0 ? 2 : 1;
    if (title.includes(term)) score += 40 * phraseBoost;
    if (summary.includes(term)) score += 20 * phraseBoost;
    if (body.includes(term)) score += 8 * phraseBoost;
    if (metadata.includes(term)) score += 6 * phraseBoost;
  });
  return score;
}

export function sourceUrlFromMetadata(
  metadata: Record<string, unknown>,
): string | null {
  for (const key of ["sourceUrl", "url", "permalink", "webUrl", "web_url"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function firstCitation(evidenceJson: string) {
  const evidence = parseJson<BrainEvidence[]>(evidenceJson, []);
  return (
    evidence.find((item) => item.sourceUrl ?? item.url) ?? evidence[0] ?? null
  );
}

async function accessibleSourceMap(sourceIds: Array<string | null>) {
  const ids = Array.from(
    new Set(sourceIds.filter((id): id is string => Boolean(id))),
  );
  if (!ids.length)
    return new Map<string, typeof schema.brainSources.$inferSelect>();
  const rows = await getDb()
    .select()
    .from(schema.brainSources)
    .where(
      and(
        accessFilter(schema.brainSources, schema.brainSourceShares),
        inArray(schema.brainSources.id, ids),
      ),
    );
  return new Map(rows.map((row) => [row.id, row]));
}

function serializeSourceInfo(
  row: typeof schema.brainSources.$inferSelect | undefined,
) {
  if (!row) return null;
  return {
    id: row.id,
    title: redactSensitiveText(row.title),
    provider: row.provider,
    status: row.status,
  };
}

async function searchKnowledgeResults(
  query: string,
  terms: string[],
  limit: number,
): Promise<UniversalSearchResult[]> {
  const rows = await getDb()
    .select()
    .from(schema.brainKnowledge)
    .where(
      and(
        accessFilter(schema.brainKnowledge, schema.brainKnowledgeShares),
        eq(schema.brainKnowledge.status, "published"),
        anyColumnMatches(
          [
            schema.brainKnowledge.title,
            schema.brainKnowledge.summary,
            schema.brainKnowledge.body,
            schema.brainKnowledge.topic,
          ],
          terms,
        ),
      ),
    )
    .orderBy(desc(schema.brainKnowledge.updatedAt))
    .limit(limit);
  const sources = await accessibleSourceMap(rows.map((row) => row.sourceId));
  return rows.map((row) => {
    const source = sources.get(row.sourceId ?? "");
    const citation = firstCitation(row.evidenceJson);
    const sourceUrl = citation?.sourceUrl ?? citation?.url ?? null;
    const summary = cleanText(row.summary) || buildSnippet(row.body, terms);
    const score =
      scoreSearchText(
        {
          title: row.title,
          summary: row.summary,
          body: row.body,
          status: row.status,
        },
        terms,
      ) +
      Math.round(row.confidence / 10) +
      10;
    return {
      type: "knowledge" as const,
      id: row.id,
      title: redactSensitiveText(row.title),
      snippet: redactSensitiveText(
        buildSnippet(`${summary} ${row.body}`, terms),
      ),
      summary: redactSensitiveText(summary),
      status: row.status,
      provider: source?.provider ?? null,
      source: serializeSourceInfo(source),
      sourceUrl,
      citation: citation
        ? {
            captureId: citation.captureId,
            captureTitle: citation.captureTitle
              ? redactSensitiveText(citation.captureTitle)
              : citation.captureTitle,
            quote: citation.quote
              ? redactSensitiveText(citation.quote)
              : citation.quote,
            sourceUrl,
          }
        : null,
      confidence: row.confidence,
      updatedAt: row.updatedAt,
      score,
    };
  });
}

async function searchCaptureResults(
  query: string,
  terms: string[],
  limit: number,
): Promise<UniversalSearchResult[]> {
  const accessibleSourceExists = sql`exists (
    select 1 from ${schema.brainSources}
    where ${schema.brainSources.id} = ${schema.brainRawCaptures.sourceId}
      and ${accessFilter(schema.brainSources, schema.brainSourceShares)}
  )`;
  const rows = await getDb()
    .select()
    .from(schema.brainRawCaptures)
    .where(
      and(
        accessibleSourceExists,
        anyColumnMatches(
          [
            schema.brainRawCaptures.title,
            schema.brainRawCaptures.content,
            schema.brainRawCaptures.kind,
          ],
          terms,
        ),
      ),
    )
    .orderBy(desc(schema.brainRawCaptures.updatedAt))
    .limit(limit);
  const sources = await accessibleSourceMap(rows.map((row) => row.sourceId));
  return rows.flatMap((row) => {
    const source = sources.get(row.sourceId);
    if (!source) return [];
    const metadata = parseJson<Record<string, unknown>>(row.metadataJson, {});
    const sourceUrl = sourceUrlFromMetadata(metadata);
    const snippet = redactSensitiveText(buildSnippet(row.content, terms));
    return [
      {
        type: "capture" as const,
        id: row.id,
        title: redactSensitiveText(row.title),
        snippet,
        summary: snippet,
        status: row.status,
        provider: source.provider,
        source: serializeSourceInfo(source),
        sourceUrl,
        citation: {
          captureId: row.id,
          captureTitle: redactSensitiveText(row.title),
          quote: snippet,
          sourceUrl,
        },
        confidence: null,
        updatedAt: row.updatedAt,
        score:
          scoreSearchText(
            {
              title: row.title,
              body: row.content,
              provider: row.kind,
              status: row.status,
            },
            terms,
          ) + 2,
      },
    ];
  });
}

async function searchSourceResults(
  query: string,
  terms: string[],
  limit: number,
): Promise<UniversalSearchResult[]> {
  const rows = await getDb()
    .select()
    .from(schema.brainSources)
    .where(
      and(
        accessFilter(schema.brainSources, schema.brainSourceShares),
        anyColumnMatches(
          [
            schema.brainSources.title,
            schema.brainSources.provider,
            schema.brainSources.status,
          ],
          terms,
        ),
      ),
    )
    .orderBy(desc(schema.brainSources.updatedAt))
    .limit(limit);
  return rows.map((row) => {
    const metadata = parseJson<Record<string, unknown>>(row.configJson, {});
    const sourceUrl = sourceUrlFromMetadata(metadata);
    return {
      type: "source" as const,
      id: row.id,
      title: redactSensitiveText(row.title),
      snippet: `${row.provider} source · ${row.status}`,
      summary: `${row.provider} source · ${row.status}`,
      status: row.status,
      provider: row.provider,
      source: {
        id: row.id,
        title: redactSensitiveText(row.title),
        provider: row.provider,
        status: row.status,
      },
      sourceUrl,
      citation: sourceUrl ? { sourceUrl } : null,
      confidence: null,
      updatedAt: row.updatedAt,
      score: scoreSearchText(
        {
          title: row.title,
          provider: row.provider,
          status: row.status,
        },
        terms,
      ),
    };
  });
}

export async function searchEverythingRows(args: {
  query: string;
  type?: UniversalSearchType | "all";
  provider?: string;
  status?: string;
  limit?: number;
}): Promise<UniversalSearchResult[]> {
  const terms = normalizeSearchTerms(args.query);
  if (!terms.length) return [];
  const limit = args.limit ?? 25;
  const perTypeLimit = Math.max(limit, 10);
  const searches: Array<Promise<UniversalSearchResult[]>> = [];
  if (!args.type || args.type === "all" || args.type === "knowledge") {
    searches.push(searchKnowledgeResults(args.query, terms, perTypeLimit));
  }
  if (!args.type || args.type === "all" || args.type === "capture") {
    searches.push(searchCaptureResults(args.query, terms, perTypeLimit));
  }
  if (!args.type || args.type === "all" || args.type === "source") {
    searches.push(searchSourceResults(args.query, terms, perTypeLimit));
  }
  const provider = args.provider?.toLowerCase();
  const status = args.status?.toLowerCase();
  const results = (await Promise.all(searches))
    .flat()
    .filter((result) => {
      const resultProvider = (
        result.provider ??
        result.source?.provider ??
        ""
      ).toLowerCase();
      const resultStatus = result.status.toLowerCase();
      const providerMatches = !provider || resultProvider === provider;
      const statusMatches = !status || resultStatus === status;
      return providerMatches && statusMatches;
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
        a.title.localeCompare(b.title),
    );
  return results.slice(0, limit);
}
