import type { ReactNode } from "react";

import type { InspectCodeData } from "../EditPanel";

const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const INSPECT_CODE_MAX_INLINE_TAG_LENGTH = 48;
const INSPECT_CODE_OPENING_TAG_PATTERN =
  /<[a-zA-Z][\w:-]*(?:"[^"]*"|'[^']*'|[^'"<>])*\/?>/g;
const INSPECT_CODE_RAW_TEXT_TAGS = new Set([
  "script",
  "style",
  "textarea",
  "title",
]);

interface ParsedOpeningTag {
  tagName: string;
  attributes: string[];
  closing: ">" | "/>";
}

export function normalizedElementTagName(
  tagName: string | null | undefined,
): string {
  return tagName?.trim().toLowerCase() || "element";
}

export function vscodeDeepLink(
  absolutePath: string,
  line?: number,
  column?: number,
): string {
  const base = `vscode://file/${absolutePath}`;
  if (line == null) return base;
  return column == null ? `${base}:${line}` : `${base}:${line}:${column}`;
}

export function openingTagOf(html: string | null | undefined): string | null {
  if (!html) return null;
  const trimmed = html.trimStart();
  const match = /^<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*?)\/?>/.exec(
    trimmed,
  );
  if (!match) return null;
  return match[0];
}

export function truncateOpeningTag(openTag: string, max = 32): string {
  return openTag.replace(
    /("|')((?:\\.|(?!\1)[^\\])*)\1/g,
    (full, quote, value) => {
      if (typeof value !== "string" || value.length <= max) return full;
      return `${quote}${value.slice(0, max - 1)}…${quote}`;
    },
  );
}

function parseInspectCodeOpeningTag(openTag: string): ParsedOpeningTag | null {
  const tagMatch = /^<([a-zA-Z][\w:-]*)([\s\S]*?)(\/?>)$/.exec(openTag.trim());
  if (!tagMatch?.[1] || (tagMatch[3] !== ">" && tagMatch[3] !== "/>")) {
    return null;
  }

  const attributes: string[] = [];
  const attributePattern =
    /\s+([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  for (const match of (tagMatch[2] ?? "").matchAll(attributePattern)) {
    const name = match[1];
    if (!name) continue;
    const normalizedName = name.toLowerCase();
    if (
      normalizedName === "style" ||
      normalizedName.startsWith("data-agent-native-")
    ) {
      continue;
    }
    attributes.push(`${name}${match[2] ? `=${match[2]}` : ""}`);
  }

  return {
    tagName: tagMatch[1],
    attributes,
    closing: tagMatch[3],
  };
}

export function formatInspectCodeOpeningTag(
  openTag: string,
  maxInlineLength = INSPECT_CODE_MAX_INLINE_TAG_LENGTH,
): string {
  const parsed = parseInspectCodeOpeningTag(openTag);
  if (!parsed) return openTag;

  const inline = `<${parsed.tagName}${
    parsed.attributes.length ? ` ${parsed.attributes.join(" ")}` : ""
  }${parsed.closing}`;
  if (!parsed.attributes.length || inline.length <= maxInlineLength) {
    return inline;
  }

  return `<${parsed.tagName}\n  ${parsed.attributes.join("\n  ")}${
    parsed.closing
  }`;
}

function tagNameFromOpeningTag(openTag: string): string | null {
  const match = /^<\/?\s*([a-zA-Z][\w:-]*)/.exec(openTag.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

function isSelfClosingOpeningTag(openTag: string, tagName: string): boolean {
  return /\/>\s*$/.test(openTag) || VOID_HTML_TAGS.has(tagName);
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fallbackOpeningTag(
  data: Pick<InspectCodeData, "tagName" | "id" | "classes">,
) {
  const tag = normalizedElementTagName(data.tagName);
  const attrs: string[] = [];
  const id = data.id?.trim();
  const classes = data.classes?.map((item) => item.trim()).filter(Boolean);
  if (id) attrs.push(`id="${escapeHtmlAttribute(id)}"`);
  if (classes?.length) {
    attrs.push(`class="${escapeHtmlAttribute(classes.join(" "))}"`);
  }
  return `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
}

function formatInspectCodeMarkup(markup: string): string {
  const formatted: string[] = [];
  let cursor = 0;

  while (cursor < markup.length) {
    INSPECT_CODE_OPENING_TAG_PATTERN.lastIndex = cursor;
    const match = INSPECT_CODE_OPENING_TAG_PATTERN.exec(markup);
    if (!match) {
      formatted.push(markup.slice(cursor));
      break;
    }

    const tagIndex = match.index ?? cursor;
    const commentIndex = markup.indexOf("<!--", cursor);
    if (commentIndex !== -1 && commentIndex < tagIndex) {
      const commentEnd = markup.indexOf("-->", commentIndex + 4);
      if (commentEnd === -1) {
        formatted.push(markup.slice(cursor));
        break;
      }
      formatted.push(markup.slice(cursor, commentEnd + 3));
      cursor = commentEnd + 3;
      continue;
    }

    const openingTag = match[0];
    formatted.push(markup.slice(cursor, tagIndex));
    formatted.push(formatInspectCodeOpeningTag(openingTag));
    cursor = tagIndex + openingTag.length;

    const tagName = tagNameFromOpeningTag(openingTag);
    if (
      !tagName ||
      !INSPECT_CODE_RAW_TEXT_TAGS.has(tagName) ||
      isSelfClosingOpeningTag(openingTag, tagName)
    ) {
      continue;
    }

    const closingTag = new RegExp(`</\\s*${tagName}\\s*>`, "i").exec(
      markup.slice(cursor),
    );
    if (!closingTag) {
      formatted.push(markup.slice(cursor));
      break;
    }
    const closingIndex = cursor + (closingTag.index ?? 0);
    const closingEnd = closingIndex + closingTag[0].length;
    formatted.push(markup.slice(cursor, closingEnd));
    cursor = closingEnd;
  }

  return formatted.join("");
}

export function elementHtmlPreview(
  data: Pick<InspectCodeData, "html" | "tagName" | "id" | "classes">,
): string | null {
  const sourceHtml = data.html?.trim();
  const openingTag = openingTagOf(data.html);
  const hasFallbackMetadata = Boolean(
    data.tagName?.trim() ||
    data.id?.trim() ||
    data.classes?.some((item) => item.trim()),
  );
  if (!openingTag && !hasFallbackMetadata) return null;
  const previewOpeningTag = formatInspectCodeOpeningTag(
    openingTag ?? fallbackOpeningTag(data),
  );
  const tagName =
    tagNameFromOpeningTag(previewOpeningTag) ??
    normalizedElementTagName(data.tagName);
  if (isSelfClosingOpeningTag(previewOpeningTag, tagName)) {
    return previewOpeningTag;
  }
  const closingTag = sourceHtml
    ? new RegExp(`</\\s*${tagName}\\s*>\\s*$`, "i").exec(sourceHtml)
    : null;
  if (
    !sourceHtml ||
    !openingTag ||
    !sourceHtml.startsWith(openingTag) ||
    !closingTag
  ) {
    return `${previewOpeningTag}\n  ...\n</${tagName}>`;
  }
  const innerHtml = sourceHtml
    .slice(openingTag.length, closingTag.index)
    .trim();
  if (!innerHtml) return `${previewOpeningTag}</${tagName}>`;
  const formattedInnerHtml = formatInspectCodeMarkup(innerHtml)
    .trim()
    .replace(/^/gm, "  ");
  return `${previewOpeningTag}\n${formattedInnerHtml}\n</${tagName}>`;
}

type HtmlTokenKind = "plain" | "punctuation" | "tag" | "attribute" | "value";

interface HtmlToken {
  text: string;
  kind: HtmlTokenKind;
}

function tokenizeHtmlAttributes(source: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const attrPattern =
    /(\s+)([^\s=/>]+)(?:\s*(=)\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  let cursor = 0;
  for (const match of source.matchAll(attrPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push({ text: source.slice(cursor, index), kind: "plain" });
    }
    tokens.push({ text: match[1] ?? "", kind: "plain" });
    tokens.push({ text: match[2] ?? "", kind: "attribute" });
    if (match[3]) tokens.push({ text: match[3], kind: "punctuation" });
    if (match[4]) tokens.push({ text: match[4], kind: "value" });
    cursor = index + match[0].length;
  }
  if (cursor < source.length) {
    tokens.push({ text: source.slice(cursor), kind: "plain" });
  }
  return tokens;
}

function tokenizeHtmlTag(source: string): HtmlToken[] {
  const match = /^(<\/?)([a-zA-Z][\w:-]*)([\s\S]*?)(\/?>)$/.exec(source);
  if (!match) return [{ text: source, kind: "plain" }];
  return [
    { text: match[1] ?? "", kind: "punctuation" },
    { text: match[2] ?? "", kind: "tag" },
    ...tokenizeHtmlAttributes(match[3] ?? ""),
    { text: match[4] ?? "", kind: "punctuation" },
  ];
}

function tokenizeHtml(source: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const tagPattern = /<\/?[a-zA-Z][\w:-]*(?:"[^"]*"|'[^']*'|[^'">])*>/g;
  let cursor = 0;
  for (const match of source.matchAll(tagPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push({ text: source.slice(cursor, index), kind: "plain" });
    }
    tokens.push(...tokenizeHtmlTag(match[0]));
    cursor = index + match[0].length;
  }
  if (cursor < source.length) {
    tokens.push({ text: source.slice(cursor), kind: "plain" });
  }
  return tokens;
}

function htmlTokenClassName(kind: HtmlTokenKind): string {
  switch (kind) {
    case "punctuation":
      return "text-muted-foreground/70";
    case "tag":
      return "text-[var(--design-editor-accent-color)]";
    case "attribute":
      return "text-foreground/90";
    case "value":
      return "text-[var(--design-editor-measure-color)]";
    default:
      return "text-muted-foreground";
  }
}

export function highlightedHtml(source: string): ReactNode {
  return tokenizeHtml(source).map((token, index) => (
    <span
      key={`${index}:${token.kind}`}
      className={htmlTokenClassName(token.kind)}
    >
      {token.text}
    </span>
  ));
}

export function parseAlpineDataObject(
  xData: string | null | undefined,
): Record<string, string> | null {
  if (!xData) return null;
  const trimmed = xData.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return {};

  const out: Record<string, string> = {};
  const pairRe =
    /(?:^|,)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|true|false|-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = pairRe.exec(inner)) !== null) {
    matched = true;
    const key = m[1] ?? m[2] ?? m[3];
    let raw = m[4]!;
    if (raw.startsWith("'") && raw.endsWith("'")) {
      raw = raw.slice(1, -1).replace(/\\'/g, "'");
    } else if (raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1).replace(/\\"/g, '"');
    }
    if (key) out[key] = raw;
  }
  if (!matched) return null;
  return out;
}

export function serializeAlpineDataObject(obj: Record<string, string>): string {
  const parts = Object.entries(obj).map(([key, value]) => {
    const isBoolean = value === "true" || value === "false";
    const isNumber = /^-?\d+(\.\d+)?$/.test(value);
    const literal =
      isBoolean || isNumber ? value : `'${value.replace(/'/g, "\\'")}'`;
    return `${key}: ${literal}`;
  });
  return parts.length ? `{ ${parts.join(", ")} }` : "{}";
}

export function alpineDataValueLiteral(value: string): string {
  const isBoolean = value === "true" || value === "false";
  const isNumber = /^-?\d+(\.\d+)?$/.test(value);
  return isBoolean || isNumber ? value : `'${value.replace(/'/g, "\\'")}'`;
}

/**
 * Surgically replace a single top-level key's value inside an Alpine `x-data`
 * object literal, preserving everything else byte-for-byte — methods
 * (`toggle() { … }`), nested objects, escaped strings, quoted keys, comments,
 * and whitespace are all left untouched.
 *
 * Unlike a `parseAlpineDataObject` → mutate → `serializeAlpineDataObject`
 * round-trip (which only understands a flat object of simple literals and so
 * *drops* anything it can't model), this walks the original string, finds the
 * `key:` token at the top level (depth 0, not inside a string/comment), and
 * rewrites only the value literal that immediately follows it.
 *
 * Returns `null` when the key cannot be located surgically (e.g. the value is
 * an expression/function/object rather than a simple string/boolean/number, or
 * the literal isn't a `{ … }` object) so the caller can fail safe instead of
 * persisting a lossy rewrite.
 *
 * Pure — exported for tests.
 */
export function replaceAlpineDataKeyValue(
  xData: string | null | undefined,
  key: string,
  nextValue: string,
): string | null {
  if (!xData) return null;
  const trimmed = xData.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  const s = xData;
  const n = s.length;
  let depth = 0;
  let i = 0;

  const skipString = (quote: string): void => {
    i += 1;
    while (i < n) {
      const c = s[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote) {
        i += 1;
        return;
      }
      i += 1;
    }
  };

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bareRe = new RegExp(`^(${escapedKey})(\\s*:\\s*)`);
  const quotedRe = new RegExp(`^(['"]${escapedKey}['"])(\\s*:\\s*)`);

  while (i < n) {
    const c = s[i];

    if (depth === 1) {
      const prev = lastNonSpaceBefore(s, i);
      if (prev === "{" || prev === ",") {
        const rest = s.slice(i);
        const m = bareRe.exec(rest) ?? quotedRe.exec(rest);
        if (m) {
          const valueStart = i + m[1].length + m[2].length;
          const valueEnd = simpleValueEnd(s, valueStart);
          if (valueEnd === null) return null;
          return (
            s.slice(0, valueStart) +
            alpineDataValueLiteral(nextValue) +
            s.slice(valueEnd)
          );
        }
      }
    }

    if (c === '"' || c === "'" || c === "`") {
      skipString(c);
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      i += 2;
      while (i < n && s[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < n && !(s[i] === "*" && s[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    if (c === "{" || c === "[" || c === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      depth -= 1;
      i += 1;
      continue;
    }

    i += 1;
  }

  return null;
}

function lastNonSpaceBefore(s: string, i: number): string {
  let j = i - 1;
  while (j >= 0 && /\s/.test(s[j]!)) j -= 1;
  return j >= 0 ? s[j]! : "";
}

function simpleValueEnd(s: string, start: number): number | null {
  const c = s[start];
  if (c === "'" || c === '"') {
    let i = start + 1;
    while (i < s.length) {
      if (s[i] === "\\") {
        i += 2;
        continue;
      }
      if (s[i] === c) return i + 1;
      i += 1;
    }
    return null;
  }
  const m = /^[A-Za-z0-9_.+-]+/.exec(s.slice(start));
  if (!m) return null;
  const token = m[0];
  const isBoolean = token === "true" || token === "false";
  const isNumber = /^-?\d+(\.\d+)?$/.test(token);
  if (!isBoolean && !isNumber) return null;
  return start + token.length;
}

export function canRebuildAlpineDataLosslessly(
  xData: string | null | undefined,
): boolean {
  const trimmed = (xData ?? "").trim();
  if (!trimmed || trimmed === "{}" || trimmed === "{ }") return true;
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;

  const parsed = parseAlpineDataObject(trimmed);
  if (!parsed) return false;

  const reserialized = serializeAlpineDataObject(parsed);
  const reparsed = parseAlpineDataObject(reserialized);
  if (!reparsed) return false;
  const keysA = Object.keys(parsed).sort().join(",");
  const keysB = Object.keys(reparsed).sort().join(",");
  if (keysA !== keysB) return false;

  return countTopLevelKeys(trimmed) === Object.keys(parsed).length;
}

function countTopLevelKeys(xData: string): number {
  const s = xData;
  const n = s.length;
  let depth = 0;
  let i = 0;
  let count = 0;
  let sawTokenInSlot = false;

  const skipString = (quote: string): void => {
    i += 1;
    while (i < n) {
      if (s[i] === "\\") {
        i += 2;
        continue;
      }
      if (s[i] === quote) {
        i += 1;
        return;
      }
      i += 1;
    }
  };

  while (i < n) {
    const c = s[i]!;
    if (c === '"' || c === "'" || c === "`") {
      if (depth === 1) sawTokenInSlot = true;
      skipString(c);
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      i += 2;
      while (i < n && s[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < n && !(s[i] === "*" && s[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      if (depth === 1 && c === "}" && sawTokenInSlot) {
        count += 1;
        sawTokenInSlot = false;
      }
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 1) {
      if (c === ",") {
        if (sawTokenInSlot) count += 1;
        sawTokenInSlot = false;
      } else if (!/\s/.test(c)) {
        sawTokenInSlot = true;
      }
    }
    i += 1;
  }
  return count;
}

export function isBooleanPropValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "true" || v === "false";
}
