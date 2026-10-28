import {
  buildCodeLayerProjection,
  codeLayerNodeWithStableSourceId,
  resolveCodeLayerTarget,
  type CodeLayerProjection,
  type CodeLayerSource,
  type EditIntentTarget,
  type CodeLayerNode,
} from "@shared/code-layer";
import { gamutOf, parseWideColor } from "@shared/color-spaces";
import {
  isWideGamutNotation,
  normalizeCssColor,
  parseCssColor,
  parseCssColorExtended,
  rgbaToHex,
} from "@shared/color-utils";
import { commonPrefixLength, commonSuffixLength } from "@shared/string-diff";

import type { SubtreeColorStylesRead } from "../multi-screen/read-portable-style-snapshot";
import type { ElementInfo } from "../types";

export interface DocumentColorSourceFile {
  id: string;
  content: string;
}

// oklch() and color(display-p3|srgb ...) are matched only when they hold no
// nested parentheses, so a relative color or var() is never cut in half.
const CSS_COLOR_TOKEN_PATTERN =
  /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|(?:rgb|hsl)a?\([^)]*\)|\boklch\([^()]*\)|\bcolor\(\s*(?:display-p3|srgb)\s[^()]*\)/gi;

interface ColorTokenSpan {
  value: string;
  start: number;
  end: number;
  property: string;
  inStyleBlock: boolean;
}

interface SourceRange {
  start: number;
  end: number;
}

interface DeclarationValueSpan {
  property: string;
  value: string;
  start: number;
}

const SVG_PRESENTATION_COLOR_ATTRIBUTES = new Set([
  "color",
  "fill",
  "flood-color",
  "lighting-color",
  "solid-color",
  "stop-color",
  "stroke",
]);

function maskSourceRanges(
  content: string,
  ranges: readonly SourceRange[],
): string {
  let masked = "";
  let cursor = 0;
  for (const { start, end } of ranges) {
    masked +=
      content.slice(cursor, start) +
      content.slice(start, end).replace(/[^\r\n]/g, " ");
    cursor = end;
  }
  return masked + content.slice(cursor);
}

function maskCssComments(css: string): string {
  if (!css.includes("/*")) return css;
  const comments: SourceRange[] = [];
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character !== "/" || css[index + 1] !== "*") continue;
    const end = css.indexOf("*/", index + 2);
    const commentEnd = end < 0 ? css.length : end + 2;
    comments.push({ start: index, end: commentEnd });
    index = commentEnd - 1;
  }
  return maskSourceRanges(css, comments);
}

interface HtmlTagSpan {
  start: number;
  value: string;
}

interface HtmlAttributeSpan {
  name: string;
  value: string;
  valueStart: number;
}

interface StyleBlockSpan {
  start: number;
  value: string;
  closeEnd: number;
}

function htmlStartTagName(tag: string): string | null {
  const match = tag.match(/^<\s*([A-Za-z][\w:-]*)/i);
  if (!match) return null;
  const delimiter = tag[match[0].length];
  if (delimiter && !/[\s/>]/.test(delimiter)) return null;
  return match[1].toLowerCase();
}

function rawTextClosingTag(tagName: string): RegExp {
  return new RegExp(`</${tagName}(?=[\\s/>])[^>]*>`, "gi");
}

function htmlTagSpans(content: string): {
  tags: HtmlTagSpan[];
  unterminatedStart: number;
} {
  const tags: HtmlTagSpan[] = [];
  let start = -1;
  let quote: string | null = null;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (start < 0) {
      if (character === "<" && /[A-Za-z!?/]/.test(content[index + 1] ?? "")) {
        start = index;
      }
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") {
      tags.push({ start, value: content.slice(start, index + 1) });
      start = -1;
    }
  }
  return { tags, unterminatedStart: start };
}

function htmlAttributeSpans(tag: string, offset: number): HtmlAttributeSpan[] {
  const attributes: HtmlAttributeSpan[] = [];
  let cursor = tag.indexOf("<") + 1;
  if (tag[cursor] === "/") cursor += 1;
  while (/[\w:-]/.test(tag[cursor] ?? "")) cursor += 1;

  while (cursor < tag.length) {
    while (/\s|\//.test(tag[cursor] ?? "")) cursor += 1;
    if (!tag[cursor] || tag[cursor] === ">") break;

    const nameStart = cursor;
    while (!/[\s=/>]/.test(tag[cursor] ?? "")) cursor += 1;
    const name = tag.slice(nameStart, cursor).toLowerCase();
    if (!name) {
      cursor += 1;
      continue;
    }
    while (/\s/.test(tag[cursor] ?? "")) cursor += 1;
    if (tag[cursor] !== "=") continue;

    cursor += 1;
    while (/\s/.test(tag[cursor] ?? "")) cursor += 1;
    const quote = tag[cursor] === '"' || tag[cursor] === "'" ? tag[cursor] : "";
    if (quote) cursor += 1;
    const valueStart = cursor;
    if (quote) {
      while (cursor < tag.length && tag[cursor] !== quote) cursor += 1;
    } else {
      while (cursor < tag.length && !/[\s>]/.test(tag[cursor] ?? ""))
        cursor += 1;
    }
    attributes.push({
      name,
      value: tag.slice(valueStart, cursor),
      valueStart: offset + valueStart,
    });
    if (quote && tag[cursor] === quote) cursor += 1;
  }
  return attributes;
}

function styleBlockSpans(
  content: string,
  tags: HtmlTagSpan[],
): StyleBlockSpan[] {
  const blocks: StyleBlockSpan[] = [];
  const closingTag = rawTextClosingTag("style");
  let tagIndex = 0;
  let searchStart = 0;
  while (tagIndex < tags.length) {
    const openingTag = tags[tagIndex];
    tagIndex += 1;
    if (openingTag.start < searchStart) continue;
    if (htmlStartTagName(openingTag.value) !== "style") continue;

    const openingEnd = openingTag.start + openingTag.value.length;
    closingTag.lastIndex = openingEnd;
    const closingMatch = closingTag.exec(content);
    if (!closingMatch) break;
    searchStart = closingMatch.index + closingMatch[0].length;
    blocks.push({
      start: openingEnd,
      value: content.slice(openingEnd, closingMatch.index),
      closeEnd: searchStart,
    });
    while (tagIndex < tags.length && tags[tagIndex].start < searchStart) {
      tagIndex += 1;
    }
  }
  return blocks;
}

function htmlTagEnd(content: string, start: number): number {
  let quote: string | null = null;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index + 1;
  }
  return -1;
}

function maskNonRenderedHtml(content: string): {
  masked: string;
  ranges: SourceRange[];
} {
  const ranges: SourceRange[] = [];
  const maskRange = (start: number, end: number) => {
    ranges.push({ start, end });
  };

  let cursor = 0;
  while (cursor < content.length) {
    const start = content.indexOf("<", cursor);
    if (start < 0) break;
    if (content.startsWith("<!--", start)) {
      const commentEnd = /--!?>/g;
      commentEnd.lastIndex = start + 4;
      const closing = commentEnd.exec(content);
      const end = closing ? closing.index + closing[0].length : content.length;
      maskRange(start, end);
      cursor = end;
      continue;
    }
    if (!/[A-Za-z!?/]/.test(content[start + 1] ?? "")) {
      cursor = start + 1;
      continue;
    }
    const end = htmlTagEnd(content, start);
    if (end < 0) break;
    const tag = content.slice(start, end);
    const tagName = htmlStartTagName(tag);
    if (!tagName) {
      cursor = end;
      continue;
    }
    if (tagName !== "script" && tagName !== "noscript" && tagName !== "style") {
      cursor = end;
      continue;
    }

    const closingTag = rawTextClosingTag(tagName);
    closingTag.lastIndex = end;
    const closing = closingTag.exec(content);
    if (!closing) {
      maskRange(start, content.length);
      break;
    }
    const closingEnd = closing.index + closing[0].length;
    if (tagName !== "style") maskRange(start, closingEnd);
    cursor = closingEnd;
  }
  return { masked: maskSourceRanges(content, ranges), ranges };
}

function cssPropertyName(property: string): string {
  return property
    .replace(/^\s*\/\*[\s\S]*?\*\//g, "")
    .trim()
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .toLowerCase();
}

function isColorDeclaration(property: string): boolean {
  const normalized = cssPropertyName(property);
  if (normalized.startsWith("--")) return true;
  return (
    COLOR_STYLE_PROPERTIES.has(normalized) ||
    /^border-(?:(?:top|right|bottom|left)(?:-color)?|(?:inline|block)(?:-(?:start|end))?(?:-color)?)$/.test(
      normalized,
    ) ||
    /^-webkit-text-stroke(?:-color)?$/.test(normalized)
  );
}

function topLevelColon(value: string): number {
  let quote: string | null = null;
  let escaped = false;
  let parentheses = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      parentheses += 1;
      continue;
    }
    if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
      continue;
    }
    if (character === ":" && parentheses === 0) return index;
  }
  return -1;
}

function declarationValueSpans(
  css: string,
  offset = 0,
): DeclarationValueSpan[] {
  const declarations: DeclarationValueSpan[] = [];
  let segmentStart = 0;
  let quote: string | null = null;
  let escaped = false;
  let parentheses = 0;

  const addSegment = (segmentEnd: number) => {
    const segment = css.slice(segmentStart, segmentEnd);
    const colon = topLevelColon(segment);
    if (colon < 0 || !isColorDeclaration(segment.slice(0, colon))) return;
    const rawValueStart = segmentStart + colon + 1;
    const value = css.slice(rawValueStart, segmentEnd);
    const leadingWhitespace = value.search(/\S|$/);
    const trimmed = value.trim();
    if (!trimmed) return;
    declarations.push({
      property: cssPropertyName(segment.slice(0, colon)),
      value: trimmed,
      start: offset + rawValueStart + leadingWhitespace,
    });
  };

  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      parentheses += 1;
      continue;
    }
    if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
      continue;
    }
    if (parentheses > 0) continue;
    if (character === ";" || character === "{" || character === "}") {
      addSegment(index);
      segmentStart = index + 1;
    }
  }
  addSegment(css.length);
  return declarations;
}

function readCssIdentifier(
  value: string,
  start: number,
  limit: number,
): { end: number; name: string } | null {
  let cursor = start;
  let name = "";
  while (cursor < limit) {
    const character = value[cursor];
    if (/[A-Za-z0-9_-]/.test(character)) {
      name += character;
      cursor += 1;
      continue;
    }
    if (character !== "\\") break;

    cursor += 1;
    if (cursor >= limit) break;
    const escapeStart = cursor;
    while (
      cursor < limit &&
      cursor - escapeStart < 6 &&
      /[0-9a-f]/i.test(value[cursor])
    ) {
      cursor += 1;
    }
    if (cursor > escapeStart) {
      const codePoint = parseInt(value.slice(escapeStart, cursor), 16);
      name +=
        codePoint === 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
          ? "\uFFFD"
          : String.fromCodePoint(codePoint);
      if (/\s/.test(value[cursor] ?? "")) {
        if (value[cursor] === "\r" && value[cursor + 1] === "\n") {
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
    } else if (
      value[cursor] === "\r" ||
      value[cursor] === "\n" ||
      value[cursor] === "\f"
    ) {
      if (value[cursor] === "\r" && value[cursor + 1] === "\n") {
        cursor += 2;
      } else {
        cursor += 1;
      }
    } else {
      name += value[cursor];
      cursor += 1;
    }
  }
  return name ? { end: cursor, name: name.toLowerCase() } : null;
}

function isInsideExcludedColorFunction(value: string, index: number): boolean {
  const functions: string[] = [];
  let quote: string | null = null;
  let escaped = false;
  for (let cursor = 0; cursor < index; ) {
    const character = value[cursor];
    if (escaped) {
      escaped = false;
      cursor += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      if (character === "\\") escaped = true;
      cursor += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      cursor += 1;
      continue;
    }
    if (/[A-Za-z_\\-]/.test(character)) {
      const identifier = readCssIdentifier(value, cursor, index);
      if (identifier) {
        if (value[identifier.end] === "(") {
          functions.push(identifier.name);
          cursor = identifier.end + 1;
          continue;
        }
        cursor = identifier.end;
        continue;
      }
    }
    if (character === "\\") {
      escaped = true;
      cursor += 1;
      continue;
    }
    if (character === "(") {
      functions.push("");
      cursor += 1;
      continue;
    }
    if (character === ")") functions.pop();
    cursor += 1;
  }
  return functions.some((name) => name === "url" || name === "var");
}

function colorTokenSpansInCss(
  css: string,
  offset: number,
  inStyleBlock: boolean,
): ColorTokenSpan[] {
  const tokens: ColorTokenSpan[] = [];
  const maskedCss = maskCssComments(css);
  declarationValueSpans(maskedCss, offset).forEach(
    ({ property, value, start }) => {
      tokens.push(
        ...colorTokenSpansInValue(value, start, property, inStyleBlock),
      );
    },
  );
  return tokens;
}

function colorTokenSpansInValue(
  value: string,
  offset: number,
  property: string,
  inStyleBlock: boolean,
): ColorTokenSpan[] {
  const tokens: ColorTokenSpan[] = [];
  const matcher = new RegExp(CSS_COLOR_TOKEN_PATTERN.source, "gi");
  for (const match of value.matchAll(matcher)) {
    const token = match[0];
    const relativeStart = match.index ?? 0;
    if (isInsideExcludedColorFunction(value, relativeStart)) continue;
    tokens.push({
      value: token,
      start: offset + relativeStart,
      end: offset + relativeStart + token.length,
      property,
      inStyleBlock,
    });
  }
  return tokens;
}

function tagColorTokens(
  tagOffset: number,
  tag: string,
  svgDepth: number,
): { tokens: ColorTokenSpan[]; svgDepth: number } {
  const tokens: ColorTokenSpan[] = [];
  if (/^<\/?(?:script|noscript|style)\b/i.test(tag)) {
    return { tokens, svgDepth };
  }
  const tagName = htmlStartTagName(tag);
  const closesSvg = /^<\/\s*svg\b/i.test(tag);
  const opensSvg = tagName === "svg" && !closesSvg;
  const insideSvg = svgDepth > 0 || opensSvg;
  let nextSvgDepth = svgDepth;
  if (opensSvg && !/\/\s*>$/.test(tag)) nextSvgDepth += 1;
  if (tagName && !closesSvg) {
    const attributes = htmlAttributeSpans(tag, tagOffset);
    const styledProperties = new Set<string>();
    for (const attribute of attributes) {
      if (attribute.name !== "style") continue;
      declarationValueSpans(maskCssComments(attribute.value)).forEach(
        ({ property }) => styledProperties.add(property),
      );
    }
    for (const attribute of attributes) {
      if (attribute.name === "style") {
        tokens.push(
          ...colorTokenSpansInCss(attribute.value, attribute.valueStart, false),
        );
      } else if (
        insideSvg &&
        SVG_PRESENTATION_COLOR_ATTRIBUTES.has(attribute.name) &&
        !styledProperties.has(attribute.name)
      ) {
        tokens.push(
          ...colorTokenSpansInValue(
            attribute.value,
            attribute.valueStart,
            attribute.name,
            false,
          ),
        );
      }
    }
  }
  if (closesSvg) nextSvgDepth = Math.max(0, nextSvgDepth - 1);
  return { tokens, svgDepth: nextSvgDepth };
}

interface ColorTokenScan {
  tokens: ColorTokenSpan[];
  tags: Array<SourceRange & { svgDepth: number }>;
  maskedRanges: SourceRange[];
  styleBlocks: SourceRange[];
  unterminatedTagStart: number;
  patchable: boolean;
}

function scanColorTokens(content: string): ColorTokenScan {
  colorTokenScanCounts.full += 1;
  const { masked, ranges: maskedRanges } = maskNonRenderedHtml(content);
  const { tags: tagSpans, unterminatedStart } = htmlTagSpans(masked);
  const tokens: ColorTokenSpan[] = [];
  const tags: ColorTokenScan["tags"] = [];
  let svgDepth = 0;
  for (const { start, value } of tagSpans) {
    tags.push({ start, end: start + value.length, svgDepth });
    const read = tagColorTokens(start, value, svgDepth);
    tokens.push(...read.tokens);
    svgDepth = read.svgDepth;
  }
  const blocks = styleBlockSpans(masked, tagSpans);
  for (const block of blocks) {
    tokens.push(...colorTokenSpansInCss(block.value, block.start, true));
  }
  tokens.sort((left, right) => left.start - right.start);
  return {
    tokens,
    tags,
    maskedRanges,
    styleBlocks: blocks.map((block) => ({
      start: block.start,
      end: block.start + block.value.length,
    })),
    unterminatedTagStart: unterminatedStart,
    // Patching assumes the tag scan and the masking pass step over the same
    // tags; markup-like CSS text inside a style block breaks that.
    patchable: blocks.every((block) => {
      const closing = tags[firstSpanAtOrAfter(tags, block.start)];
      return (
        closing?.start === block.start + block.value.length &&
        closing.end === block.closeEnd
      );
    }),
  };
}

function firstSpanAtOrAfter(spans: SourceRange[], offset: number): number {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (spans[middle]!.start < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

// Rescans only the tag, text run, or style block one edit touched; null means
// the edit could change how the rest of the document tokenizes.
function patchColorTokenScan(
  before: string,
  content: string,
): ColorTokenScan | null {
  const base = colorTokenScans.get(before);
  if (!base?.patchable) return null;
  const start = commonPrefixLength(before, content);
  const suffix = commonSuffixLength(
    before,
    content,
    Math.min(before.length, content.length) - start,
  );
  const removedEnd = before.length - suffix;
  const delta = content.length - before.length;
  if (
    before.slice(start, removedEnd).includes("<") ||
    content.slice(start, content.length - suffix).includes("<") ||
    before[start - 1] === "<" ||
    (base.unterminatedTagStart >= 0 && base.unterminatedTagStart < start) ||
    base.maskedRanges.some(
      (range) => range.start < removedEnd && start < range.end,
    )
  ) {
    return null;
  }

  const block = base.styleBlocks.find(
    (candidate) => candidate.start <= start && start <= candidate.end,
  );
  const tag = base.tags[firstSpanAtOrAfter(base.tags, start) - 1];
  let region: SourceRange = { start, end: removedEnd };
  let regionTokens: ColorTokenSpan[] = [];
  let regionTags: ColorTokenScan["tags"] = [];
  let styleBlocks = base.styleBlocks;
  if (block) {
    region = block;
    regionTokens = colorTokenSpansInCss(
      content.slice(block.start, block.end + delta),
      block.start,
      true,
    );
    styleBlocks = styleBlocks.map((candidate) =>
      candidate === block ? { ...block, end: block.end + delta } : candidate,
    );
  } else if (tag && tag.end > start) {
    const previousTag = before.slice(tag.start, tag.end);
    const tagName = htmlStartTagName(previousTag);
    const nextEnd = htmlTagEnd(content, tag.start);
    const nextTag = content.slice(tag.start, nextEnd);
    if (
      !tagName ||
      htmlStartTagName(nextTag) !== tagName ||
      removedEnd >= tag.end ||
      nextEnd !== tag.end + delta ||
      /\/\s*>$/.test(previousTag) !== /\/\s*>$/.test(nextTag)
    ) {
      return null;
    }
    region = tag;
    regionTokens = tagColorTokens(tag.start, nextTag, tag.svgDepth).tokens;
    regionTags = [{ ...tag, end: nextEnd }];
  }

  colorTokenScanCounts.patched += 1;
  const shift = <T extends SourceRange>(range: T): T =>
    delta === 0 || range.start < region.end
      ? range
      : { ...range, start: range.start + delta, end: range.end + delta };
  return {
    tokens: [
      ...base.tokens.slice(0, firstSpanAtOrAfter(base.tokens, region.start)),
      ...regionTokens,
      ...base.tokens
        .slice(firstSpanAtOrAfter(base.tokens, region.end))
        .map(shift),
    ],
    tags: [
      ...base.tags.slice(0, firstSpanAtOrAfter(base.tags, region.start)),
      ...regionTags,
      ...base.tags.slice(firstSpanAtOrAfter(base.tags, region.end)).map(shift),
    ],
    maskedRanges: base.maskedRanges.map(shift),
    styleBlocks: styleBlocks.map(shift),
    unterminatedTagStart:
      base.unterminatedTagStart >= region.end
        ? base.unterminatedTagStart + delta
        : base.unterminatedTagStart,
    patchable: true,
  };
}

// Selection colors and the palette re-read each screen on every render, and
// tokenizing a large imported screen costs hundreds of ms. Callers only read.
const COLOR_TOKEN_CACHE_MAX_CHARS = 8_000_000;
const colorTokenScans = new Map<string, ColorTokenScan>();
const colorTokenScanContentByFile = new Map<string, string>();
let colorTokenScanChars = 0;
const colorTokenScanCounts = { full: 0, patched: 0 };

export function _colorTokenScanCountsForTests(): {
  full: number;
  patched: number;
} {
  return { ...colorTokenScanCounts };
}

function colorTokenScan(content: string, fileId?: string): ColorTokenScan {
  let scan = colorTokenScans.get(content);
  if (scan) {
    colorTokenScans.delete(content);
  } else {
    const previous =
      fileId === undefined
        ? undefined
        : colorTokenScanContentByFile.get(fileId);
    scan =
      (previous === undefined
        ? null
        : patchColorTokenScan(previous, content)) ?? scanColorTokens(content);
    colorTokenScanChars += content.length;
  }
  colorTokenScans.set(content, scan);
  if (fileId !== undefined) colorTokenScanContentByFile.set(fileId, content);
  while (
    colorTokenScanChars > COLOR_TOKEN_CACHE_MAX_CHARS &&
    colorTokenScans.size > 1
  ) {
    const oldest = colorTokenScans.keys().next().value!;
    colorTokenScans.delete(oldest);
    colorTokenScanChars -= oldest.length;
    for (const [id, scanned] of colorTokenScanContentByFile) {
      if (scanned === oldest) colorTokenScanContentByFile.delete(id);
    }
  }
  return scan;
}

export type DocumentColorCountCache = Map<
  string,
  { content: string; counts: Map<string, number> }
>;

export function documentFileColorCounts(
  file: DocumentColorSourceFile,
  cache: DocumentColorCountCache,
): Map<string, number> {
  const cached = cache.get(file.id);
  if (cached?.content === file.content) return cached.counts;
  const counts = new Map<string, number>();
  for (const { value: token } of colorTokenScan(file.content, file.id).tokens) {
    const hex = documentColorHex(token);
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  cache.set(file.id, { content: file.content, counts });
  return counts;
}

const documentColorHexByToken = new Map<string, string | null>();

/**
 * A palette entry for a color token: sRGB colors as #RRGGBB, and a color
 * outside sRGB as authored, so it is never flattened into its sRGB fallback.
 */
export function paletteColorValue(value: string): string | null {
  const wide = parseWideColor(value.trim());
  if (wide?.kind === "ok" && gamutOf(wide.color.linear) !== "srgb") {
    return normalizeCssColor(value);
  }
  const parsed = parseCssColor(value);
  return parsed ? rgbaToHex(parsed) : null;
}

function documentColorHex(token: string): string | null {
  let hex = documentColorHexByToken.get(token);
  if (hex === undefined) {
    const parsed = parseCssColor(token);
    hex = parsed && parsed.a !== 0 ? paletteColorValue(token) : null;
    if (hex && !isWideGamutNotation(hex)) hex = hex.toUpperCase();
    if (documentColorHexByToken.size >= 4096) documentColorHexByToken.clear();
    documentColorHexByToken.set(token, hex);
  }
  return hex;
}

export function extractDocumentColorPalette(
  files: DocumentColorSourceFile[],
  limit = 24,
  cache: DocumentColorCountCache = new Map(),
): string[] {
  const countByHex = new Map<string, number>();
  const fileIds = new Set<string>();
  for (const file of files) {
    fileIds.add(file.id);
    if (!file.content) continue;
    for (const [hex, count] of documentFileColorCounts(file, cache)) {
      countByHex.set(hex, (countByHex.get(hex) ?? 0) + count);
    }
  }
  for (const fileId of cache.keys()) {
    if (!fileIds.has(fileId)) cache.delete(fileId);
  }
  return Array.from(countByHex.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hex]) => hex);
}

export interface SelectionColorValue {
  property: string;
  value: string;
  count?: number;
  opacity?: number;
  hidden?: boolean;
  layerIndex?: number;
}

export interface SelectionColorTarget {
  fileId: string;
  nodeId: string;
  selector: string;
  tag: string;
}

export interface SelectionColorScope {
  fileId: string;
  content: string;
  // The editor's projection of exactly `content`; an evicted build would
  // otherwise cost a full re-parse on every selection.
  projection?: CodeLayerProjection;
  source?: CodeLayerSource;
  sourceId?: string;
  selector?: string;
  wholeDocument?: boolean;
}

export interface SelectionColorRange {
  start: number;
  end: number;
}

const COLOR_STYLE_PROPERTIES = new Set([
  "color",
  "background",
  "background-color",
  "background-image",
  "border",
  "border-color",
  "outline",
  "outline-color",
  "fill",
  "stroke",
  "box-shadow",
  "text-shadow",
  "text-decoration-color",
  "-webkit-text-stroke-color",
  "accent-color",
  "caret-color",
  "column-rule",
  "column-rule-color",
  "filter",
  "flood-color",
  "lighting-color",
  "stop-color",
  "text-decoration",
]);

function cssColorTokens(value: string): string[] {
  return value.match(CSS_COLOR_TOKEN_PATTERN) ?? [];
}

function colorKey(value: string): string {
  // Two wide colors can share an sRGB fallback; they are still two colors.
  if (isWideGamutNotation(value)) {
    return (normalizeCssColor(value) ?? value).toLowerCase();
  }
  const parsed = parseCssColorExtended(value);
  return parsed
    ? rgbaToHex(parsed, true).toUpperCase()
    : value.trim().toLowerCase();
}

function isVisibleColor(value: string): boolean {
  const parsed = parseCssColor(value);
  return !parsed || parsed.a > 0;
}

function addColorValue(
  values: Map<string, SelectionColorValue>,
  property: string,
  value: string,
  increment = true,
) {
  const trimmed = value.trim();
  if (!trimmed || !isVisibleColor(trimmed)) return;
  const key = colorKey(trimmed);
  const existing = values.get(key);
  if (existing) {
    if (increment) existing.count = (existing.count ?? 1) + 1;
    return;
  }
  values.set(key, {
    property,
    value: trimmed,
  });
}

function addStyleColors(
  values: Map<string, SelectionColorValue>,
  styles: Record<string, string>,
  increment: boolean,
) {
  Object.entries(styles).forEach(([property, value]) => {
    if (!isColorDeclaration(property)) {
      return;
    }
    const tokens = cssColorTokens(value);
    if (tokens.length > 0) {
      tokens.forEach((token) =>
        addColorValue(values, property, token, increment),
      );
      return;
    }
    if (value.trim() === "Mixed") {
      addColorValue(values, property, value, increment);
    }
  });
}

function scopeNodeRange(
  scope: SelectionColorScope,
  content = scope.content,
): SelectionColorRange | null {
  if (scope.wholeDocument) {
    return { start: 0, end: content.length };
  }
  const node = resolveSelectionScopeNode(scope, content);
  const source = node?.source;
  return source ? { start: source.start, end: source.end } : null;
}

function selectionScopeTarget(scope: SelectionColorScope): EditIntentTarget {
  return {
    ...(scope.sourceId ? { nodeId: scope.sourceId } : {}),
    ...(scope.selector ? { selector: scope.selector } : {}),
  };
}

function resolveSelectionScope(scope: SelectionColorScope): {
  projection: ReturnType<typeof buildCodeLayerProjection>;
  node: CodeLayerNode | null;
} {
  const known =
    scope.projection && scope.sourceId
      ? codeLayerNodeWithStableSourceId(scope.projection, scope.sourceId)
      : null;
  if (known) return { projection: scope.projection!, node: known };
  const { projection, resolution } = resolveCodeLayerTarget(
    scope.content,
    selectionScopeTarget(scope),
    { source: scope.source },
  );
  return {
    projection,
    node: resolution.status === "resolved" ? (resolution.node ?? null) : null,
  };
}

function resolveSelectionScopeNode(
  scope: SelectionColorScope,
  content = scope.content,
): CodeLayerNode | null {
  return resolveSelectionScope(
    content === scope.content
      ? scope
      : { ...scope, content, projection: undefined },
  ).node;
}

function mergedScopeRanges(
  scopes: SelectionColorScope[],
  requireEveryScope = false,
  content?: string,
): SelectionColorRange[] | null {
  const resolvedRanges = scopes.map((scope) => scopeNodeRange(scope, content));
  if (requireEveryScope && resolvedRanges.some((range) => range === null)) {
    return null;
  }
  const ranges = resolvedRanges
    .filter((range): range is SelectionColorRange => range !== null)
    .sort((left, right) => left.start - right.start);
  return mergeSelectionColorRanges(ranges);
}

function mergeSelectionColorRanges(
  ranges: SelectionColorRange[],
): SelectionColorRange[] {
  const merged: SelectionColorRange[] = [];
  [...ranges]
    .sort((left, right) => left.start - right.start)
    .forEach((range) => {
      const previous = merged[merged.length - 1];
      if (!previous || range.start > previous.end) {
        merged.push({ ...range });
      } else {
        previous.end = Math.max(previous.end, range.end);
      }
    });
  return merged;
}

function colorTokenSpansWithinRanges(
  scan: ColorTokenScan,
  ranges: SelectionColorRange[],
  include: (token: ColorTokenSpan) => boolean,
): ColorTokenSpan[] {
  const within: ColorTokenSpan[] = [];
  for (const range of mergeSelectionColorRanges(ranges)) {
    for (
      let index = firstSpanAtOrAfter(scan.tokens, range.start);
      index < scan.tokens.length;
      index += 1
    ) {
      const token = scan.tokens[index]!;
      if (token.start >= range.end) break;
      if (token.end <= range.end && include(token)) within.push(token);
    }
  }
  return within;
}

export function selectionColorScopeRanges(
  scopes: SelectionColorScope[],
): Map<string, SelectionColorRange[]> {
  const byFile = new Map<string, SelectionColorScope[]>();
  scopes.forEach((scope) => {
    byFile.set(scope.fileId, [...(byFile.get(scope.fileId) ?? []), scope]);
  });
  return new Map(
    Array.from(byFile, ([fileId, fileScopes]) => [
      fileId,
      mergedScopeRanges(fileScopes) ?? [],
    ]),
  );
}

export function replaceSelectionColorsInHtml(
  content: string,
  scopes: SelectionColorScope[],
  from: string,
  to: string,
): string | null {
  const target = colorKey(from);
  const ranges = mergedScopeRanges(scopes, true, content);
  if (!ranges || ranges.length === 0) return null;
  let next = content;
  const tokens = colorTokenSpansWithinRanges(
    colorTokenScan(content, scopes[0]?.fileId),
    ranges,
    () => true,
  ).filter(({ value }) => colorKey(value) === target);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!token) continue;
    next = `${next.slice(0, token.start)}${to}${next.slice(token.end)}`;
  }
  return next;
}

export function selectionColorValues(
  element: ElementInfo | ElementInfo[],
  scopes: SelectionColorScope[] = [],
  readSubtreeColorStyles?: (element: ElementInfo) => SubtreeColorStylesRead,
): SelectionColorValue[] {
  const elements = Array.isArray(element) ? element : [element];
  const values = new Map<string, SelectionColorValue>();

  const scanGroups = new Map<
    string,
    Array<{ content: string; ranges: SelectionColorRange[] }>
  >();
  for (const scope of scopes) {
    const range = scopeNodeRange(scope);
    if (!range) continue;
    const groups = scanGroups.get(scope.fileId) ?? [];
    const group = groups.find(
      (candidate) => candidate.content === scope.content,
    );
    if (group) group.ranges.push(range);
    else groups.push({ content: scope.content, ranges: [range] });
    scanGroups.set(scope.fileId, groups);
  }
  for (const [fileId, groups] of scanGroups) {
    for (const group of groups) {
      for (const { value: token } of colorTokenSpansWithinRanges(
        colorTokenScan(group.content, fileId),
        group.ranges,
        (token) => !token.inStyleBlock,
      )) {
        addColorValue(values, "color", token);
      }
    }
  }

  for (const current of elements) {
    if (scopes.length === 0) {
      addStyleColors(values, current.computedStyles, true);
      current.portableStyleSnapshot?.nodes.forEach((node) =>
        addStyleColors(values, node.styles, true),
      );
      const subtree =
        current.styleSnapshotReadOnDemand && readSubtreeColorStyles
          ? readSubtreeColorStyles(current)
          : undefined;
      if (subtree?.status === "captured" || subtree?.status === "truncated") {
        subtree.nodes.forEach((styles) => addStyleColors(values, styles, true));
      } else if (subtree?.status === "failed") {
        console.warn(
          "Could not read the colors under the selection",
          current.selector,
        );
      }
      if (current.htmlContent) {
        scanColorTokens(current.htmlContent).tokens.forEach(
          ({ value: token }) => addColorValue(values, "color", token),
        );
      }
    }
  }

  return Array.from(values.values());
}

function selectionColorNodesForScope(
  scope: SelectionColorScope,
): CodeLayerNode[] {
  const { projection, node: root } = scope.wholeDocument
    ? {
        projection:
          scope.projection ??
          buildCodeLayerProjection(scope.content, {
            source: scope.source,
          }),
        node: null,
      }
    : resolveSelectionScope(scope);
  if (scope.wholeDocument) return projection.nodes;
  if (!root) return [];

  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  const selected: CodeLayerNode[] = [];
  const visit = (node: CodeLayerNode) => {
    selected.push(node);
    node.children.forEach((childId) => {
      const child = nodesById.get(childId);
      if (child) visit(child);
    });
  };
  visit(root);
  return selected;
}

export function selectionColorTargets(
  scopes: SelectionColorScope[],
  color: string,
): SelectionColorTarget[] {
  const target = colorKey(color);
  const targets: SelectionColorTarget[] = [];
  const seen = new Set<string>();
  for (const scope of scopes) {
    for (const node of selectionColorNodesForScope(scope)) {
      const source = node.source;
      if (!source) continue;
      const openingTag = scope.content.slice(source.openStart, source.openEnd);
      const matches = scanColorTokens(openingTag).tokens.some(
        ({ value }) => colorKey(value) === target,
      );
      if (!matches) continue;
      const key = `${scope.fileId}:${node.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        fileId: scope.fileId,
        nodeId: node.id,
        selector: node.selector,
        tag: node.tag,
      });
    }
  }
  return targets;
}
