import { getSession } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import { getDb, schema } from "../../db";
import {
  fetchRemoteImage,
  type RemoteImageFailure,
} from "../../lib/fetch-remote-image.js";

/**
 * Re-serve a remote image from our own origin.
 *
 * PDF/PPTX export rasterizes the slide DOM through a canvas, and the browser
 * blanks out any image whose host does not send `Access-Control-Allow-Origin`.
 * No client-side flag can override that, so images on hosts without CORS have
 * to come back through us to be same-origin.
 *
 * This is an image-only, size-capped fetcher — not a general proxy. Editor
 * requests use the session; public shared presentations use their live share
 * token. See `fetch-remote-image.ts` for the address pinning that keeps it
 * from being turned into an SSRF primitive.
 */
const FAILURE_STATUS: Record<RemoteImageFailure, number> = {
  "unsupported-url": 400,
  "blocked-address": 400,
  "fetch-failed": 502,
  "too-many-redirects": 502,
  "not-an-image": 415,
  "too-large": 413,
};

const FAILURE_MESSAGE: Record<RemoteImageFailure, string> = {
  "unsupported-url": "Unsupported image URL",
  "blocked-address": "Unsupported image URL",
  "fetch-failed": "Could not fetch image",
  "too-many-redirects": "Too many redirects",
  "not-an-image": "Not an image",
  "too-large": "Image too large",
};

const SHARED_IMAGE_PATTERN =
  /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;

function isMarkdownCharacterEscaped(content: string, index: number): boolean {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && content[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function findClosingMarkdownBracket(
  content: string,
  openIndex: number,
): number {
  let depth = 0;
  for (let index = openIndex; index < content.length; index += 1) {
    if (content[index] === "\\") {
      index += 1;
      continue;
    }
    if (content[index] === "[") depth += 1;
    else if (content[index] === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function skipMarkdownWhitespace(content: string, start: number): number {
  let index = start;
  while (index < content.length && /\s/.test(content[index] ?? "")) {
    index += 1;
  }
  return index;
}

function decodeMarkdownImageDestination(value: string): string {
  const destination = value.startsWith("<") ? value.slice(1, -1) : value;
  return decodeHtmlAttribute(destination).replace(/\\([\\()])/g, "$1");
}

function parseMarkdownDestination(
  content: string,
  start: number,
  endsAtClosingParenthesis: boolean,
): { end: number; rawSource: string } | null {
  if (content[start] === "<") {
    for (let index = start + 1; index < content.length; index += 1) {
      if (content[index] === "\\") index += 1;
      else if (content[index] === ">") {
        return { end: index + 1, rawSource: content.slice(start, index + 1) };
      } else if (/\s/.test(content[index] ?? "")) return null;
    }
    return null;
  }

  let depth = 0;
  let end = start;
  for (; end < content.length; end += 1) {
    const character = content[end];
    if (character === "\\") end += 1;
    else if (/\s/.test(character ?? "")) break;
    else if (character === "(") depth += 1;
    else if (character === ")") {
      if (depth === 0 && endsAtClosingParenthesis) break;
      if (depth > 0) depth -= 1;
    }
  }
  return end > start ? { end, rawSource: content.slice(start, end) } : null;
}

function parseMarkdownTitle(
  content: string,
  start: number,
): { end: number } | null {
  const opener = content[start];
  if (opener === '"' || opener === "'") {
    for (let index = start + 1; index < content.length; index += 1) {
      if (content[index] === "\\") index += 1;
      else if (content[index] === opener) return { end: index + 1 };
    }
    return null;
  }
  if (opener !== "(") return null;

  let depth = 0;
  for (let index = start; index < content.length; index += 1) {
    if (content[index] === "\\") index += 1;
    else if (content[index] === "(") depth += 1;
    else if (content[index] === ")") {
      depth -= 1;
      if (depth === 0) return { end: index + 1 };
    }
  }
  return null;
}

function markdownFenceEndAt(content: string, start: number): number | null {
  if (start > 0 && content[start - 1] !== "\n") return null;

  const openingLineEnd = content.indexOf("\n", start);
  const openingLine = content
    .slice(start, openingLineEnd === -1 ? content.length : openingLineEnd)
    .replace(/\r$/, "");
  const opener = openingLine.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!opener) return null;

  const marker = opener[1][0];
  const markerLength = opener[1].length;
  const closingFence = new RegExp(`^ {0,3}${marker}{${markerLength},}[ \\t]*$`);
  let lineStart = openingLineEnd === -1 ? content.length : openingLineEnd + 1;
  while (lineStart < content.length) {
    const lineEnd = content.indexOf("\n", lineStart);
    const line = content
      .slice(lineStart, lineEnd === -1 ? content.length : lineEnd)
      .replace(/\r$/, "");
    if (closingFence.test(line)) {
      return lineEnd === -1 ? content.length : lineEnd + 1;
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }
  return content.length;
}

function markdownInlineCodeEndAt(
  content: string,
  start: number,
): number | null {
  if (content[start] !== "`" || isMarkdownCharacterEscaped(content, start)) {
    return null;
  }

  let delimiterLength = 1;
  while (content[start + delimiterLength] === "`") delimiterLength += 1;
  const delimiter = "`".repeat(delimiterLength);
  for (let end = start + delimiterLength; end < content.length; end += 1) {
    if (!content.startsWith(delimiter, end)) continue;
    if (content[end - 1] === "`" || content[end + delimiterLength] === "`") {
      continue;
    }
    return end + delimiterLength;
  }
  return null;
}

interface MarkdownSourceRange {
  end: number;
  start: number;
}

function markdownNonRenderedRanges(content: string): MarkdownSourceRange[] {
  const ranges: MarkdownSourceRange[] = [];
  let start = 0;
  while (start < content.length) {
    const end =
      markdownFenceEndAt(content, start) ??
      markdownInlineCodeEndAt(content, start);
    if (end === null || end <= start) {
      start += 1;
      continue;
    }
    ranges.push({ end, start });
    start = end;
  }
  return ranges;
}

function normalizeMarkdownReferenceLabel(value: string): string {
  return value
    .replace(/\\([\\[\]])/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function markdownReferenceDefinitions(content: string): Map<string, string> {
  const definitions = new Map<string, string>();
  const nonRenderedRanges = markdownNonRenderedRanges(content);
  let rangeIndex = 0;
  let lineStart = 0;
  while (lineStart < content.length) {
    while (
      rangeIndex < nonRenderedRanges.length &&
      lineStart >= nonRenderedRanges[rangeIndex].end
    ) {
      rangeIndex += 1;
    }
    const range = nonRenderedRanges[rangeIndex];
    if (range && lineStart >= range.start && lineStart < range.end) {
      lineStart = range.end;
      continue;
    }
    const newline = content.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? content.length : newline;
    const line = content.slice(lineStart, lineEnd).replace(/\r$/, "");
    let cursor = 0;
    while (cursor < 3 && line[cursor] === " ") cursor += 1;
    const labelStart = cursor;
    if (line[labelStart] === "[") {
      const labelEnd = findClosingMarkdownBracket(line, labelStart);
      if (labelEnd !== -1 && line[labelEnd + 1] === ":") {
        cursor = skipMarkdownWhitespace(line, labelEnd + 2);
        const destination = parseMarkdownDestination(line, cursor, false);
        if (destination) {
          cursor = skipMarkdownWhitespace(line, destination.end);
          const title = parseMarkdownTitle(line, cursor);
          if (title) cursor = skipMarkdownWhitespace(line, title.end);
          if (cursor === line.length) {
            const label = normalizeMarkdownReferenceLabel(
              line.slice(labelStart + 1, labelEnd),
            );
            if (label && !definitions.has(label)) {
              definitions.set(
                label,
                decodeMarkdownImageDestination(destination.rawSource),
              );
            }
          }
        }
      }
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return definitions;
}

function markdownImageSources(content: string): string[] {
  const definitions = markdownReferenceDefinitions(content);
  const nonRenderedRanges = markdownNonRenderedRanges(content);
  const sources: string[] = [];
  let rangeIndex = 0;
  for (let start = 0; start < content.length - 1; start += 1) {
    while (
      rangeIndex < nonRenderedRanges.length &&
      start >= nonRenderedRanges[rangeIndex].end
    ) {
      rangeIndex += 1;
    }
    const range = nonRenderedRanges[rangeIndex];
    if (range && start >= range.start && start < range.end) {
      start = range.end - 1;
      continue;
    }
    if (
      content[start] !== "!" ||
      content[start + 1] !== "[" ||
      isMarkdownCharacterEscaped(content, start)
    ) {
      continue;
    }
    const altEnd = findClosingMarkdownBracket(content, start + 1);
    if (altEnd === -1) continue;
    const alt = content.slice(start + 2, altEnd);
    let end = altEnd + 1;
    let source: string | undefined;
    if (content[end] === "(") {
      const destination = parseMarkdownDestination(content, end + 1, true);
      if (!destination) continue;
      let cursor = skipMarkdownWhitespace(content, destination.end);
      const title = parseMarkdownTitle(content, cursor);
      if (title) cursor = skipMarkdownWhitespace(content, title.end);
      if (content[cursor] !== ")") continue;
      end = cursor + 1;
      source = decodeMarkdownImageDestination(destination.rawSource);
    } else {
      let label = alt;
      if (content[end] === "[") {
        const labelEnd = findClosingMarkdownBracket(content, end);
        if (labelEnd === -1) continue;
        label = content.slice(end + 1, labelEnd) || alt;
        end = labelEnd + 1;
      }
      source = definitions.get(normalizeMarkdownReferenceLabel(label));
      if (!source && end !== altEnd + 1) continue;
    }
    if (source) sources.push(source);
    start = end - 1;
  }
  return sources;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&#([0-9]+);/g, (match, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    })
    .trim();
}

function normalizeImageUrl(value: string): string {
  const decoded = decodeHtmlAttribute(value);
  try {
    return new URL(decoded).href;
  } catch {
    return decoded;
  }
}

export function sharedDeckContainsImage(
  slidesJson: string,
  requestedUrl: string,
): boolean {
  let slides: unknown;
  try {
    slides = JSON.parse(slidesJson);
  } catch {
    // coercion-ok: malformed persisted share snapshots cannot authorize proxy access.
    return false;
  }
  if (!Array.isArray(slides)) return false;

  const requested = normalizeImageUrl(requestedUrl);
  return slides.some((slide) => {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
      return false;
    }
    const content = (slide as { content?: unknown }).content;
    if (typeof content !== "string") return false;
    for (const match of content.matchAll(SHARED_IMAGE_PATTERN)) {
      const source = match[1] ?? match[2];
      if (source && normalizeImageUrl(source) === requested) return true;
    }
    if (
      markdownImageSources(content).some(
        (source) => normalizeImageUrl(source) === requested,
      )
    ) {
      return true;
    }
    return false;
  });
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const shareToken = query.shareToken;
  const raw = query.url;
  let publicShare = false;
  if (typeof shareToken === "string" && shareToken) {
    const [shared] = await getDb()
      .select({
        createdAt: schema.deckShareLinks.createdAt,
        slides: schema.deckShareLinks.slides,
      })
      .from(schema.deckShareLinks)
      .where(eq(schema.deckShareLinks.token, shareToken))
      .limit(1);
    const isLive =
      Boolean(shared) &&
      Date.now() - new Date(shared.createdAt).getTime() <=
        30 * 24 * 60 * 60 * 1000;
    if (!shared || !isLive || typeof raw !== "string") {
      setResponseStatus(event, 404);
      return { error: "Shared presentation not found or has expired" };
    }
    if (!sharedDeckContainsImage(shared.slides, raw)) {
      setResponseStatus(event, 404);
      return { error: "Image is not part of the shared presentation" };
    }
    publicShare = true;
  } else {
    const session = await getSession(event);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Unauthorized" };
    }
  }

  if (typeof raw !== "string") {
    setResponseStatus(event, 400);
    return { error: "Missing url" };
  }

  const result = await fetchRemoteImage(raw);
  if (!result.ok) {
    setResponseStatus(event, FAILURE_STATUS[result.reason]);
    return { error: FAILURE_MESSAGE[result.reason] };
  }

  event.node?.res?.setHeader("Content-Type", result.contentType);
  event.node?.res?.setHeader("Content-Length", String(result.body.byteLength));
  event.node?.res?.setHeader(
    "Cache-Control",
    publicShare ? "private, no-store" : "private, max-age=3600",
  );
  // The canvas reads these pixels back, so the response must be explicitly
  // usable cross-origin even though it is served from our own host.
  event.node?.res?.setHeader("Access-Control-Allow-Origin", "*");
  return result.body;
});
