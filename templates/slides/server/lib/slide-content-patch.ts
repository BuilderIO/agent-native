import {
  applyTargetedReplace,
  findTargetedMatches,
  wrapDiagnosticSnippet,
  type TargetedAmbiguousMatch,
  type TargetedCandidate,
  type TargetedMatchesResult,
} from "@agent-native/core/shared";

export type SlideContentEdit =
  | {
      op?: "replace";
      find?: string;
      objectId?: string;
      replace: string;
      all?: boolean;
      occurrence?: number;
      expectedMatches?: number;
      required?: boolean;
    }
  | {
      op: "insert-before" | "insert-after";
      marker: string;
      content: string;
      occurrence?: number;
      expectedMatches?: number;
      required?: boolean;
    }
  | {
      op: "replace-between";
      start: string;
      end: string;
      content: string;
      includeDelimiters?: boolean;
      expectedMatches?: number;
      required?: boolean;
    }
  | {
      op: "regex-replace";
      pattern: string;
      replace: string;
      flags?: string;
      all?: boolean;
      expectedMatches?: number;
      required?: boolean;
    };

export class SlideContentEditError extends Error {
  readonly code = "slide_content_edit_failed";
  // Every failure here names the caller's mistake — an unmatched `find`, a bad
  // occurrence, an expectedMatches miss. The action route flattens any error it
  // cannot recognise to "Internal server error", so without these three fields
  // the agent is told the server broke and retries the identical arguments
  // instead of re-reading the slide. Duck-typed to match `isActionContractError`
  // rather than importing `fail()`, which would pull the action layer into a lib
  // the editor also imports.
  readonly actionContractError = true;
  readonly errorCode = "slide_content_edit_failed";
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "SlideContentEditError";
  }
}

export interface SlideContentPatchResult {
  content: string;
  applied: string[];
  formatted: boolean;
  changed: boolean;
}

/**
 * Applies every edit to an in-memory string before the caller persists it.
 * A failed edit throws, so callers never write a partially applied patch list.
 */
export async function applySlideContentEdits(
  currentContent: string,
  edits: readonly SlideContentEdit[],
  format = false,
): Promise<SlideContentPatchResult> {
  let content = currentContent;
  const applied: string[] = [];
  try {
    for (const edit of edits) {
      const result = applyEdit(content, edit);
      content = result.content;
      applied.push(result.summary);
    }
  } catch (error) {
    if (error instanceof SlideContentEditError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new SlideContentEditError(message);
  }

  const changed = content !== currentContent;
  if (format) {
    content = await formatSlideHtml(content);
  }

  return { content, applied, formatted: format, changed };
}

export async function formatSlideHtml(content: string): Promise<string> {
  try {
    // prettier's main entry `import()`s all 13 parser plugins, so a bundler
    // inlines ~3.5MB of flow/typescript/yaml/markdown parsers just to format
    // HTML. Load the standalone core plus only the plugins the HTML printer
    // reaches, which still formats embedded <style> and <script>.
    const [{ format }, ...plugins] = await Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/html"),
      import("prettier/plugins/postcss"),
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
    ]);
    return await format(content, {
      parser: "html",
      htmlWhitespaceSensitivity: "ignore",
      plugins,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("Cannot find package 'prettier'") ||
      message.includes('Cannot find package "prettier"') ||
      message.includes("Cannot find module 'prettier'") ||
      message.includes('Cannot find module "prettier"')
    ) {
      throw new Error(
        "HTML formatting is unavailable because Prettier is not installed",
      );
    }
    throw new Error(`Unable to format slide HTML: ${message}`);
  }
}

function applyEdit(
  content: string,
  edit: SlideContentEdit,
): { content: string; summary: string } {
  switch (edit.op ?? "replace") {
    case "replace":
      return applyLiteralReplace(
        content,
        edit as Extract<SlideContentEdit, { op?: "replace" }>,
      );
    case "insert-before":
    case "insert-after":
      return applyInsert(
        content,
        edit as Extract<
          SlideContentEdit,
          { op: "insert-before" | "insert-after" }
        >,
      );
    case "replace-between":
      return applyReplaceBetween(
        content,
        edit as Extract<SlideContentEdit, { op: "replace-between" }>,
      );
    case "regex-replace":
      return applyRegexReplace(
        content,
        edit as Extract<SlideContentEdit, { op: "regex-replace" }>,
      );
    default:
      throw new SlideContentEditError(
        `Unsupported slide content edit operation: ${String(edit.op)}`,
      );
  }
}

function applyLiteralReplace(
  content: string,
  edit: Extract<SlideContentEdit, { op?: "replace" }>,
): { content: string; summary: string } {
  if (edit.objectId !== undefined) {
    if (edit.find !== undefined) {
      throw new SlideContentEditError(
        "A replace edit must use either find or objectId, not both",
      );
    }
    if (edit.all !== undefined || edit.occurrence !== undefined) {
      throw new SlideContentEditError(
        "objectId replacement does not support all or occurrence",
      );
    }
    if (edit.expectedMatches !== undefined && edit.expectedMatches !== 1) {
      throw new SlideContentEditError(
        `objectId replacement expected 1 match(es), found ${edit.expectedMatches}`,
      );
    }
    return applyObjectReplace(content, edit.objectId, edit.replace);
  }

  if (!edit.find) {
    throw new SlideContentEditError("Patch find/marker text cannot be empty");
  }

  const result = applyTargetedReplace(content, edit.find, edit.replace, {
    occurrence: edit.occurrence,
    all: edit.all,
  });

  if (!result.ok) {
    if (result.reason === "not_found" && isCountedNoOp(edit)) {
      return { content, summary: "replace:0" };
    }
    throwLiteralMatchFailure("replace", result, edit.expectedMatches);
  }

  if (
    edit.expectedMatches !== undefined &&
    result.matchCount !== edit.expectedMatches
  ) {
    throw new SlideContentEditError(
      `replace expected ${edit.expectedMatches} match(es), found ${result.matchCount}`,
    );
  }

  const summary =
    edit.occurrence !== undefined
      ? `replace:nth:${edit.occurrence}`
      : edit.all
        ? `replace:all:${result.matchCount}`
        : "replace:first";
  return { content: result.content, summary };
}

const RAW_TEXT_TAG_NAMES = new Set(["script", "style", "textarea", "title"]);
const VOID_TAG_NAMES = new Set([
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

function applyObjectReplace(
  content: string,
  objectId: string,
  replacement: string,
): { content: string; summary: string } {
  const targets = findObjectTargets(content, objectId);
  if (targets.length === 0) {
    throw new SlideContentEditError(
      `objectId "${objectId}" found no matching slide object`,
    );
  }
  if (targets.length > 1) {
    throw new SlideContentEditError(
      `objectId "${objectId}" matched ${targets.length} slide objects; object IDs must be unique`,
    );
  }

  const target = targets[0]!;
  if (target.isVoid) {
    throw new SlideContentEditError(
      `objectId "${objectId}" targets <${target.tagName}>, which has no editable text content`,
    );
  }
  return {
    content:
      content.slice(0, target.innerStart) +
      replacement +
      content.slice(target.innerEnd),
    summary: "replace:object",
  };
}

function findObjectTargets(
  html: string,
  objectId: string,
): Array<{
  innerStart: number;
  innerEnd: number;
  tagName: string;
  isVoid: boolean;
}> {
  const targets: Array<{
    innerStart: number;
    innerEnd: number;
    tagName: string;
    isVoid: boolean;
  }> = [];
  let cursor = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart === -1) break;
    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      cursor = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }

    const nameStart = tagStart + 1;
    const tagName = tagNameAt(html, nameStart);
    if (!tagName) {
      cursor = tagStart + 1;
      continue;
    }
    const tagEnd = tagEndIndex(html, nameStart + tagName.length);
    if (tagEnd === -1) {
      throw new SlideContentEditError(
        `objectId "${objectId}" cannot be resolved because the slide HTML has an unclosed tag`,
      );
    }
    const openingTag = html.slice(tagStart, tagEnd + 1);
    if (hasObjectId(openingTag, objectId)) {
      const isVoid = isVoidTag(tagName);
      if (isVoid) {
        targets.push({
          innerStart: tagEnd + 1,
          innerEnd: tagEnd + 1,
          tagName,
          isVoid,
        });
      } else {
        const closing = findMatchingCloseTag(html, tagName, tagEnd + 1);
        if (!closing) {
          throw new SlideContentEditError(
            `objectId "${objectId}" targets <${tagName}> without a closing tag`,
          );
        }
        targets.push({
          innerStart: tagEnd + 1,
          innerEnd: closing.start,
          tagName,
          isVoid,
        });
      }
    }

    if (RAW_TEXT_TAG_NAMES.has(tagName) && !isVoidTag(tagName)) {
      const rawClose = rawTextCloseIndex(html, tagName, tagEnd + 1);
      cursor = rawClose === -1 ? html.length : rawClose + tagName.length + 3;
    } else {
      cursor = tagEnd + 1;
    }
  }

  return targets;
}

function hasObjectId(tag: string, objectId: string): boolean {
  const tagName = /^<[A-Za-z][\w:-]*/.exec(tag)?.[0];
  if (!tagName) return false;

  let cursor = tagName.length;
  while (cursor < tag.length) {
    while (/\s/.test(tag[cursor] ?? "")) cursor += 1;
    if (tag[cursor] === "/" || tag[cursor] === ">") break;

    const attributeStart = cursor;
    while (cursor < tag.length && !/[\s=>/]/.test(tag[cursor] ?? "")) {
      cursor += 1;
    }
    const attributeName = tag.slice(attributeStart, cursor).toLowerCase();
    while (/\s/.test(tag[cursor] ?? "")) cursor += 1;
    if (tag[cursor] !== "=") {
      while (cursor < tag.length && !/[\s>]/.test(tag[cursor] ?? "")) {
        cursor += 1;
      }
      continue;
    }

    cursor += 1;
    while (/\s/.test(tag[cursor] ?? "")) cursor += 1;
    const quote =
      tag[cursor] === '"' || tag[cursor] === "'" ? tag[cursor] : null;
    if (quote) cursor += 1;
    const valueStart = cursor;
    if (quote) {
      while (cursor < tag.length && tag[cursor] !== quote) cursor += 1;
    } else {
      while (cursor < tag.length && !/[\s>]/.test(tag[cursor] ?? "")) {
        cursor += 1;
      }
    }
    const value = tag.slice(valueStart, cursor);
    if (quote && tag[cursor] === quote) cursor += 1;
    if (attributeName === "data-slide-object-id" && value === objectId) {
      return true;
    }
  }

  return false;
}

function findMatchingCloseTag(
  html: string,
  tagName: string,
  start: number,
): { start: number; end: number } | null {
  if (RAW_TEXT_TAG_NAMES.has(tagName)) {
    const rawClose = rawTextCloseIndex(html, tagName, start);
    return rawClose === -1
      ? null
      : { start: rawClose, end: rawClose + tagName.length + 3 };
  }

  let depth = 1;
  let cursor = start;
  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart === -1) break;
    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      cursor = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }

    const closing = html[tagStart + 1] === "/";
    const nameStart = tagStart + (closing ? 2 : 1);
    const nestedTagName = tagNameAt(html, nameStart);
    if (!nestedTagName) {
      cursor = tagStart + 1;
      continue;
    }
    const tagEnd = tagEndIndex(html, nameStart + nestedTagName.length);
    if (tagEnd === -1) return null;

    if (closing && nestedTagName === tagName) {
      depth -= 1;
      if (depth === 0) {
        return { start: tagStart, end: tagEnd + 1 };
      }
    } else if (
      !closing &&
      nestedTagName === tagName &&
      !isVoidTag(nestedTagName)
    ) {
      depth += 1;
    }

    if (!closing && RAW_TEXT_TAG_NAMES.has(nestedTagName)) {
      const rawClose = rawTextCloseIndex(html, nestedTagName, tagEnd + 1);
      cursor =
        rawClose === -1 ? html.length : rawClose + nestedTagName.length + 3;
    } else {
      cursor = tagEnd + 1;
    }
  }

  return null;
}

function isVoidTag(tagName: string): boolean {
  return VOID_TAG_NAMES.has(tagName);
}

function tagEndIndex(html: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function tagNameAt(html: string, start: number): string | null {
  const match = /^[A-Za-z][\w:-]*/.exec(html.slice(start));
  return match?.[0]?.toLowerCase() ?? null;
}

function rawTextCloseIndex(
  html: string,
  tagName: string,
  start: number,
): number {
  const pattern = new RegExp(`<\\/${tagName}\\s*>`, "gi");
  pattern.lastIndex = start;
  return pattern.exec(html)?.index ?? -1;
}

function applyInsert(
  content: string,
  edit: Extract<SlideContentEdit, { op: "insert-before" | "insert-after" }>,
): { content: string; summary: string } {
  if (!edit.marker) {
    throw new SlideContentEditError("Patch find/marker text cannot be empty");
  }

  // Only pass occurrence when the caller actually gave one — defaulting it
  // here would suppress the helper's ambiguity check for a repeated marker
  // and silently insert at the first hit.
  const result = findTargetedMatches(content, edit.marker, {
    occurrence: edit.occurrence,
  });

  if (!result.ok) {
    if (result.reason === "not_found" && isCountedNoOp(edit)) {
      return { content, summary: `${edit.op}:0` };
    }
    throwLiteralMatchFailure(edit.op, result, edit.expectedMatches);
  }

  const { matches } = result;
  if (
    edit.expectedMatches !== undefined &&
    matches.length !== edit.expectedMatches
  ) {
    throw new SlideContentEditError(
      `${edit.op} expected ${edit.expectedMatches} match(es), found ${matches.length}`,
    );
  }

  // occurrence, if given, was already validated (positive integer, in range)
  // by findTargetedMatches above — an out-of-range value returns
  // "occurrence_out_of_range" and is handled in the !result.ok branch.
  const occurrence = edit.occurrence ?? 1;
  const match = matches[occurrence - 1]!;
  const insertAt = edit.op === "insert-before" ? match.index : match.end;
  return {
    content:
      content.slice(0, insertAt) + edit.content + content.slice(insertAt),
    summary: `${edit.op}:${occurrence}`,
  };
}

/** A literal-find edit is a no-op (not an error) on zero matches when the
 * caller either asserted `expectedMatches: 0` or opted out with
 * `required: false` and didn't assert a count at all. */
function isCountedNoOp(edit: {
  expectedMatches?: number;
  required?: boolean;
}): boolean {
  return (
    edit.expectedMatches === 0 ||
    (edit.expectedMatches === undefined && edit.required === false)
  );
}

/**
 * Shared not-found / ambiguous / invalid-occurrence / out-of-range reporting
 * for the literal-find ops (replace, insert-before, insert-after). Always
 * throws — callers check the `required`/`expectedMatches` no-op case
 * themselves before reaching here (and only for a true "not_found": matches
 * exist for "occurrence_out_of_range", so that is never a no-op).
 */
function throwLiteralMatchFailure(
  op: string,
  result: Extract<TargetedMatchesResult, { ok: false }>,
  expectedMatches: number | undefined,
): never {
  if (result.reason === "ambiguous") {
    throw new SlideContentEditError(
      `${op} ${formatAmbiguousMatches(result.matches)}`,
    );
  }
  if (result.reason === "invalid_occurrence") {
    throw new SlideContentEditError(
      `${op} occurrence must be a positive integer, got ${result.occurrence}`,
    );
  }
  if (result.reason === "occurrence_out_of_range") {
    // Restores the pre-helper validation order: an expectedMatches mismatch
    // against the REAL total count is reported before the occurrence miss.
    if (
      expectedMatches !== undefined &&
      result.matchCount !== expectedMatches
    ) {
      throw new SlideContentEditError(
        `${op} expected ${expectedMatches} match(es), found ${result.matchCount}`,
      );
    }
    throw new SlideContentEditError(
      `${op} could not find occurrence ${result.occurrence}`,
    );
  }
  const expected =
    expectedMatches !== undefined
      ? `${op} expected ${expectedMatches} match(es), found 0.`
      : `${op} found no matches.`;
  throw new SlideContentEditError(
    `${expected}${formatCandidates(result.candidates)}`,
  );
}

// Candidate/ambiguous text below is echoed from the user's own slide
// content, not a system diagnostic — wrap it so production-agent's
// permanent-precondition classifier (broad phrases like "no authenticated
// user", column-0-anchored) never mistakes quoted file content for a real
// signal and stops the turn on a false positive.
function formatCandidates(candidates: TargetedCandidate[]): string {
  if (candidates.length === 0) return "";
  const lines = candidates.map((c) => `line ${c.line}: ${c.text}`).join("\n");
  return `\nClosest matches in the current slide:\n${wrapDiagnosticSnippet(lines)}`;
}

function formatAmbiguousMatches(matches: TargetedAmbiguousMatch[]): string {
  const lines = matches.map((m) => `line ${m.line}: ${m.snippet}`).join("\n");
  return (
    `matched ${matches.length} places; pass occurrence to pick one, or add ` +
    `more surrounding context so it matches exactly one location:\n${wrapDiagnosticSnippet(lines)}`
  );
}

function applyReplaceBetween(
  content: string,
  edit: Extract<SlideContentEdit, { op: "replace-between" }>,
): { content: string; summary: string } {
  const ranges = findBetweenRanges(content, edit.start, edit.end);
  assertMatchCount(
    "replace-between",
    ranges.length,
    edit.expectedMatches,
    edit.required,
  );
  if (!ranges.length) return { content, summary: "replace-between:0" };
  if (ranges.length > 1 && edit.expectedMatches === undefined) {
    throw new SlideContentEditError(
      `replace-between matched ${ranges.length} ranges; pass expectedMatches to confirm`,
    );
  }

  let next = content;
  for (const range of ranges.slice().reverse()) {
    const start = edit.includeDelimiters ? range.start : range.innerStart;
    const end = edit.includeDelimiters ? range.end : range.innerEnd;
    next = next.slice(0, start) + edit.content + next.slice(end);
  }
  return { content: next, summary: `replace-between:${ranges.length}` };
}

function applyRegexReplace(
  content: string,
  edit: Extract<SlideContentEdit, { op: "regex-replace" }>,
): { content: string; summary: string } {
  const flags = normalizeRegexFlags(edit.flags, edit.all);
  const regex = new RegExp(edit.pattern, flags);
  const countRegex = new RegExp(edit.pattern, ensureGlobal(flags));
  const matches = Array.from(content.matchAll(countRegex)).length;
  assertMatchCount(
    "regex-replace",
    matches,
    edit.expectedMatches,
    edit.required,
  );
  if (matches === 0) return { content, summary: "regex-replace:0" };
  return {
    content: content.replace(regex, edit.replace),
    summary: `regex-replace:${edit.all ? "all" : "first"}:${matches}`,
  };
}

function assertMatchCount(
  op: string,
  actual: number,
  expected: number | undefined,
  required: boolean | undefined,
): void {
  if (expected !== undefined && actual !== expected) {
    throw new SlideContentEditError(
      `${op} expected ${expected} match(es), found ${actual}`,
    );
  }
  if (expected === undefined && required !== false && actual === 0) {
    throw new SlideContentEditError(`${op} found no matches`);
  }
}

function findBetweenRanges(
  content: string,
  startMarker: string,
  endMarker: string,
): Array<{ start: number; innerStart: number; innerEnd: number; end: number }> {
  if (!startMarker || !endMarker) {
    throw new SlideContentEditError(
      "replace-between requires non-empty start and end markers",
    );
  }
  const ranges: Array<{
    start: number;
    innerStart: number;
    innerEnd: number;
    end: number;
  }> = [];
  let cursor = 0;
  while (cursor < content.length) {
    const start = content.indexOf(startMarker, cursor);
    if (start < 0) break;
    const innerStart = start + startMarker.length;
    const innerEnd = content.indexOf(endMarker, innerStart);
    if (innerEnd < 0) {
      throw new SlideContentEditError(
        "replace-between found a start marker without an end",
      );
    }
    const end = innerEnd + endMarker.length;
    ranges.push({ start, innerStart, innerEnd, end });
    cursor = end;
  }
  return ranges;
}

function normalizeRegexFlags(flags: string | undefined, all?: boolean): string {
  const unique = new Set((flags ?? "").split("").filter(Boolean));
  if (all) {
    unique.add("g");
  } else {
    unique.delete("g");
  }
  return Array.from(unique).join("");
}

function ensureGlobal(flags: string): string {
  return flags.includes("g") ? flags : `${flags}g`;
}
