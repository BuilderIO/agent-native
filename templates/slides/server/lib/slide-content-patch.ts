import {
  applyTargetedReplace,
  findTargetedMatches,
  type TargetedAmbiguousMatch,
  type TargetedCandidate,
  type TargetedMatchesResult,
} from "@agent-native/core/shared";

export type SlideContentEdit =
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
  try {
    let content = currentContent;
    const applied: string[] = [];

    for (const edit of edits) {
      const result = applyEdit(content, edit);
      content = result.content;
      applied.push(result.summary);
    }

    const changed = content !== currentContent;

    if (format) {
      content = await formatSlideHtml(content);
    }

    return { content, applied, formatted: format, changed };
  } catch (error) {
    if (error instanceof SlideContentEditError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new SlideContentEditError(message);
  }
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
      throw new SlideContentEditError(
        "HTML formatting is unavailable because Prettier is not installed",
      );
    }
    throw new SlideContentEditError(`Unable to format slide HTML: ${message}`);
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

  const occurrence = edit.occurrence ?? 1;
  const match = matches[occurrence - 1];
  if (!match) {
    throw new SlideContentEditError(
      `${edit.op} could not find occurrence ${occurrence}`,
    );
  }
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
 * Shared not-found / ambiguous / invalid-occurrence reporting for the
 * literal-find ops (replace, insert-before, insert-after). Always throws —
 * callers check the `required`/`expectedMatches` no-op case themselves before
 * reaching here.
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
  const expected =
    expectedMatches !== undefined
      ? `${op} expected ${expectedMatches} match(es), found 0.`
      : `${op} found no matches.`;
  throw new SlideContentEditError(
    `${expected}${formatCandidates(result.candidates)}`,
  );
}

function formatCandidates(candidates: TargetedCandidate[]): string {
  if (candidates.length === 0) return "";
  const lines = candidates.map((c) => `  line ${c.line}: ${c.text}`).join("\n");
  return `\nClosest matches in the current slide:\n${lines}`;
}

function formatAmbiguousMatches(matches: TargetedAmbiguousMatch[]): string {
  const lines = matches.map((m) => `  line ${m.line}: ${m.snippet}`).join("\n");
  return (
    `matched ${matches.length} places; pass occurrence to pick one, or add ` +
    `more surrounding context so it matches exactly one location:\n${lines}`
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
