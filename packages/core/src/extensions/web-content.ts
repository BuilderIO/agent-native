import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom/worker";
import safeRegex from "safe-regex2";
import TurndownService from "turndown";

export type WebResponseMode =
  | "auto"
  | "raw"
  | "text"
  | "markdown"
  | "links"
  | "metadata"
  | "matches";

export type WebExtractMode = "readability" | "all-visible" | "none";
export type WebSearchSource = "extracted" | "raw";

export interface WebContentSearchOptions {
  query?: string | string[];
  queries?: string[];
  terms?: string[];
  regex?: string;
  regexFlags?: string;
  caseSensitive?: boolean;
  source?: WebSearchSource;
  maxMatches?: number;
  contextChars?: number;
}

export interface WebContentProcessOptions {
  url: string;
  body: string;
  contentType?: string | null;
  responseMode?: string;
  extract?: string;
  includeLinks?: boolean;
  search?: WebContentSearchOptions | null;
  maxChars?: number;
}

export interface WebContentLink {
  text: string;
  url: string;
}

export interface WebContentMatch {
  kind: "query" | "term" | "regex";
  query: string;
  match: string;
  index: number;
  snippet: string;
}

export interface WebContentResult {
  mode: Exclude<WebResponseMode, "auto">;
  extract: WebExtractMode;
  contentType: string | null;
  title?: string;
  excerpt?: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  publishedTime?: string;
  content?: string;
  links?: WebContentLink[];
  matches?: WebContentMatch[];
  totalMatches?: number;
  omittedMatches?: number;
  searchSource?: WebSearchSource;
  truncated?: boolean;
  searchTruncated?: boolean;
}

const DEFAULT_MAX_CONTENT_CHARS = 32_000;
const MAX_SEARCH_SOURCE_CHARS = 500_000;
const DEFAULT_MAX_MATCHES = 50;
const MAX_MATCHES = 500;
const DEFAULT_CONTEXT_CHARS = 160;
const MAX_CONTEXT_CHARS = 1_000;

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  linkStyle: "inlined",
});
turndown.remove(["script", "style", "noscript"]);

export function hasWebContentSearch(
  search: WebContentSearchOptions | null | undefined,
): boolean {
  if (!search) return false;
  return Boolean(
    normalizeSearchList(search.query).length ||
    normalizeSearchList(search.queries).length ||
    normalizeSearchList(search.terms).length ||
    String(search.regex ?? "").trim(),
  );
}

export function normalizeWebResponseMode(
  value: unknown,
  fallback: WebResponseMode = "auto",
): WebResponseMode {
  const normalized = String(value || fallback).toLowerCase();
  if (
    normalized === "auto" ||
    normalized === "raw" ||
    normalized === "text" ||
    normalized === "markdown" ||
    normalized === "links" ||
    normalized === "metadata" ||
    normalized === "matches"
  ) {
    return normalized;
  }
  throw new Error(
    `Invalid responseMode "${String(value)}". Expected auto, raw, text, markdown, links, metadata, or matches.`,
  );
}

export function normalizeWebExtractMode(
  value: unknown,
  fallback: WebExtractMode = "readability",
): WebExtractMode {
  const normalized = String(value || fallback).toLowerCase();
  if (
    normalized === "readability" ||
    normalized === "all-visible" ||
    normalized === "none"
  ) {
    return normalized;
  }
  throw new Error(
    `Invalid extract "${String(value)}". Expected readability, all-visible, or none.`,
  );
}

export function parseWebContentSearchOptions(
  value: unknown,
): WebContentSearchOptions | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as WebContentSearchOptions;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as WebContentSearchOptions;
    }
  } catch {
    return { query: trimmed };
  }
  return null;
}

export function processWebContent(
  options: WebContentProcessOptions,
): WebContentResult {
  const contentType = options.contentType?.split(";")[0]?.trim() || null;
  const extract = normalizeWebExtractMode(options.extract);
  const requestedMode = normalizeWebResponseMode(options.responseMode);
  const search = options.search ?? null;
  const html = isHtmlResponse(contentType, options.body);
  const mode = resolveMode(requestedMode, html, search);
  const maxChars = normalizeBoundedNumber(
    options.maxChars,
    DEFAULT_MAX_CONTENT_CHARS,
    1,
    200_000,
  );

  const extracted =
    html && (mode !== "raw" || hasWebContentSearch(search))
      ? extractHtml(options.body, options.url, extract)
      : null;
  const baseContent = contentForMode(mode, options.body, extracted);
  const result: WebContentResult = {
    mode,
    extract,
    contentType,
    ...metadataFromExtraction(extracted),
  };

  if (mode === "links") {
    result.links = extracted?.links ?? [];
    return result;
  }

  if (mode === "metadata") {
    if (options.includeLinks) result.links = extracted?.links ?? [];
    return result;
  }

  if (mode === "matches") {
    const matchResult = findWebContentMatches({
      raw: options.body,
      extracted: baseContent,
      search,
      fallbackSearchSource: html ? "extracted" : "raw",
    });
    Object.assign(result, matchResult);
    if (options.includeLinks) result.links = extracted?.links ?? [];
    return result;
  }

  const truncated = baseContent.length > maxChars;
  result.content = truncated
    ? `${baseContent.slice(0, maxChars)}\n... (truncated)`
    : baseContent;
  result.truncated = truncated;
  if (options.includeLinks) result.links = extracted?.links ?? [];

  if (hasWebContentSearch(search)) {
    const matchResult = findWebContentMatches({
      raw: options.body,
      extracted: baseContent,
      search,
      fallbackSearchSource: html ? "extracted" : "raw",
    });
    result.matches = matchResult.matches;
    result.totalMatches = matchResult.totalMatches;
    result.omittedMatches = matchResult.omittedMatches;
    result.searchSource = matchResult.searchSource;
    result.searchTruncated = matchResult.searchTruncated;
  }

  return result;
}

export function formatWebContentResult(result: WebContentResult): string {
  if (result.mode === "raw") return result.content ?? "";

  const lines: string[] = [];
  if (result.title) lines.push(`# ${result.title}`, "");
  if (result.siteName) lines.push(`Site: ${result.siteName}`);
  if (result.publishedTime) lines.push(`Published: ${result.publishedTime}`);
  if (result.excerpt && result.mode !== "metadata") {
    lines.push(`Excerpt: ${result.excerpt}`);
  }
  if (lines.length && lines[lines.length - 1] !== "") lines.push("");

  if (result.mode === "matches") {
    lines.push(formatMatches(result));
  } else if (result.mode === "links") {
    lines.push(formatLinks(result.links ?? []));
  } else if (result.mode === "metadata") {
    lines.push(formatMetadata(result));
  } else if (result.content) {
    lines.push(result.content);
  }

  if (
    result.mode !== "links" &&
    result.mode !== "matches" &&
    result.links?.length
  ) {
    lines.push("", "Links:", formatLinks(result.links));
  }
  if (result.matches?.length && result.mode !== "matches") {
    lines.push("", formatMatches(result));
  }

  return lines.join("\n").trim();
}

function resolveMode(
  requestedMode: WebResponseMode,
  html: boolean,
  search: WebContentSearchOptions | null,
): Exclude<WebResponseMode, "auto"> {
  if (requestedMode === "auto") {
    if (hasWebContentSearch(search)) return "matches";
    return html ? "markdown" : "raw";
  }
  return requestedMode;
}

function isHtmlResponse(contentType: string | null, body: string): boolean {
  if (contentType) {
    return (
      contentType === "text/html" ||
      contentType === "application/xhtml+xml" ||
      contentType.endsWith("+html")
    );
  }
  return /<!doctype html|<html[\s>]|<body[\s>]|<article[\s>]/i.test(
    body.slice(0, 2_000),
  );
}

function extractHtml(
  body: string,
  url: string,
  extract: WebExtractMode,
): {
  html: string;
  text: string;
  markdown: string;
  links: WebContentLink[];
  title?: string;
  excerpt?: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  publishedTime?: string;
} {
  const document = parseFullDocument(body);
  removeNonContentNodes(document);
  const pageTitle = textOrUndefined(document.title);
  const article =
    extract === "readability"
      ? new Readability(document.cloneNode(true) as Document).parse()
      : null;
  const sourceHtml =
    extract === "none"
      ? body
      : article?.content ||
        document.body?.innerHTML ||
        document.documentElement.innerHTML ||
        body;
  const absoluteHtml = absolutizeHtmlUrls(sourceHtml, url);
  const sourceText =
    extract === "none"
      ? htmlToPlainText(body)
      : article?.textContent ||
        document.body?.textContent ||
        document.documentElement.textContent ||
        "";
  const markdown = htmlToMarkdown(absoluteHtml);
  return {
    html: absoluteHtml,
    text: normalizeWhitespace(sourceText),
    markdown,
    links: collectLinks(absoluteHtml, url),
    title: textOrUndefined(article?.title) ?? pageTitle,
    excerpt: textOrUndefined(article?.excerpt),
    byline: textOrUndefined(article?.byline),
    siteName: textOrUndefined(article?.siteName),
    lang: textOrUndefined(article?.lang),
    publishedTime: textOrUndefined(article?.publishedTime),
  };
}

function htmlToPlainText(html: string): string {
  const document = parseFullDocument(html);
  removeNonContentNodes(document);
  return normalizeWhitespace(document.body?.textContent ?? "");
}

function htmlToMarkdown(html: string): string {
  return normalizeMarkdown(turndown.turndown(html));
}

function removeNonContentNodes(document: Document) {
  for (const selector of [
    "script",
    "style",
    "noscript",
    "svg",
    "template",
    "iframe",
  ]) {
    for (const node of [...document.querySelectorAll(selector)]) {
      node.remove();
    }
  }
}

function parseFullDocument(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}

function parseHtmlFragment(html: string): Document {
  return parseHTML(
    `<!doctype html><html><head></head><body>${html}</body></html>`,
  ).document as unknown as Document;
}

function absolutizeHtmlUrls(html: string, url: string): string {
  const document = parseHtmlFragment(html);
  for (const anchor of [...document.querySelectorAll("a[href]")]) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    try {
      anchor.setAttribute("href", new URL(href, url).href);
    } catch {}
  }
  for (const image of [...document.querySelectorAll("img[src]")]) {
    const src = image.getAttribute("src");
    if (!src) continue;
    try {
      image.setAttribute("src", new URL(src, url).href);
    } catch {}
  }
  return document.body?.innerHTML || html;
}

function collectLinks(html: string, url: string): WebContentLink[] {
  const document = parseHtmlFragment(html);
  const links: WebContentLink[] = [];
  const seen = new Set<string>();
  for (const anchor of [...document.querySelectorAll("a[href]")]) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    let absolute: string;
    try {
      absolute = new URL(href, url).href;
    } catch {
      continue;
    }
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    links.push({
      text: normalizeWhitespace(anchor.textContent || absolute).slice(0, 200),
      url: absolute,
    });
    if (links.length >= 200) break;
  }
  return links;
}

function contentForMode(
  mode: Exclude<WebResponseMode, "auto">,
  raw: string,
  extracted: ReturnType<typeof extractHtml> | null,
): string {
  if (mode === "raw") return raw;
  if (mode === "text") return extracted?.text ?? raw;
  if (mode === "markdown" || mode === "matches") {
    return extracted?.markdown || extracted?.text || raw;
  }
  return "";
}

function metadataFromExtraction(
  extracted: ReturnType<typeof extractHtml> | null,
) {
  if (!extracted) return {};
  return {
    ...(extracted.title ? { title: extracted.title } : {}),
    ...(extracted.excerpt ? { excerpt: extracted.excerpt } : {}),
    ...(extracted.byline ? { byline: extracted.byline } : {}),
    ...(extracted.siteName ? { siteName: extracted.siteName } : {}),
    ...(extracted.lang ? { lang: extracted.lang } : {}),
    ...(extracted.publishedTime
      ? { publishedTime: extracted.publishedTime }
      : {}),
  };
}

function findWebContentMatches(options: {
  raw: string;
  extracted: string;
  search: WebContentSearchOptions | null;
  fallbackSearchSource: WebSearchSource;
}): Pick<
  WebContentResult,
  | "matches"
  | "totalMatches"
  | "omittedMatches"
  | "searchSource"
  | "searchTruncated"
> {
  const search = options.search ?? {};
  const sourceMode = search.source ?? options.fallbackSearchSource;
  const source = sourceMode === "raw" ? options.raw : options.extracted;
  const searchTruncated = source.length > MAX_SEARCH_SOURCE_CHARS;
  const searchable = searchTruncated
    ? source.slice(0, MAX_SEARCH_SOURCE_CHARS)
    : source;
  const maxMatches = normalizeBoundedNumber(
    search.maxMatches,
    DEFAULT_MAX_MATCHES,
    1,
    MAX_MATCHES,
  );
  const contextChars = normalizeBoundedNumber(
    search.contextChars,
    DEFAULT_CONTEXT_CHARS,
    0,
    MAX_CONTEXT_CHARS,
  );
  const matches: WebContentMatch[] = [];
  let totalMatches = 0;
  const caseSensitive = Boolean(search.caseSensitive);

  const addMatch = (match: Omit<WebContentMatch, "snippet">) => {
    totalMatches += 1;
    if (matches.length >= maxMatches) return;
    matches.push({
      ...match,
      snippet: makeSnippet(searchable, match.index, contextChars),
    });
  };

  for (const query of [
    ...normalizeSearchList(search.query),
    ...normalizeSearchList(search.queries),
  ]) {
    findLiteralMatches(searchable, query, caseSensitive, (index, match) =>
      addMatch({ kind: "query", query, match, index }),
    );
  }

  for (const term of normalizeSearchList(search.terms)) {
    findLiteralMatches(searchable, term, caseSensitive, (index, match) =>
      addMatch({ kind: "term", query: term, match, index }),
    );
  }

  const regexPattern = String(search.regex ?? "").trim();
  if (regexPattern) {
    if (!safeRegex(regexPattern, { limit: 25 })) {
      throw new Error(
        "Unsafe regex rejected. Use a simpler literal query/terms search or a bounded run-code workflow.",
      );
    }
    const regex = new RegExp(
      regexPattern,
      normalizeRegexFlags(search.regexFlags, caseSensitive),
    );
    let match: RegExpExecArray | null;
    while (
      (match = regex.exec(searchable)) &&
      typeof match.index === "number"
    ) {
      addMatch({
        kind: "regex",
        query: regexPattern,
        match: match[0],
        index: match.index,
      });
      if (match[0] === "") regex.lastIndex += 1;
      if (totalMatches >= MAX_MATCHES * 10) break;
    }
  }

  matches.sort((a, b) => a.index - b.index);
  return {
    matches,
    totalMatches,
    omittedMatches: Math.max(0, totalMatches - matches.length),
    searchSource: sourceMode,
    searchTruncated,
  };
}

function findLiteralMatches(
  source: string,
  query: string,
  caseSensitive: boolean,
  onMatch: (index: number, match: string) => void,
) {
  if (!query) return;
  const haystack = caseSensitive ? source : source.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  let from = 0;
  while (from <= haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    onMatch(index, source.slice(index, index + query.length));
    from = index + Math.max(1, needle.length);
  }
}

function normalizeRegexFlags(
  flags: string | undefined,
  caseSensitive: boolean,
): string {
  const allowed = new Set(["d", "g", "i", "m", "s", "u", "v", "y"]);
  const result = new Set<string>(["g"]);
  if (!caseSensitive) result.add("i");
  for (const flag of String(flags ?? "")) {
    if (allowed.has(flag)) result.add(flag);
  }
  result.delete("y");
  return [...result].join("");
}

function normalizeSearchList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
}

function normalizeBoundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(Math.floor(numeric), max));
}

function makeSnippet(source: string, index: number, contextChars: number) {
  const start = Math.max(0, index - contextChars);
  const end = Math.min(source.length, index + contextChars);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < source.length ? "..." : "";
  return `${prefix}${normalizeWhitespace(source.slice(start, end))}${suffix}`;
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function textOrUndefined(value: string | null | undefined): string | undefined {
  const normalized = normalizeWhitespace(value ?? "");
  return normalized || undefined;
}

function formatMatches(result: WebContentResult): string {
  const matches = result.matches ?? [];
  const header = `Matches: ${matches.length}${result.totalMatches !== undefined ? ` shown of ${result.totalMatches}` : ""}${result.omittedMatches ? ` (${result.omittedMatches} omitted)` : ""}`;
  if (!matches.length) return header;
  return [
    header,
    ...matches.map(
      (match, index) =>
        `${index + 1}. ${match.kind} ${JSON.stringify(match.query)} at ${match.index}: ${match.snippet}`,
    ),
  ].join("\n");
}

function formatLinks(links: WebContentLink[]): string {
  if (!links.length) return "(none)";
  return links
    .map(
      (link, index) => `${index + 1}. [${link.text || link.url}](${link.url})`,
    )
    .join("\n");
}

function formatMetadata(result: WebContentResult): string {
  return JSON.stringify(
    {
      title: result.title,
      excerpt: result.excerpt,
      byline: result.byline,
      siteName: result.siteName,
      lang: result.lang,
      publishedTime: result.publishedTime,
      contentType: result.contentType,
    },
    null,
    2,
  );
}
