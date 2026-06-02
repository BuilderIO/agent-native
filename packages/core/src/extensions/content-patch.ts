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
    const prettier = await import("prettier");
    return await prettier.format(content, {
      parser: "html",
      htmlWhitespaceSensitivity: "ignore",
    });
  } catch (err: any) {
    throw new Error(
      `Unable to format extension HTML with Prettier: ${err?.message ?? err}`,
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
      throw new Error(`Unsupported extension edit operation: ${op}`);
  }
}

function applyLiteralReplace(
  content: string,
  edit: Extract<ExtensionContentEdit, { op?: "replace" }>,
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
  edit: Extract<ExtensionContentEdit, { op: "insert-before" | "insert-after" }>,
): { content: string; summary: string } {
  const matches = countOccurrences(content, edit.marker);
  assertMatchCount(edit.op, matches, edit.expectedMatches, edit.required);
  if (matches === 0) return { content, summary: `${edit.op}:0` };

  const occurrence = edit.occurrence ?? 1;
  const index = nthIndexOf(content, edit.marker, occurrence);
  if (index < 0) {
    throw new Error(`${edit.op} could not find occurrence ${occurrence}`);
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

function countOccurrences(content: string, needle: string): number {
  if (!needle) throw new Error("Patch find/marker text cannot be empty");
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
    throw new Error("occurrence must be a positive integer");
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
    throw new Error(`replace could not find occurrence ${occurrence}`);
  }
  return content.slice(0, index) + replace + content.slice(index + find.length);
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
