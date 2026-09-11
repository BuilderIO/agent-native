import { wrapDiagnosticSnippet } from "../shared/diagnostic-snippet.js";
import {
  applyTargetedReplace,
  findTargetedMatches,
  type TargetedAmbiguousMatch,
  type TargetedCandidate,
  type TargetedMatchesResult,
} from "../shared/targeted-text-edit.js";

export type ExtensionLegacyPatch = {
  find: string;
  replace: string;
  all?: boolean;
  expectedMatches?: number;
  required?: boolean;
};

export type ExtensionContentEdit =
  | {
      op?: "replace";
      find: string;
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
      op: "replace-section";
      section: string;
      content: string;
      keepMarkers?: boolean;
      required?: boolean;
    }
  | {
      op: "wrap-section";
      section: string;
      before: string;
      after: string;
      keepMarkers?: boolean;
      required?: boolean;
    }
  | {
      op: "remove-section";
      section: string;
      keepMarkers?: boolean;
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

export class ExtensionContentEditError extends Error {
  readonly code = "extension_content_edit_failed";

  constructor(message: string) {
    super(message);
    this.name = "ExtensionContentEditError";
  }
}

export interface ExtensionContentUpdateOpts {
  content?: string;
  patches?: ExtensionLegacyPatch[];
  edits?: ExtensionContentEdit[];
  format?: boolean;
}

export interface ExtensionContentUpdateResult {
  content: string;
  applied: string[];
  formatted: boolean;
}

export async function applyExtensionContentUpdate(
  currentContent: string,
  opts: ExtensionContentUpdateOpts,
): Promise<ExtensionContentUpdateResult> {
  try {
    return await applyExtensionContentUpdateUnchecked(currentContent, opts);
  } catch (error) {
    if (error instanceof ExtensionContentEditError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ExtensionContentEditError(message);
  }
}

async function applyExtensionContentUpdateUnchecked(
  currentContent: string,
  opts: ExtensionContentUpdateOpts,
): Promise<ExtensionContentUpdateResult> {
  let content = opts.content ?? currentContent;
  const applied: string[] = [];

  for (const patch of opts.patches ?? []) {
    const edit: ExtensionContentEdit = {
      op: "replace",
      find: patch.find,
      replace: patch.replace,
      all: patch.all,
      expectedMatches: patch.expectedMatches,
      required: patch.required,
    };
    const result = applyEdit(content, edit);
    content = result.content;
    applied.push(result.summary);
  }

  for (const edit of opts.edits ?? []) {
    const result = applyEdit(content, edit);
    content = result.content;
    applied.push(result.summary);
  }

  let formatted = false;
  if (opts.format) {
    content = await formatExtensionHtml(content);
    formatted = true;
  }

  return { content, applied, formatted };
}

export async function formatExtensionHtml(content: string): Promise<string> {
  try {
    // prettier's main entry `import()`s all 13 parser plugins, so a bundler
    // inlines ~3.5MB of flow/typescript/yaml/markdown parsers just to format
    // HTML. Load the standalone core plus only the plugins the HTML printer
    // reaches, which still formats embedded <style> (postcss) and <script>
    // (babel + estree).
    const [{ format }, ...plugins] = await Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/html"),
      import("prettier/plugins/postcss"),
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
    ]);
    const formatted = await format(content, {
      parser: "html",
      htmlWhitespaceSensitivity: "ignore",
      plugins,
    });
    return typeof formatted === "string" ? formatted : content;
  } catch (err: any) {
    const message = String(err?.message ?? err);
    if (
      message.includes("Cannot find package 'prettier'") ||
      message.includes('Cannot find package "prettier"') ||
      message.includes("Cannot find module 'prettier'") ||
      message.includes('Cannot find module "prettier"')
    ) {
      return content;
    }
    throw new Error(
      `Unable to format extension HTML with Prettier: ${message}`,
    );
  }
}

function applyEdit(
  content: string,
  edit: ExtensionContentEdit,
): { content: string; summary: string } {
  const op = edit.op ?? "replace";
  switch (op) {
    case "replace":
      return applyLiteralReplace(
        content,
        edit as Extract<ExtensionContentEdit, { op?: "replace" }>,
      );
    case "insert-before":
    case "insert-after":
      return applyInsert(
        content,
        edit as Extract<
          ExtensionContentEdit,
          { op: "insert-before" | "insert-after" }
        >,
      );
    case "replace-between":
      return applyReplaceBetween(
        content,
        edit as Extract<ExtensionContentEdit, { op: "replace-between" }>,
      );
    case "replace-section":
    case "wrap-section":
    case "remove-section":
      return applySectionEdit(
        content,
        edit as Extract<
          ExtensionContentEdit,
          { op: "replace-section" | "wrap-section" | "remove-section" }
        >,
      );
    case "regex-replace":
      return applyRegexReplace(
        content,
        edit as Extract<ExtensionContentEdit, { op: "regex-replace" }>,
      );
    default:
      throw new Error(`Unsupported extension edit operation: ${String(op)}`);
  }
}

function applyLiteralReplace(
  content: string,
  edit: Extract<ExtensionContentEdit, { op?: "replace" }>,
): { content: string; summary: string } {
  if (!edit.find) throw new Error("Patch find/marker text cannot be empty");

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
    throw new Error(
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

function applyInsert(
  content: string,
  edit: Extract<ExtensionContentEdit, { op: "insert-before" | "insert-after" }>,
): { content: string; summary: string } {
  if (!edit.marker) throw new Error("Patch find/marker text cannot be empty");

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
    throw new Error(
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
    throw new Error(`${op} ${formatAmbiguousMatches(result.matches)}`);
  }
  if (result.reason === "invalid_occurrence") {
    throw new Error(
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
      throw new Error(
        `${op} expected ${expectedMatches} match(es), found ${result.matchCount}`,
      );
    }
    throw new Error(`${op} could not find occurrence ${result.occurrence}`);
  }
  const expected =
    expectedMatches !== undefined
      ? `${op} expected ${expectedMatches} match(es), found 0.`
      : `${op} found no matches.`;
  throw new Error(`${expected}${formatCandidates(result.candidates)}`);
}

// Candidate/ambiguous text below is echoed from the user's own extension
// content, not a system diagnostic — wrap it so production-agent's
// permanent-precondition classifier (broad phrases like "no authenticated
// user", column-0-anchored) never mistakes quoted file content for a real
// signal and stops the turn on a false positive.
function formatCandidates(candidates: TargetedCandidate[]): string {
  if (candidates.length === 0) return "";
  const lines = candidates.map((c) => `line ${c.line}: ${c.text}`).join("\n");
  return `\nClosest matches in the current extension:\n${wrapDiagnosticSnippet(lines)}`;
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
  edit: Extract<ExtensionContentEdit, { op: "replace-between" }>,
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
    throw new Error(
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

function applySectionEdit(
  content: string,
  edit: Extract<
    ExtensionContentEdit,
    { op: "replace-section" | "wrap-section" | "remove-section" }
  >,
): { content: string; summary: string } {
  const section = findSection(content, edit.section);
  const required = edit.required !== false;
  if (!section) {
    if (required) throw new Error(`Section not found: ${edit.section}`);
    return { content, summary: `${edit.op}:0` };
  }

  const keepMarkers = edit.keepMarkers !== false;
  const replaceStart = keepMarkers ? section.innerStart : section.start;
  const replaceEnd = keepMarkers ? section.innerEnd : section.end;
  const inner = content.slice(section.innerStart, section.innerEnd);
  let replacement = "";

  if (edit.op === "replace-section") {
    replacement = edit.content;
  } else if (edit.op === "wrap-section") {
    replacement = edit.before + inner + edit.after;
  } else {
    replacement = "";
  }

  return {
    content:
      content.slice(0, replaceStart) + replacement + content.slice(replaceEnd),
    summary: `${edit.op}:${edit.section}`,
  };
}

function applyRegexReplace(
  content: string,
  edit: Extract<ExtensionContentEdit, { op: "regex-replace" }>,
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
    throw new Error(`${op} expected ${expected} match(es), found ${actual}`);
  }
  if (expected === undefined && required !== false && actual === 0) {
    throw new Error(`${op} found no matches`);
  }
}

function findBetweenRanges(
  content: string,
  startMarker: string,
  endMarker: string,
): Array<{ start: number; innerStart: number; innerEnd: number; end: number }> {
  if (!startMarker || !endMarker) {
    throw new Error("replace-between requires non-empty start and end markers");
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
      throw new Error("replace-between found a start marker without an end");
    }
    const end = innerEnd + endMarker.length;
    ranges.push({ start, innerStart, innerEnd, end });
    cursor = end;
  }
  return ranges;
}

function findSection(
  content: string,
  sectionId: string,
): { start: number; innerStart: number; innerEnd: number; end: number } | null {
  if (!sectionId.trim()) throw new Error("section id cannot be empty");
  const escaped = escapeRegex(sectionId.trim());
  const startRe = new RegExp(
    `<!--\\s*(?:agent-native:section\\s+${escaped}|section:${escaped}|section\\s+${escaped})\\s*-->`,
  );
  const startMatch = startRe.exec(content);
  if (!startMatch || startMatch.index === undefined) return null;

  const endRe = new RegExp(
    `<!--\\s*/(?:agent-native:section\\s+${escaped}|section:${escaped}|section\\s+${escaped})\\s*-->`,
  );
  endRe.lastIndex = startMatch.index + startMatch[0].length;
  const rest = content.slice(startMatch.index + startMatch[0].length);
  const endMatch = endRe.exec(rest);
  if (!endMatch || endMatch.index === undefined) {
    throw new Error(`Section ${sectionId} has a start marker without an end`);
  }

  const start = startMatch.index;
  const innerStart = startMatch.index + startMatch[0].length;
  const innerEnd = innerStart + endMatch.index;
  const end = innerEnd + endMatch[0].length;
  return { start, innerStart, innerEnd, end };
}

function normalizeRegexFlags(flags: string | undefined, all?: boolean): string {
  const unique = new Set((flags ?? "").split("").filter(Boolean));
  if (all) unique.add("g");
  return Array.from(unique).join("");
}

function ensureGlobal(flags: string): string {
  return flags.includes("g") ? flags : `${flags}g`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
