import {
  applyVisualEdit,
  buildCodeLayerProjection,
  resolveCodeLayerTarget,
  type CodeLayerSource,
  type EditIntentTarget,
  type CodeLayerNode,
  wrapBareTextLeavesInHtml,
} from "@shared/code-layer";
import { parseCssColor, rgbaToCss, rgbaToHex } from "@shared/color-utils";
import {
  gradientStopWithFillOpacity,
  readGradientFillOpacity,
} from "@shared/gradient-opacity";

import type { ElementInfo } from "../types";
import {
  buildSolidFillLayer,
  joinCssLayers,
  isLayerHiddenBySize,
  parseGradientLayer,
  parseSolidFillLayer,
  splitCssLayers,
} from "./fill-gradient-helpers";

export interface DocumentColorSourceFile {
  id: string;
  content: string;
}

const CSS_COLOR_TOKEN_PATTERN =
  /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|(?:rgb|hsl)a?\([^)]*\)/gi;

interface ColorTokenSpan {
  value: string;
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

function maskCssComments(css: string): string {
  const masked = css.split("");
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
    for (
      let commentIndex = index;
      commentIndex < commentEnd;
      commentIndex += 1
    ) {
      if (css[commentIndex] !== "\r" && css[commentIndex] !== "\n") {
        masked[commentIndex] = " ";
      }
    }
    index = commentEnd - 1;
  }
  return masked.join("");
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

function htmlTagSpans(content: string): HtmlTagSpan[] {
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
  return tags;
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

function styleBlockSpans(content: string): StyleBlockSpan[] {
  const blocks: StyleBlockSpan[] = [];
  const tags = htmlTagSpans(content);
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
    blocks.push({
      start: openingEnd,
      value: content.slice(openingEnd, closingMatch.index),
    });
    searchStart = closingMatch.index + closingMatch[0].length;
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

function maskNonRenderedHtml(content: string): string {
  const masked = content.split("");
  const maskRange = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      if (content[index] !== "\r" && content[index] !== "\n") {
        masked[index] = " ";
      }
    }
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
  return masked.join("");
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
  offset = 0,
  properties?: ReadonlySet<string>,
): ColorTokenSpan[] {
  const tokens: ColorTokenSpan[] = [];
  const maskedCss = maskCssComments(css);
  declarationValueSpans(maskedCss, offset).forEach(
    ({ property, value, start }) => {
      if (properties && !properties.has(property)) return;
      tokens.push(...colorTokenSpansInValue(value, start));
    },
  );
  return tokens;
}

function colorTokenSpansInValue(value: string, offset = 0): ColorTokenSpan[] {
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
    });
  }
  return tokens;
}

function colorTokenSpansInHtml(
  content: string,
  properties?: ReadonlySet<string>,
  options: { includeStyleBlocks?: boolean } = {},
): ColorTokenSpan[] {
  const maskedContent = maskNonRenderedHtml(content);
  const styleBlocks = styleBlockSpans(maskedContent);
  const tokens: ColorTokenSpan[] = [];
  let svgDepth = 0;

  for (const { start: tagOffset, value: tag } of htmlTagSpans(maskedContent)) {
    if (/^<\/?(?:script|noscript|style)\b/i.test(tag)) continue;
    const tagName = htmlStartTagName(tag);
    const closesSvg = /^<\/\s*svg\b/i.test(tag);
    const opensSvg = tagName === "svg" && !closesSvg;
    const insideSvg = svgDepth > 0 || opensSvg;
    if (opensSvg && !/\/\s*>$/.test(tag)) svgDepth += 1;
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
            ...colorTokenSpansInCss(
              attribute.value,
              attribute.valueStart,
              properties,
            ),
          );
        } else if (
          insideSvg &&
          SVG_PRESENTATION_COLOR_ATTRIBUTES.has(attribute.name) &&
          !styledProperties.has(attribute.name)
        ) {
          if (properties && !properties.has(attribute.name)) continue;
          tokens.push(
            ...colorTokenSpansInValue(attribute.value, attribute.valueStart),
          );
        }
      }
    }
    if (closesSvg) svgDepth = Math.max(0, svgDepth - 1);
  }

  if (options.includeStyleBlocks !== false) {
    for (const block of styleBlocks) {
      tokens.push(
        ...colorTokenSpansInCss(block.value, block.start, properties),
      );
    }
  }

  return tokens.sort((left, right) => left.start - right.start);
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
  for (const { value: token } of colorTokenSpansInHtml(file.content)) {
    const parsed = parseCssColor(token);
    if (!parsed) continue;
    if (parsed.a === 0) continue;
    const hex = rgbaToHex(parsed).toUpperCase();
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  cache.set(file.id, { content: file.content, counts });
  return counts;
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
  source?: CodeLayerSource;
  sourceId?: string;
  selector?: string;
  wholeDocument?: boolean;
}

export interface SelectionFillPaint {
  kind: "solid" | "gradient" | "image" | "unknown";
  value: string;
  source: string;
  property: string;
  layerIndex?: number;
  opacity?: number;
  hidden?: boolean;
  size?: string;
  repeat?: string;
  position?: string;
}

export interface SelectionFillModel {
  state: "empty" | "common" | "mixed";
  stacks: SelectionFillPaint[][];
  targets: SelectionFillTargetStack[];
  scopeConflict?: boolean;
}

export interface SelectionFillTargetStack {
  fileId: string;
  nodeId: string;
  selector: string;
  channel: "background" | "text" | "vector";
  stack: SelectionFillPaint[];
}

export interface SelectionFillStyleUpdate {
  fileId: string;
  content: string;
}

export interface SelectionFillStyleRewriteResult {
  status: "applied" | "conflict" | "unsupported";
  updates: SelectionFillStyleUpdate[];
  message?: string;
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
  const parsed = parseCssColor(value);
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
  return resolveSelectionScope({ ...scope, content }).node;
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
  content: string,
  ranges: SelectionColorRange[],
  properties?: ReadonlySet<string>,
  options: { includeStyleBlocks?: boolean } = {},
): ColorTokenSpan[] {
  const mergedRanges = mergeSelectionColorRanges(ranges);
  let rangeIndex = 0;
  return colorTokenSpansInHtml(content, properties, options).filter((token) => {
    while (
      rangeIndex < mergedRanges.length &&
      (mergedRanges[rangeIndex]?.end ?? 0) <= token.start
    ) {
      rangeIndex += 1;
    }
    const range = mergedRanges[rangeIndex];
    return !!range && token.start >= range.start && token.end <= range.end;
  });
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
  return replaceScopedColorTokensInHtml(content, scopes, from, to);
}

export function replaceSelectionFillColorsInHtml(
  content: string,
  scopes: SelectionColorScope[],
  from: string,
  to: string,
): string | null {
  return replaceScopedColorTokensInHtml(
    content,
    scopes,
    from,
    to,
    GROUP_FILL_COLOR_PROPERTIES,
  );
}

const GROUP_FILL_COLOR_PROPERTIES = new Set([
  "background",
  "background-color",
  "background-image",
  "color",
  "fill",
  "stop-color",
  "--boolean-mask-fill",
]);

function replaceScopedColorTokensInHtml(
  content: string,
  scopes: SelectionColorScope[],
  from: string,
  to: string,
  properties?: ReadonlySet<string>,
): string | null {
  const target = colorKey(from);
  const ranges = mergedScopeRanges(scopes, true, content);
  if (!ranges || ranges.length === 0) return null;
  let next = content;
  const tokens = colorTokenSpansWithinRanges(
    content,
    ranges,
    properties,
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
  for (const groups of scanGroups.values()) {
    for (const group of groups) {
      for (const { value: token } of colorTokenSpansWithinRanges(
        group.content,
        group.ranges,
        undefined,
        {
          includeStyleBlocks: false,
        },
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
      if (current.htmlContent) {
        colorTokenSpansInHtml(current.htmlContent).forEach(({ value: token }) =>
          addColorValue(values, "color", token),
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
        projection: buildCodeLayerProjection(scope.content, {
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
      const matches = colorTokenSpansInHtml(openingTag).some(
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

export function selectionFillColorValues(
  scopes: SelectionColorScope[],
): SelectionColorValue[] {
  const model = selectionFillModel(scopes);
  const commonStack = model.stacks[0];
  if (
    model.state !== "common" ||
    !commonStack ||
    commonStack.some((paint) => paint.kind !== "solid")
  ) {
    return [];
  }
  return commonStack.map((paint) => ({
    property: "fill",
    value: paint.value,
    count: model.stacks.length,
    ...(paint.opacity === undefined || paint.opacity === 100
      ? {}
      : { opacity: paint.opacity }),
    ...(paint.hidden ? { hidden: true } : {}),
  }));
}

export function selectionFillInspectorStyles(
  model: SelectionFillModel,
): Record<string, string> {
  const stack = model.stacks[0] ?? [];
  if (model.state === "mixed") {
    return { backgroundColor: "transparent", backgroundImage: "Mixed" };
  }
  if (
    stack.some((paint) => paint.kind === "unknown") ||
    stack.some((paint) => paint.kind === "image" && paint.source.trim() === "")
  ) {
    return { backgroundColor: "transparent", backgroundImage: "Mixed" };
  }

  const basePaint = stack[stack.length - 1];
  const hasSolidBase = basePaint?.kind === "solid";
  const imagePaints = hasSolidBase ? stack.slice(0, -1) : stack;
  const backgroundColor = hasSolidBase
    ? inspectorSolidPaintValue(basePaint)
    : "transparent";

  return {
    backgroundColor,
    backgroundImage: imagePaints.length
      ? joinCssLayers(
          imagePaints.map((paint) => inspectorImagePaintValue(paint)),
        )
      : "none",
    backgroundSize: imagePaints.length
      ? joinCssLayers(
          imagePaints.map((paint) =>
            paint.hidden ? "0px 0px" : (paint.size ?? "auto"),
          ),
        )
      : "auto",
    backgroundRepeat: imagePaints.length
      ? joinCssLayers(imagePaints.map((paint) => paint.repeat ?? "no-repeat"))
      : "repeat",
    backgroundPosition: imagePaints.length
      ? joinCssLayers(imagePaints.map((paint) => paint.position ?? "0% 0%"))
      : "0% 0%",
  };
}

export function selectionFillAddedStyles(
  model: SelectionFillModel,
  mostRecentFillColor?: string,
): { styles: Record<string, string>; open: "base" | "layer" } {
  const stack = model.stacks[0] ?? [];
  if (model.state === "common" && stack.length > 0) {
    // guard:allow-raw-color - Authored default overlay paint is independent of the editor theme.
    const black = parseCssColor("rgba(0, 0, 0, 0.2)");
    if (!black) throw new Error("The default fill color is invalid.");
    const newPaint: SelectionFillPaint = {
      kind: "solid",
      value: rgbaToCss({ ...black, a: 1 }),
      source: rgbaToCss(black),
      property: "backgroundImage",
      layerIndex: 0,
      opacity: 20,
    };
    return {
      styles: selectionFillInspectorStyles({
        ...model,
        stacks: [[newPaint, ...stack], ...model.stacks.slice(1)],
      }),
      open: "layer",
    };
  }

  const recent = mostRecentFillColor && parseCssColor(mostRecentFillColor);
  // guard:allow-raw-color - New artwork starts with white paint when no recent paint exists.
  const color = recent ? rgbaToCss(recent) : "#ffffff";
  const paint = solidFillPaint(color, "backgroundColor");
  if (!paint) throw new Error("The default fill color is invalid.");
  return {
    styles: selectionFillInspectorStyles({
      ...model,
      state: "common",
      stacks: model.stacks.map(() => [paint]),
    }),
    open: "base",
  };
}

export function rewriteSelectionFillStyles(
  scopes: SelectionColorScope[],
  styles: Record<string, string>,
): SelectionFillStyleRewriteResult {
  const byFile = new Map<string, SelectionColorScope[]>();
  scopes.forEach((scope) => {
    byFile.set(scope.fileId, [...(byFile.get(scope.fileId) ?? []), scope]);
  });
  if (byFile.size === 0 || scopes.some((scope) => scope.wholeDocument)) {
    return {
      status: "conflict",
      updates: [],
      message: "Group Fill needs a selected source-backed Group.", // i18n-ignore internal refusal detail; UI shows localized groupFillApplyFailed
    };
  }

  const requestedStack = fillStackFromInspectorStyles(styles);
  if (!requestedStack) {
    return {
      status: "unsupported",
      updates: [],
      message: // i18n-ignore internal refusal detail; UI shows localized groupFillApplyFailed
        "This Group fill type cannot be applied to every selected layer.",
    };
  }

  const updates: SelectionFillStyleUpdate[] = [];
  for (const [fileId, fileScopes] of byFile) {
    const content = fileScopes[0]?.content;
    if (!content || fileScopes.some((scope) => scope.content !== content)) {
      return {
        status: "conflict",
        updates: [],
        message: "The selected Group source changed before its fill was saved.", // i18n-ignore internal refusal detail; UI shows localized groupFillApplyFailed
      };
    }

    if (
      fileScopes.some(
        (scope) => !scope.wholeDocument && !resolveSelectionScopeNode(scope),
      )
    ) {
      return {
        status: "conflict",
        updates: [],
        message: "A selected Group no longer resolves uniquely in its source.", // i18n-ignore internal refusal detail; UI shows localized groupFillApplyFailed
      };
    }

    const currentModel = selectionFillModel(fileScopes);
    if (
      currentModel.targets.length === 0 ||
      currentModel.targets.some((target) =>
        target.stack.some((paint) => paint.kind === "unknown"),
      )
    ) {
      return {
        status: "unsupported",
        updates: [],
        message: // i18n-ignore internal refusal detail; UI shows localized groupFillApplyFailed
          "A selected layer uses a fill that Group Fill cannot edit safely.",
      };
    }

    const projection = buildCodeLayerProjection(content);
    const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
    const textNodeIds = new Set<string>();
    for (const target of currentModel.targets) {
      if (target.channel !== "text") continue;
      const node = nodesById.get(target.nodeId);
      if (!node?.source) {
        return {
          status: "unsupported",
          updates: [],
          message: "Group Fill could not find a text paint target.", // i18n-ignore internal refusal detail; UI shows localized groupFillApplyFailed
        };
      }
      if (
        node.children.length > 0 &&
        !richTextDescendantsCanInheritGroupFill(node, nodesById)
      ) {
        return {
          status: "unsupported",
          updates: [],
          message: "Group Fill cannot safely replace a nested text fill.", // i18n-ignore internal refusal detail; UI shows localized groupFillApplyFailed
        };
      }
      if (
        node.children.length === 0 &&
        !hasTextPaintMarker(node) &&
        (backgroundPaints(node).length > 0 || node.classes.length > 0)
      ) {
        textNodeIds.add(node.id);
      }
    }

    let nextContent = content;
    if (textNodeIds.size > 0) {
      const wrapped = wrapBareTextLeavesInHtml(nextContent, {
        targetNodeIds: [...textNodeIds],
      });
      if (!wrapped.changed) {
        return {
          status: "unsupported",
          updates: [],
          message: // i18n-ignore internal refusal detail; UI shows localized groupFillApplyFailed
            "Group Fill could not create a separate editable text paint.",
        };
      }
      nextContent = wrapped.content;
    }

    const editableModel = selectionFillModel(
      fileScopes.map((scope) => ({ ...scope, content: nextContent })),
    );
    const nextProjection = buildCodeLayerProjection(nextContent);
    const editableNodes = new Map(
      nextProjection.nodes.map((node) => [node.id, node]),
    );
    const writes: Array<[string, string]> = [
      ["background-color", styles.backgroundColor || "transparent"],
      ["background-image", styles.backgroundImage || "none"],
      ["background-size", styles.backgroundSize || "auto"],
      ["background-repeat", styles.backgroundRepeat || "repeat"],
      ["background-position", styles.backgroundPosition || "0% 0%"],
    ];

    for (const target of editableModel.targets) {
      const node = editableNodes.get(target.nodeId);
      if (!node?.source) {
        return {
          status: "conflict",
          updates: [],
          message: // i18n-ignore internal refusal detail; UI shows localized groupFillApplyFailed
            "A selected Group fill target no longer exists in its source.",
        };
      }
      const isClippedText =
        hasTextPaintMarker(node) ||
        node.style["background-clip"] === "text" ||
        node.style["-webkit-background-clip"] === "text";
      const isText = target.channel === "text" || isClippedText;
      let paintWrites: Array<[string, string]>;
      if (target.channel === "vector") {
        if (
          requestedStack.length > 1 ||
          requestedStack.some((paint) => paint.kind !== "solid")
        ) {
          return {
            status: "unsupported",
            updates: [],
            message: "Layered Group fills are not supported on SVG shapes yet.", // i18n-ignore internal refusal detail; UI shows localized groupFillApplyFailed
          };
        }
        const paint = requestedStack[0];
        paintWrites = [
          ["fill", paint ? inspectorSolidPaintValue(paint) : "transparent"],
        ];
      } else if (isText) {
        if (
          requestedStack.some(
            (paint) => paint.kind === "unknown" || paint.kind === "image",
          )
        ) {
          return {
            status: "unsupported",
            updates: [],
            message: "This Group paint cannot be clipped to text safely.", // i18n-ignore internal refusal detail; UI shows localized groupFillApplyFailed
          };
        }
        paintWrites = [
          ...writes,
          ["background-clip", "text"],
          ["-webkit-background-clip", "text"],
          ["color", "transparent"],
          ["-webkit-text-fill-color", "transparent"],
        ];
      } else {
        paintWrites = writes;
      }

      for (const [property, value] of paintWrites) {
        const patch = applyVisualEdit(nextContent, {
          kind: "style",
          target: editTargetForFillNode(node),
          property,
          value,
        });
        if (patch.result.status !== "applied") {
          return {
            status: "unsupported",
            updates: [],
            message: patch.result.message,
          };
        }
        nextContent = patch.content;
      }
    }
    updates.push({ fileId, content: nextContent });
  }

  return { status: "applied", updates };
}

function editTargetForFillNode(node: CodeLayerNode): EditIntentTarget {
  const stableNodeId = [
    node.dataAttributes["data-agent-native-node-id"],
    node.dataAttributes["data-code-layer-id"],
    node.dataAttributes["data-layer-id"],
    node.dataAttributes["data-builder-id"],
    node.dataAttributes["data-loc"],
    typeof node.attributes.id === "string" ? node.attributes.id : undefined,
  ].find((value): value is string => Boolean(value));
  return {
    ...(stableNodeId ? { nodeId: stableNodeId } : {}),
    selector: node.path,
  };
}

function richTextDescendantsCanInheritGroupFill(
  node: CodeLayerNode,
  nodesById: ReadonlyMap<string, CodeLayerNode>,
): boolean {
  const pending = [...node.children];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id) continue;
    const child = nodesById.get(id);
    if (!child) return false;
    const style = child.style as Record<string, string | undefined>;
    if (style["-webkit-text-fill-color"] !== undefined) return false;
    pending.push(...child.children);
  }
  return true;
}

function fillStackFromInspectorStyles(
  styles: Record<string, string>,
): SelectionFillPaint[] | null {
  if (
    styles.backgroundColor === "Mixed" ||
    styles.backgroundImage === "Mixed"
  ) {
    return null;
  }
  const sizeLayers = splitCssLayers(styles.backgroundSize ?? "");
  const repeatLayers = splitCssLayers(styles.backgroundRepeat ?? "");
  const positionLayers = splitCssLayers(styles.backgroundPosition ?? "");
  const imageLayers = splitCssLayers(styles.backgroundImage ?? "");
  const paints = imageLayers
    .filter((layer) => layer.toLowerCase() !== "none")
    .map((layer, index) =>
      canonicalPaintLayer(
        layer,
        "backgroundImage",
        index,
        isLayerHiddenBySize(sizeLayers[index]),
        sizeLayers[index] ?? "auto",
        repeatLayers[index] ?? "repeat",
        positionLayers[index] ?? "0% 0%",
      ),
    );
  if (paints.some((paint) => paint.kind === "unknown")) return null;
  const baseColor = styles.backgroundColor?.trim();
  if (baseColor && !/^(?:transparent|none)$/i.test(baseColor)) {
    const basePaint = solidFillPaint(baseColor, "backgroundColor");
    if (!basePaint) return null;
    paints.push(basePaint);
  }
  return paints;
}

function inspectorSolidPaintValue(paint: SelectionFillPaint): string {
  if (paint.kind !== "solid") return "transparent";
  if (paint.hidden) {
    return gradientStopWithFillOpacity(paint.value, paint.opacity ?? 0);
  }
  const color = parseCssColor(paint.value);
  if (!color) return paint.source;
  const opacity = paint.opacity ?? 100;
  if (opacity === 0) return rgbaToCss({ ...color, a: 0 });
  return rgbaToCss({ ...color, a: (opacity / 100) * color.a });
}

function inspectorImagePaintValue(paint: SelectionFillPaint): string {
  if (paint.kind === "solid") {
    const base = parseCssColor(paint.value);
    const color = base
      ? rgbaToCss({
          ...base,
          a: ((paint.opacity ?? 100) / 100) * base.a,
        })
      : paint.source;
    return buildSolidFillLayer(color);
  }
  return paint.source;
}

function selectedNodesForFillScope(
  scope: SelectionColorScope,
): CodeLayerNode[] | null {
  const { projection, node: root } = resolveSelectionScope(scope);
  if (scope.wholeDocument) return projection.nodes;
  if (!root) return null;

  const byId = new Map(projection.nodes.map((node) => [node.id, node]));
  const selected: CodeLayerNode[] = [];
  const visit = (node: CodeLayerNode, include: boolean) => {
    if (include) selected.push(node);
    if (
      node.dataAttributes["data-an-primitive"] === "boolean" ||
      SVG_PAINT_SCAFFOLD_TAGS.has(node.tag.toLowerCase())
    ) {
      return;
    }
    node.children.forEach((id) => {
      const child = byId.get(id);
      if (child) visit(child, true);
    });
  };
  const isGroupRoot = root.dataAttributes["data-agent-native-group"] === "true";
  visit(root, !isGroupRoot);
  return selected;
}

const SVG_PAINT_SCAFFOLD_TAGS = new Set(["defs", "mask", "clippath", "symbol"]);

function hasVisibleSvgUse(node: CodeLayerNode, content: string): boolean {
  if (!node.source) return false;
  const source = content.slice(node.source.start, node.source.end);
  const ancestors: string[] = [];
  const tokens = source.matchAll(/<!--[\s\S]*?-->|<[^>]*>/g);
  for (const token of tokens) {
    const raw = token[0];
    if (!raw || raw.startsWith("<!--") || raw.startsWith("<!")) continue;
    const closing = /^<\s*\/\s*([\w:-]+)/.exec(raw);
    if (closing) {
      const tag = closing[1]?.toLowerCase();
      if (tag) {
        const index = ancestors.lastIndexOf(tag);
        if (index >= 0) ancestors.length = index;
      }
      continue;
    }
    const opening = /^<\s*([\w:-]+)/.exec(raw);
    const tag = opening?.[1]?.toLowerCase();
    if (!tag) continue;
    if (
      tag === "use" &&
      !ancestors.some((ancestor) => SVG_PAINT_SCAFFOLD_TAGS.has(ancestor))
    ) {
      return true;
    }
    if (!/\/\s*>$/.test(raw)) ancestors.push(tag);
  }
  return false;
}

function isInsideUnpaintedScaffold(
  node: CodeLayerNode,
  byId: ReadonlyMap<string, CodeLayerNode>,
): boolean {
  let current: CodeLayerNode | undefined = node;
  while (current) {
    if (SVG_PAINT_SCAFFOLD_TAGS.has(current.tag.toLowerCase())) return true;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}

function solidFillPaint(
  value: string,
  property: string,
  layerIndex?: number,
): SelectionFillPaint | null {
  const stored = readGradientFillOpacity([{ color: value }]);
  const colorValue = stored.stops[0]?.color ?? value;
  const color = parseCssColor(colorValue);
  if (!color) return null;
  const opacity =
    stored.opacity !== 100 ? stored.opacity : Math.round(color.a * 100);
  const isHidden =
    stored.opacity === 0 && /^color-mix\(in srgb,/i.test(value.trim());
  return {
    kind: "solid",
    value: rgbaToCss({ ...color, a: 1 }),
    source: value,
    property,
    ...(layerIndex === undefined ? {} : { layerIndex }),
    opacity,
    ...(isHidden ? { hidden: true } : {}),
  };
}

function canonicalPaintLayer(
  layer: string,
  property: string,
  layerIndex: number,
  hidden = false,
  size?: string,
  repeat?: string,
  position?: string,
): SelectionFillPaint {
  const solid = parseSolidFillLayer(layer);
  if (solid) {
    const paint = solidFillPaint(solid, property, layerIndex);
    return {
      kind: "solid",
      value: paint?.value ?? solid,
      source: layer,
      property,
      layerIndex,
      opacity: paint?.opacity ?? 100,
      ...(paint?.hidden || hidden ? { hidden: true } : {}),
      ...(size ? { size } : {}),
      ...(repeat ? { repeat } : {}),
      ...(position ? { position } : {}),
    };
  }
  const gradient = parseGradientLayer(layer);
  if (gradient) {
    return {
      kind: "gradient",
      value: JSON.stringify(gradient),
      source: layer,
      property,
      layerIndex,
      opacity: gradient.opacity ?? 100,
      ...(hidden ? { hidden: true } : {}),
      ...(size ? { size } : {}),
      ...(repeat ? { repeat } : {}),
      ...(position ? { position } : {}),
    };
  }
  if (/(?:url|image-set|cross-fade)\s*\(/i.test(layer)) {
    return {
      kind: "image",
      value: layer.trim().replace(/\s+/g, " "),
      source: layer,
      property,
      layerIndex,
      ...(hidden ? { hidden: true } : {}),
      ...(size ? { size } : {}),
      ...(repeat ? { repeat } : {}),
      ...(position ? { position } : {}),
    };
  }
  return {
    kind: "unknown",
    value: layer.trim().replace(/\s+/g, " "),
    source: layer,
    property,
    layerIndex,
    ...(hidden ? { hidden: true } : {}),
    ...(size ? { size } : {}),
    ...(repeat ? { repeat } : {}),
    ...(position ? { position } : {}),
  };
}

function backgroundPaints(node: CodeLayerNode): SelectionFillPaint[] {
  const style = node.style as Record<string, string | undefined>;
  const basePaints: SelectionFillPaint[] = [];
  const shorthand = style.background?.trim();
  const backgroundColor = style["background-color"]?.trim();

  if (backgroundColor) {
    const solid = solidFillPaint(backgroundColor, "backgroundColor");
    if (solid) basePaints.push(solid);
  } else if (
    shorthand &&
    !/(?:url|(?:linear|radial|conic)-gradient|image-set)\s*\(/i.test(shorthand)
  ) {
    const solid = solidFillPaint(shorthand, "backgroundColor");
    if (solid) basePaints.push(solid);
  }

  const backgroundImage = style["background-image"]?.trim();
  const imageLayers = backgroundImage
    ? splitCssLayers(backgroundImage)
    : shorthand &&
        /(?:url|(?:linear|radial|conic)-gradient|image-set)\s*\(/i.test(
          shorthand,
        )
      ? splitCssLayers(shorthand)
      : [];
  const sizeLayers = splitCssLayers(style["background-size"] ?? "");
  const repeatLayers = splitCssLayers(style["background-repeat"] ?? "");
  const positionLayers = splitCssLayers(style["background-position"] ?? "");
  const imagePaints: SelectionFillPaint[] = [];
  imageLayers.forEach((layer, index) => {
    if (layer.toLowerCase() === "none") return;
    imagePaints.push(
      canonicalPaintLayer(
        layer,
        "backgroundImage",
        index,
        isLayerHiddenBySize(sizeLayers[index]),
        sizeLayers[index] ?? "auto",
        repeatLayers[index] ?? "repeat",
        positionLayers[index] ?? "0% 0%",
      ),
    );
  });

  return [...imagePaints, ...basePaints];
}

function inheritedTextColor(
  node: CodeLayerNode,
  byId: ReadonlyMap<string, CodeLayerNode>,
): string | null {
  let current: CodeLayerNode | undefined = node;
  while (current) {
    const color = (current.style as Record<string, string | undefined>).color;
    if (color && color !== "inherit") return color;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  // guard:allow-raw-color - Source text-color fallback, not editor chrome.
  return "#000000";
}

function isGeometricFillTarget(node: CodeLayerNode): boolean {
  const style = node.style as Record<string, string | undefined>;
  const primitive = node.dataAttributes["data-an-primitive"];
  return (
    ["rectangle", "ellipse", "circle", "oval", "frame", "image"].includes(
      primitive ?? "",
    ) ||
    Boolean(
      (style.width || style.height) &&
      (style.position === "absolute" || node.tag === "svg"),
    )
  );
}

function nodeFillTargetStacks(
  nodes: CodeLayerNode[],
  projectionNodes: CodeLayerNode[],
  fileId: string,
  content: string,
): SelectionFillTargetStack[] {
  const byId = new Map(projectionNodes.map((node) => [node.id, node]));
  const selectedIds = new Set(nodes.map((node) => node.id));
  const targets: SelectionFillTargetStack[] = [];

  for (const node of nodes) {
    if (isInsideUnpaintedScaffold(node, byId)) continue;
    if (node.tag.toLowerCase() === "use") {
      targets.push({
        fileId,
        nodeId: node.id,
        selector: node.selector,
        channel: "vector",
        stack: [
          {
            kind: "unknown",
            value: "svg-use",
            source: "svg-use",
            property: "fill",
          },
        ],
      });
      continue;
    }
    const style = node.style as Record<string, string | undefined>;
    const primitive = node.dataAttributes["data-an-primitive"];
    const isBooleanResult = primitive === "boolean";
    if (
      node.tag === "svg" &&
      !isBooleanResult &&
      hasVisibleSvgUse(node, content)
    ) {
      targets.push({
        fileId,
        nodeId: node.id,
        selector: node.selector,
        channel: "vector",
        stack: [
          {
            kind: "unknown",
            value: "svg-use",
            source: "svg-use",
            property: "fill",
          },
        ],
      });
      continue;
    }
    if (
      node.tag === "svg" &&
      !primitive &&
      hasUnsupportedGenericSvgPaint(node, content)
    ) {
      targets.push({
        fileId,
        nodeId: node.id,
        selector: node.selector,
        channel: "vector",
        stack: [
          {
            kind: "unknown",
            value: "unsupported-svg-paint",
            source: "unsupported-svg-paint",
            property: "fill",
          },
        ],
      });
      continue;
    }
    if (node.tag === "svg") {
      const vectorFill =
        style["--boolean-mask-fill"] ??
        style.fill ??
        (typeof node.attributes.fill === "string"
          ? node.attributes.fill
          : undefined);
      if (isBooleanResult || typeof vectorFill === "string") {
        const paint =
          typeof vectorFill === "string"
            ? solidFillPaint(vectorFill, "fill")
            : null;
        targets.push({
          fileId,
          nodeId: node.id,
          selector: node.selector,
          channel: "vector",
          stack:
            typeof vectorFill === "string" && !paint
              ? [
                  {
                    kind: "unknown",
                    value: vectorFill,
                    source: vectorFill,
                    property: "fill",
                  },
                ]
              : paint
                ? [paint]
                : [],
        });
      }
      if (
        isBooleanResult ||
        primitive === "boolean-operand" ||
        typeof vectorFill === "string"
      ) {
        continue;
      }
    }
    const explicitFill = [
      "background",
      "background-color",
      "background-image",
      "fill",
    ].some((property) => Object.prototype.hasOwnProperty.call(style, property));
    const hasTextPaintChild = hasTextPaintChildNode(node, byId);
    const isGeometric = isGeometricFillTarget(node);
    const hasBackgroundTarget =
      !hasTextPaintChild &&
      (explicitFill || (isGeometric && !node.paintsOwnText));

    if (hasBackgroundTarget) {
      const hasExternalPaint =
        node.classes.length > 0 &&
        !explicitFill &&
        (style.width !== undefined || style.height !== undefined);
      const paints = hasExternalPaint
        ? [
            {
              kind: "unknown" as const,
              value: "external-style",
              source: "external-style",
              property: "backgroundImage",
            },
          ]
        : backgroundPaints(node);
      targets.push({
        fileId,
        nodeId: node.id,
        selector: node.selector,
        channel: "background",
        stack: paints,
      });
    }

    const textIsBackgroundClipped =
      style["background-clip"] === "text" ||
      style["-webkit-background-clip"] === "text";
    const hasSelectedTextPaintAncestor = (() => {
      let parent = node.parentId ? byId.get(node.parentId) : undefined;
      while (parent) {
        if (
          selectedIds.has(parent.id) &&
          parent.paintsOwnText &&
          !hasTextPaintChildNode(parent, byId)
        ) {
          return true;
        }
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
      return false;
    })();
    if (
      node.paintsOwnText &&
      !hasTextPaintChild &&
      !textIsBackgroundClipped &&
      !hasSelectedTextPaintAncestor
    ) {
      const color = inheritedTextColor(node, byId);
      const paint = color ? solidFillPaint(color, "color") : null;
      targets.push({
        fileId,
        nodeId: node.id,
        selector: node.selector,
        channel: "text",
        stack: paint ? [paint] : [],
      });
    }
  }

  return targets;
}

function hasTextPaintChildNode(
  node: CodeLayerNode,
  byId: ReadonlyMap<string, CodeLayerNode>,
): boolean {
  return node.children.some((childId) => {
    const child = byId.get(childId);
    return child ? hasTextPaintMarker(child) : false;
  });
}

function hasTextPaintMarker(node: CodeLayerNode): boolean {
  return Object.prototype.hasOwnProperty.call(node.attributes, "data-an-text");
}

const SVG_VISIBLE_SHAPE_TAGS = new Set([
  "circle",
  "ellipse",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
]);

function hasUnsupportedGenericSvgPaint(
  node: CodeLayerNode,
  content: string,
): boolean {
  if (!node.source) return true;
  if (node.classes.length > 0) return true;

  const source = content.slice(node.source.start, node.source.end);
  const ancestors: string[] = [];
  const shapes: string[] = [];
  for (const token of source.matchAll(/<!--[\s\S]*?-->|<[^>]*>/g)) {
    const raw = token[0];
    if (!raw || raw.startsWith("<!--") || raw.startsWith("<!")) continue;
    const closing = /^<\s*\/\s*([\w:-]+)/.exec(raw);
    if (closing) {
      const tag = closing[1]?.toLowerCase();
      if (tag) {
        const index = ancestors.lastIndexOf(tag);
        if (index >= 0) ancestors.length = index;
      }
      continue;
    }
    const tag = /^<\s*([\w:-]+)/.exec(raw)?.[1]?.toLowerCase();
    if (!tag) continue;
    if (ancestors.some((ancestor) => SVG_PAINT_SCAFFOLD_TAGS.has(ancestor))) {
      if (!/\/\s*>$/.test(raw)) ancestors.push(tag);
      continue;
    }
    if (
      tag === "use" ||
      tag === "g" ||
      tag === "image" ||
      tag === "text" ||
      tag === "foreignobject" ||
      tag === "style"
    ) {
      return true;
    }
    if (SVG_VISIBLE_SHAPE_TAGS.has(tag)) {
      if (ancestors.length !== 1 || ancestors[0] !== "svg") return true;
      if (/\sclass\s*=/.test(raw)) return true;
      shapes.push(raw);
    }
    if (!/\/\s*>$/.test(raw)) ancestors.push(tag);
  }

  return shapes.length !== 1;
}

export function selectionFillModel(
  scopes: SelectionColorScope[],
): SelectionFillModel {
  const targets: SelectionFillTargetStack[] = [];
  for (const scope of scopes) {
    const projection = scope.wholeDocument
      ? buildCodeLayerProjection(scope.content)
      : resolveSelectionScope(scope).projection;
    const selected = selectedNodesForFillScope(scope);
    if (!selected) {
      return {
        state: "mixed",
        stacks: [],
        targets: [],
        scopeConflict: true,
      };
    }
    targets.push(
      ...nodeFillTargetStacks(
        selected,
        projection.nodes,
        scope.fileId,
        scope.content,
      ),
    );
  }
  const stacks = targets.map((target) => target.stack);
  if (stacks.length === 0) {
    return { state: "empty", stacks: [], targets: [] };
  }

  const paintSignature = (stack: SelectionFillPaint[]) =>
    JSON.stringify(
      stack.map(({ kind, value, hidden, opacity, size, repeat, position }) => ({
        kind,
        value,
        hidden,
        opacity,
        ...(kind === "solid"
          ? {}
          : {
              size: size === "auto" ? undefined : size,
              repeat: repeat === "repeat" ? undefined : repeat,
              position: position === "0% 0%" ? undefined : position,
            }),
      })),
    );
  const signature = paintSignature(stacks[0] ?? []);
  return {
    state: stacks.every((stack) => paintSignature(stack) === signature)
      ? "common"
      : "mixed",
    stacks,
    targets,
  };
}

export function selectionDisplayHex(value: string): string {
  const parsed = parseCssColor(value);
  if (!parsed) return value.replace(/^#/, "").toUpperCase();
  return rgbaToHex(parsed).replace(/^#/, "").toUpperCase();
}
