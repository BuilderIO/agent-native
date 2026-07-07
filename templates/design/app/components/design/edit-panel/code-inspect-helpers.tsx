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

export function normalizedElementTagName(
  tagName: string | null | undefined,
): string {
  return tagName?.trim().toLowerCase() || "element";
}

/** Build a `vscode://file/...` deep link for an absolute path + position. */
export function vscodeDeepLink(
  absolutePath: string,
  line?: number,
  column?: number,
): string {
  const base = `vscode://file/${absolutePath}`;
  if (line == null) return base;
  return column == null ? `${base}:${line}` : `${base}:${line}:${column}`;
}

/**
 * Extract the *opening tag* from an element's outer HTML for an at-a-glance
 * summary (e.g. `<main class="hero" data-x="y">`). Self-closing tags keep
 * their `/>`. Returns `null` when no tag can be parsed.
 *
 * Pure — exported for tests.
 */
export function openingTagOf(html: string | null | undefined): string | null {
  if (!html) return null;
  const trimmed = html.trimStart();
  // Match the first `<tag ...>` (greedy up to the first unquoted `>`), allowing
  // quoted attribute values to contain `>`.
  const match = /^<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*?)\/?>/.exec(
    trimmed,
  );
  if (!match) return null;
  return match[0];
}

/**
 * Collapse long attribute values in an opening tag so the at-a-glance summary
 * stays readable. Values longer than `max` chars are truncated with an
 * ellipsis (the surrounding quotes are preserved).
 *
 * Pure — exported for tests.
 */
export function truncateOpeningTag(openTag: string, max = 32): string {
  return openTag.replace(
    /("|')((?:\\.|(?!\1)[^\\])*)\1/g,
    (full, quote, value) => {
      if (typeof value !== "string" || value.length <= max) return full;
      return `${quote}${value.slice(0, max - 1)}…${quote}`;
    },
  );
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

export function elementHtmlPreview(
  data: Pick<InspectCodeData, "html" | "tagName" | "id" | "classes">,
): string | null {
  const openingTag = openingTagOf(data.html);
  const hasFallbackMetadata = Boolean(
    data.tagName?.trim() ||
    data.id?.trim() ||
    data.classes?.some((item) => item.trim()),
  );
  if (!openingTag && !hasFallbackMetadata) return null;
  const previewOpeningTag = openingTag ?? fallbackOpeningTag(data);
  const tagName =
    tagNameFromOpeningTag(previewOpeningTag) ??
    normalizedElementTagName(data.tagName);
  if (isSelfClosingOpeningTag(previewOpeningTag, tagName)) {
    return previewOpeningTag;
  }
  return `${previewOpeningTag}\n  ...\n</${tagName}>`;
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

/**
 * Parse the top-level `key: value` pairs from an Alpine `x-data` object literal
 * (e.g. `{ variant: 'outline', size: 'lg', disabled: false }`).
 *
 * Best-effort: only handles a flat object of simple string / boolean / number
 * literals — exactly the shape used for component variant + state props. Nested
 * objects, methods, and computed expressions are ignored. Returns `null` when
 * the value is not a recognizable flat object literal.
 *
 * Pure — exported for tests.
 */
export function parseAlpineDataObject(
  xData: string | null | undefined,
): Record<string, string> | null {
  if (!xData) return null;
  const trimmed = xData.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return {};

  const out: Record<string, string> = {};
  // Split on top-level commas only (no nesting / quotes inside values here).
  const pairRe =
    /(?:^|,)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*('[^']*'|"[^"]*"|true|false|-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = pairRe.exec(inner)) !== null) {
    matched = true;
    const key = m[1] ?? m[2] ?? m[3];
    let raw = m[4]!;
    // Unwrap quotes for string literals; keep booleans / numbers verbatim.
    if (
      (raw.startsWith("'") && raw.endsWith("'")) ||
      (raw.startsWith('"') && raw.endsWith('"'))
    ) {
      raw = raw.slice(1, -1);
    }
    if (key) out[key] = raw;
  }
  // If there was content but nothing parsed, the shape is too complex to edit
  // safely — bail so the caller falls back to attribute-based prop edits.
  if (!matched) return null;
  return out;
}

/**
 * Re-serialize a flat Alpine data object back into an `x-data` literal,
 * preserving boolean / number literals unquoted and single-quoting strings.
 *
 * Pure — exported for tests.
 */
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

/**
 * Format a single editable prop value as an `x-data` literal: bare for
 * boolean / number values, single-quoted (with escaping) for strings.
 *
 * Pure — exported for tests.
 */
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
  // Walk the whole string tracking nesting depth and skipping over strings,
  // template literals, regex-ish slashes are not handled (Alpine x-data does
  // not use them at the object-key level), and line / block comments. Only at
  // object depth 1 (directly inside the outermost `{ … }`) do we look for the
  // target `key :` token.
  let depth = 0;
  let i = 0;

  /** Advance `i` past a quoted string starting at `i` (handles escapes). */
  const skipString = (quote: string): void => {
    i += 1; // opening quote
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
  // Bare identifier key at a token boundary: `key` then optional ws then `:`.
  const bareRe = new RegExp(`^(${escapedKey})(\\s*:\\s*)`);
  // Quoted key: `'key'` or `"key"` then optional ws then `:`.
  const quotedRe = new RegExp(`^(['"]${escapedKey}['"])(\\s*:\\s*)`);

  while (i < n) {
    const c = s[i];

    // At the top level, a `{` / `,` (or the string start) opens a fresh value
    // slot. Try to match the target key here *before* treating a quote as an
    // opaque string — this is how quoted keys (`'size': …`) are recognised.
    if (depth === 1) {
      const prev = lastNonSpaceBefore(s, i);
      if (prev === "{" || prev === ",") {
        const rest = s.slice(i);
        const m = bareRe.exec(rest) ?? quotedRe.exec(rest);
        if (m) {
          const valueStart = i + m[1].length + m[2].length;
          const valueEnd = simpleValueEnd(s, valueStart);
          if (valueEnd === null) return null; // value is not a simple literal
          return (
            s.slice(0, valueStart) +
            alpineDataValueLiteral(nextValue) +
            s.slice(valueEnd)
          );
        }
      }
    }

    // Skip strings / template literals wholesale.
    if (c === '"' || c === "'" || c === "`") {
      skipString(c);
      continue;
    }
    // Skip comments.
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

/** Last non-whitespace char strictly before index `i` (or `""`). */
function lastNonSpaceBefore(s: string, i: number): string {
  let j = i - 1;
  while (j >= 0 && /\s/.test(s[j]!)) j -= 1;
  return j >= 0 ? s[j]! : "";
}

/**
 * Given the start index of a value in an `x-data` literal, return the index
 * just past a *simple* literal value (single/double-quoted string with
 * escapes, boolean, or number). Returns `null` when the value is anything else
 * (an expression, function, object, array, template literal, etc.) so the
 * caller can fail safe rather than mangle it.
 */
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
    return null; // unterminated string
  }
  // Boolean / number: read the bare token, then confirm it is exactly one.
  const m = /^[A-Za-z0-9_.+-]+/.exec(s.slice(start));
  if (!m) return null;
  const token = m[0];
  const isBoolean = token === "true" || token === "false";
  const isNumber = /^-?\d+(\.\d+)?$/.test(token);
  if (!isBoolean && !isNumber) return null;
  return start + token.length;
}

/**
 * True when an `x-data` literal can be rebuilt from its flat parsed map with
 * no loss — i.e. there is nothing richer than the simple `key: literal` pairs
 * that `serializeAlpineDataObject` already round-trips. Used as the gate for
 * falling back to a full rebuild when a surgical single-key replace is not
 * possible (e.g. when adding a brand-new key).
 *
 * Returns `true` for an empty / absent literal (nothing to lose) and for a
 * flat object whose `parse → serialize` round-trip is semantically stable.
 * Returns `false` when the original holds methods, nested objects, comments,
 * or expressions that a rebuild would silently drop.
 *
 * Pure — exported for tests.
 */
export function canRebuildAlpineDataLosslessly(
  xData: string | null | undefined,
): boolean {
  const trimmed = (xData ?? "").trim();
  // No object literal at all → there is nothing richer to preserve.
  if (!trimmed || trimmed === "{}" || trimmed === "{ }") return true;
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;

  const parsed = parseAlpineDataObject(trimmed);
  if (!parsed) return false;

  // Re-serialize and re-parse; if the round-trip is stable AND the parsed map
  // accounts for every top-level key actually present in the original, a
  // rebuild loses nothing.
  const reserialized = serializeAlpineDataObject(parsed);
  const reparsed = parseAlpineDataObject(reserialized);
  if (!reparsed) return false;
  const keysA = Object.keys(parsed).sort().join(",");
  const keysB = Object.keys(reparsed).sort().join(",");
  if (keysA !== keysB) return false;

  // Guard against dropped content the flat parser ignores (e.g. a trailing
  // method): the number of top-level `key:` tokens in the original must match
  // the number of parsed keys. Count top-level `:` separators conservatively.
  return countTopLevelKeys(trimmed) === Object.keys(parsed).length;
}

/**
 * Count top-level `key:` entries in an `x-data` object literal, skipping
 * strings, comments, and nested braces/brackets/parens. A method like
 * `toggle() { … }` is counted as a key too (its `:`-less form still occupies a
 * top-level slot), so a mismatch against the flat parser's key count reveals
 * dropped content.
 */
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

/** A boolean-ish prop value (`"true"` / `"false"`), case-insensitive. */
export function isBooleanPropValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "true" || v === "false";
}
