import safeRegex from "safe-regex2";

import { loadOptionalPeer } from "../shared/optional-peer.js";

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
  /** `null` keeps the complete content available for a saved workspace file. */
  maxChars?: number | null;
  saveContentFormat?: "markdown" | "text";
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
  agentMetadata?: unknown[];
  content?: string;
  fullContent?: string;
  /** Format of `fullContent`: the requested `saveContentFormat` when
   * extraction produced usable text, or `"raw"` when it failed or the
   * extracted markdown/text was empty and `fullContent` is the original
   * response body. Callers must not label the latter as text/markdown. */
  fullContentFormat?: "raw" | "markdown" | "text";
  contentLength?: number;
  links?: WebContentLink[];
  matches?: WebContentMatch[];
  totalMatches?: number;
  omittedMatches?: number;
  searchSource?: WebSearchSource;
  truncated?: boolean;
  /** `content` is the raw response body because extraction failed or produced
   * no usable text. Truncation footers must not describe that body as
   * extracted content. */
  rawBodyFallback?: boolean;
  searchTruncated?: boolean;
}

const WEB_CONTENT_TRUNCATION_MARKER = "\n... (truncated)";
const DEFAULT_MAX_CONTENT_CHARS = 32_000;
const MAX_SEARCH_SOURCE_CHARS = 500_000;
const DEFAULT_MAX_MATCHES = 50;
const MAX_MATCHES = 500;
const DEFAULT_CONTEXT_CHARS = 160;
const MAX_CONTEXT_CHARS = 1_000;
const MAX_AGENT_METADATA_SCRIPTS = 10;
const MAX_AGENT_METADATA_CHARS = 32_000;

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

export async function processWebContent(
  options: WebContentProcessOptions,
): Promise<WebContentResult> {
  const contentType = options.contentType?.split(";")[0]?.trim() || null;
  const extract = normalizeWebExtractMode(options.extract);
  const requestedMode = normalizeWebResponseMode(options.responseMode);
  const search = options.search ?? null;
  const html = isHtmlResponse(contentType, options.body);
  const mode = resolveMode(requestedMode, html, search);
  const emptyHtmlBody = html && !options.body.trim();
  const maxChars =
    options.maxChars === null
      ? Number.POSITIVE_INFINITY
      : normalizeBoundedNumber(
          options.maxChars,
          DEFAULT_MAX_CONTENT_CHARS,
          1,
          200_000,
        );

  const shouldExtract =
    html &&
    !emptyHtmlBody &&
    (mode !== "raw" ||
      hasWebContentSearch(search) ||
      options.saveContentFormat);
  const extracted = shouldExtract
    ? await safeExtractHtml(
        options.body,
        options.url,
        extract,
        mode === "markdown" ||
          mode === "matches" ||
          options.saveContentFormat === "markdown",
      )
    : null;
  const realExtractedText = extracted?.markdown || extracted?.text || "";
  const hasRealExtractedContent = realExtractedText.length > 0;
  // A non-null extraction with empty markdown and text is not success: text
  // mode would keep `""` (`??` does not fall through), and save would write
  // an empty file while still labeling text/markdown.
  const noUsableExtractedText = shouldExtract && !hasRealExtractedContent;
  const baseContent = contentForMode(mode, options.body, extracted);
  // `baseContent` is the raw body for responseMode "raw", for a failed
  // extraction, and when markdown/text came back empty. Those bytes must not
  // be reported as extracted.
  const hasExtractedContent =
    hasRealExtractedContent && baseContent !== options.body;
  // The tool schema promises that an omitted `search.source` means the
  // extracted text. Keep that default even when responseMode "raw" displays
  // the raw body; only fall back to raw when extraction produced no usable
  // text.
  const fallbackSearchSource: WebSearchSource = hasRealExtractedContent
    ? "extracted"
    : "raw";
  const rawBodyFallback = mode !== "raw" && !hasExtractedContent;
  const savedExtractedText =
    options.saveContentFormat === "text"
      ? extracted?.text || ""
      : realExtractedText;
  const fullContent = options.saveContentFormat
    ? savedExtractedText || options.body
    : undefined;
  // Empty extracted text is the raw response body, not the requested
  // text/markdown. Label it `raw` so the save path keeps the original
  // content type instead of writing an empty file under a Markdown/text label.
  const fullContentFormat = options.saveContentFormat
    ? savedExtractedText
      ? options.saveContentFormat
      : "raw"
    : undefined;
  const result: WebContentResult = {
    mode,
    extract,
    contentType,
    ...metadataFromExtraction(extracted),
    ...(fullContent !== undefined ? { fullContent } : {}),
    ...(fullContentFormat !== undefined ? { fullContentFormat } : {}),
    ...(mode !== "links" && mode !== "metadata"
      ? { contentLength: baseContent.length }
      : {}),
    ...(rawBodyFallback ? { rawBodyFallback: true } : {}),
  };

  if (
    emptyHtmlBody &&
    mode !== "raw" &&
    mode !== "links" &&
    mode !== "metadata" &&
    mode !== "matches"
  ) {
    result.content = "(empty response body)";
    result.truncated = false;
    if (options.includeLinks) result.links = [];
    return result;
  }

  if (mode === "links") {
    result.links = extracted?.links ?? [];
    if (noUsableExtractedText) {
      applyFallbackBody(result, options.body, maxChars);
    }
    return result;
  }

  if (mode === "metadata") {
    if (options.includeLinks) result.links = extracted?.links ?? [];
    if (noUsableExtractedText) {
      applyFallbackBody(result, options.body, maxChars);
    }
    return result;
  }

  if (mode === "matches") {
    if (noUsableExtractedText) {
      applyFallbackBody(result, options.body, maxChars);
    }
    const matchResult = findWebContentMatches({
      raw: options.body,
      extracted: hasRealExtractedContent ? realExtractedText : baseContent,
      search,
      fallbackSearchSource,
      hasExtractedContent: hasRealExtractedContent,
    });
    Object.assign(result, matchResult);
    if (options.includeLinks) result.links = extracted?.links ?? [];
    return result;
  }

  const limited = limitWebContent(baseContent, maxChars);
  result.content = limited.content;
  result.truncated = limited.truncated;
  if (options.includeLinks) result.links = extracted?.links ?? [];

  if (hasWebContentSearch(search)) {
    const matchResult = findWebContentMatches({
      raw: options.body,
      extracted: hasRealExtractedContent ? realExtractedText : baseContent,
      search,
      fallbackSearchSource,
      hasExtractedContent: hasRealExtractedContent,
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
    if (result.content) lines.push("", result.content);
  } else if (result.mode === "links") {
    lines.push(formatLinks(result.links ?? []));
    if (result.content) lines.push("", result.content);
  } else if (result.mode === "metadata") {
    lines.push(formatMetadata(result));
    if (result.content) lines.push("", result.content);
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
  if (result.agentMetadata?.length) {
    lines.push(
      "",
      "Agent-readable metadata:",
      JSON.stringify(result.agentMetadata, null, 2),
    );
  }
  if (result.matches?.length && result.mode !== "matches") {
    lines.push("", formatMatches(result));
  }
  appendRawTruncationFooter(lines, result);

  return lines.join("\n").trim();
}

function limitWebContent(
  body: string,
  maxChars: number,
): { content: string; truncated: boolean } {
  if (body.length <= maxChars) return { content: body, truncated: false };
  return {
    content: `${body.slice(0, maxChars)}${WEB_CONTENT_TRUNCATION_MARKER}`,
    truncated: true,
  };
}

function applyFallbackBody(
  result: WebContentResult,
  body: string,
  maxChars: number,
) {
  const limited = limitWebContent(body, maxChars);
  result.content = limited.content;
  result.truncated = limited.truncated;
  result.contentLength = body.length;
  result.rawBodyFallback = true;
}

function appendRawTruncationFooter(lines: string[], result: WebContentResult) {
  if (!result.rawBodyFallback || !result.truncated) return;
  if (
    result.content &&
    !result.content.includes(WEB_CONTENT_TRUNCATION_MARKER)
  ) {
    lines.push(WEB_CONTENT_TRUNCATION_MARKER.trim());
  }
  if (result.contentLength === undefined) return;
  lines.push("", `Full raw response: ${result.contentLength} characters.`);
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
    const mediaType = contentType.toLowerCase();
    return (
      mediaType === "text/html" ||
      mediaType === "application/xhtml+xml" ||
      mediaType.endsWith("+html")
    );
  }
  return /<!doctype html|<html[\s>]|<body[\s>]|<article[\s>]/i.test(
    body.slice(0, 2_000),
  );
}

function isHtmlParserRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // linkedom surfaces a missing root by destructuring a null
  // `documentElement`. Turndown collapses the same unparseable markup (e.g. a
  // frameset served as text/html) to a null root and throws reading
  // `firstChild`. Match only those null-root shapes — a message that merely
  // mentions documentElement is a different failure and must propagate.
  const message = error.message;
  return (
    /of ['"]documentElement['"] as it is null/i.test(message) ||
    /null \(reading ['"]documentElement['"]\)/i.test(message) ||
    /null \(reading ['"]firstChild['"]\)/i.test(message)
  );
}

async function safeExtractHtml(
  body: string,
  url: string,
  extract: WebExtractMode,
  includeMarkdown: boolean,
): Promise<{
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
  agentMetadata?: unknown[];
} | null> {
  try {
    return await extractHtml(body, url, extract, includeMarkdown);
  } catch (error) {
    if (!isHtmlParserRejection(error)) throw error;
    // If the parser rejects the body (e.g. linkedom throws because the
    // document has no parseable documentElement), fall back to treating the
    // HTML-labeled response as plain text so web-request surfaces the status
    // and body instead of an internal post-processing error.
    return null;
  }
}

async function extractHtml(
  body: string,
  url: string,
  extract: WebExtractMode,
  includeMarkdown: boolean,
): Promise<{
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
  agentMetadata?: unknown[];
}> {
  const { parseHTML } = await loadOptionalPeer(
    "linkedom",
    () => import("linkedom/worker"),
  );
  const parseDocument = (html: string) =>
    parseHTML(html).document as unknown as Document;
  const document = parseFullDocument(body, parseDocument);
  const alternateLinks = collectAlternateLinks(document, url);
  const agentMetadata = collectAgentMetadata(document);
  removeNonContentNodes(document);
  const pageTitle = textOrUndefined(document.title);
  const article =
    extract === "readability"
      ? new (
          await loadOptionalPeer(
            "@mozilla/readability",
            () => import("@mozilla/readability"),
          )
        ).Readability(document.cloneNode(true) as Document).parse()
      : null;
  const sourceHtml =
    extract === "none"
      ? body
      : article?.content ||
        document.body?.innerHTML ||
        document.documentElement.innerHTML ||
        body;
  const absoluteHtml = absolutizeHtmlUrls(sourceHtml, url, parseDocument);
  const sourceText =
    extract === "none"
      ? htmlToPlainText(body, parseDocument)
      : article?.textContent ||
        document.body?.textContent ||
        document.documentElement.textContent ||
        "";
  const markdown = includeMarkdown ? await htmlToMarkdown(absoluteHtml) : "";
  return {
    html: absoluteHtml,
    text: normalizeWhitespace(sourceText),
    markdown,
    links: mergeLinks(
      alternateLinks,
      collectLinks(absoluteHtml, url, parseDocument),
    ),
    title: textOrUndefined(article?.title) ?? pageTitle,
    excerpt: textOrUndefined(article?.excerpt),
    byline: textOrUndefined(article?.byline),
    siteName: textOrUndefined(article?.siteName),
    lang: textOrUndefined(article?.lang),
    publishedTime: textOrUndefined(article?.publishedTime),
    ...(agentMetadata.length ? { agentMetadata } : {}),
  };
}

function collectAgentMetadata(document: Document): unknown[] {
  const metadata: unknown[] = [];
  let totalChars = 0;
  for (const script of [
    ...document.querySelectorAll(
      'script[type="application/agent-native+json"]',
    ),
  ]) {
    if (metadata.length >= MAX_AGENT_METADATA_SCRIPTS) break;
    const json = script.textContent?.trim() ?? "";
    if (
      !json ||
      json.length > MAX_AGENT_METADATA_CHARS ||
      totalChars + json.length > MAX_AGENT_METADATA_CHARS
    ) {
      continue;
    }
    try {
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      metadata.push(parsed);
      totalChars += json.length;
    } catch {}
  }
  return metadata;
}

function collectAlternateLinks(
  document: Document,
  url: string,
): WebContentLink[] {
  const links: WebContentLink[] = [];
  for (const element of [
    ...document.querySelectorAll("a[href][rel], link[href][rel]"),
  ]) {
    const rel = element
      .getAttribute("rel")
      ?.toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!rel?.includes("alternate")) continue;

    const href = element.getAttribute("href");
    if (!href) continue;
    let absolute: string;
    try {
      absolute = new URL(href, url).href;
    } catch {
      continue;
    }

    const type = element.getAttribute("type")?.trim();
    const text = normalizeWhitespace(element.textContent || "");
    links.push({
      text: text || (type ? `Alternate ${type}` : "Alternate resource"),
      url: absolute,
    });
  }
  return links;
}

function mergeLinks(
  preferred: WebContentLink[],
  remaining: WebContentLink[],
): WebContentLink[] {
  const links: WebContentLink[] = [];
  const seen = new Set<string>();
  for (const link of [...preferred, ...remaining]) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    links.push(link);
    if (links.length >= 200) break;
  }
  return links;
}

function htmlToPlainText(
  html: string,
  parseDocument: (html: string) => Document,
): string {
  const document = parseFullDocument(html, parseDocument);
  removeNonContentNodes(document);
  return normalizeWhitespace(document.body?.textContent ?? "");
}

async function htmlToMarkdown(html: string): Promise<string> {
  const { default: TurndownService } = await loadOptionalPeer(
    "turndown",
    () => import("turndown"),
  );
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    linkStyle: "inlined",
  });
  turndown.remove(["script", "style", "noscript"]);
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

function parseFullDocument(
  html: string,
  parseDocument: (html: string) => Document,
): Document {
  const document = parseDocument(html);
  return document.documentElement
    ? document
    : parseHtmlFragment(html, parseDocument);
}

function parseHtmlFragment(
  html: string,
  parseDocument: (html: string) => Document,
): Document {
  return parseDocument(
    `<!doctype html><html><head></head><body>${html}</body></html>`,
  );
}

function absolutizeHtmlUrls(
  html: string,
  url: string,
  parseDocument: (html: string) => Document,
): string {
  const document = parseHtmlFragment(html, parseDocument);
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

function collectLinks(
  html: string,
  url: string,
  parseDocument: (html: string) => Document,
): WebContentLink[] {
  const document = parseHtmlFragment(html, parseDocument);
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

type ExtractedHtml = Awaited<ReturnType<typeof extractHtml>>;

function contentForMode(
  mode: Exclude<WebResponseMode, "auto">,
  raw: string,
  extracted: ExtractedHtml | null,
): string {
  if (mode === "raw") return raw;
  // `??` would keep an empty string from a non-null extraction and surface
  // a blank text result for markup-only pages.
  if (mode === "text") return extracted?.text || raw;
  if (mode === "markdown" || mode === "matches") {
    return extracted?.markdown || extracted?.text || raw;
  }
  return "";
}

function metadataFromExtraction(extracted: ExtractedHtml | null) {
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
    ...(extracted.agentMetadata?.length
      ? { agentMetadata: extracted.agentMetadata }
      : {}),
  };
}

function findWebContentMatches(options: {
  raw: string;
  extracted: string;
  search: WebContentSearchOptions | null;
  fallbackSearchSource: WebSearchSource;
  hasExtractedContent?: boolean;
}): Pick<
  WebContentResult,
  | "matches"
  | "totalMatches"
  | "omittedMatches"
  | "searchSource"
  | "searchTruncated"
> {
  const search = options.search ?? {};
  // Force raw only when there is no usable extracted text. responseMode
  // "raw" still displays the raw body, but an omitted or explicit
  // source: "extracted" searches the extracted markdown/text when it exists.
  const requestedSource = search.source ?? options.fallbackSearchSource;
  let sourceMode: WebSearchSource = options.hasExtractedContent
    ? requestedSource
    : "raw";
  const source = sourceMode === "raw" ? options.raw : options.extracted;
  if (source === options.raw) sourceMode = "raw";
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
  const sourceLabel = result.searchSource
    ? ` [source: ${result.searchSource}]`
    : "";
  const header = `Matches: ${matches.length}${result.totalMatches !== undefined ? ` shown of ${result.totalMatches}` : ""}${result.omittedMatches ? ` (${result.omittedMatches} omitted)` : ""}${sourceLabel}`;
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
