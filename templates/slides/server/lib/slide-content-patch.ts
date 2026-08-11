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

    if (format) {
      content = await formatSlideHtml(content);
    }

    return { content, applied, formatted: format };
  } catch (error) {
    if (error instanceof SlideContentEditError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new SlideContentEditError(message);
  }
}

export async function formatSlideHtml(content: string): Promise<string> {
  try {
    const prettier = await import("prettier");
    return await prettier.format(content, {
      parser: "html",
      htmlWhitespaceSensitivity: "ignore",
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
  const matches = countOccurrences(content, edit.find);
  assertMatchCount("replace", matches, edit.expectedMatches, edit.required);
  if (matches === 0) return { content, summary: "replace:0" };

  if (edit.occurrence !== undefined) {
    return {
      content: replaceNth(content, edit.find, edit.replace, edit.occurrence),
      summary: `replace:nth:${edit.occurrence}`,
    };
  }

  if (edit.all) {
    return {
      content: content.split(edit.find).join(edit.replace),
      summary: `replace:all:${matches}`,
    };
  }

  return {
    content: content.replace(edit.find, edit.replace),
    summary: "replace:first",
  };
}

function applyInsert(
  content: string,
  edit: Extract<SlideContentEdit, { op: "insert-before" | "insert-after" }>,
): { content: string; summary: string } {
  const matches = countOccurrences(content, edit.marker);
  assertMatchCount(edit.op, matches, edit.expectedMatches, edit.required);
  if (matches === 0) return { content, summary: `${edit.op}:0` };

  const occurrence = edit.occurrence ?? 1;
  const index = nthIndexOf(content, edit.marker, occurrence);
  if (index < 0) {
    throw new SlideContentEditError(
      `${edit.op} could not find occurrence ${occurrence}`,
    );
  }
  const insertAt =
    edit.op === "insert-before" ? index : index + edit.marker.length;
  return {
    content:
      content.slice(0, insertAt) + edit.content + content.slice(insertAt),
    summary: `${edit.op}:${occurrence}`,
  };
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

function countOccurrences(content: string, needle: string): number {
  if (!needle) {
    throw new SlideContentEditError("Patch find/marker text cannot be empty");
  }
  let count = 0;
  let index = 0;
  while (true) {
    index = content.indexOf(needle, index);
    if (index < 0) return count;
    count += 1;
    index += needle.length;
  }
}

function nthIndexOf(
  content: string,
  needle: string,
  occurrence: number,
): number {
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new SlideContentEditError("occurrence must be a positive integer");
  }
  let index = -1;
  let from = 0;
  for (let i = 0; i < occurrence; i += 1) {
    index = content.indexOf(needle, from);
    if (index < 0) return -1;
    from = index + needle.length;
  }
  return index;
}

function replaceNth(
  content: string,
  find: string,
  replace: string,
  occurrence: number,
): string {
  const index = nthIndexOf(content, find, occurrence);
  if (index < 0) {
    throw new SlideContentEditError(
      `replace could not find occurrence ${occurrence}`,
    );
  }
  return content.slice(0, index) + replace + content.slice(index + find.length);
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
