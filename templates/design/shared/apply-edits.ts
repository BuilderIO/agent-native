import {
  editRemovedTextMessage,
  findEditThatRemovedText,
  findTargetedMatches,
} from "@agent-native/core/shared";

export interface DesignEdit {
  search: string;
  replace: string;
}

export interface ApplyEditsResult {
  content: string;
  applied: number;
}

export class ApplyEditConflictError extends Error {
  constructor(
    message: string,
    readonly kind: "ambiguous" | "not_found",
  ) {
    super(message);
    this.name = "ApplyEditConflictError";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return count;
}

export function findWhitespaceFlexibleMatches(
  content: string,
  search: string,
): { start: number; end: number }[] {
  const pattern = escapeRegExp(search).replace(/\s+/g, "\\s+");
  const boundary = /^\s/.test(search) ? "(?<!\\s)" : "";
  const re = new RegExp(`${boundary}(?=(${pattern}))`, "g");
  const matches: { start: number; end: number }[] = [];
  for (const match of content.matchAll(re)) {
    const matched = match.at(1);
    if (matched === undefined) continue;
    matches.push({ start: match.index, end: match.index + matched.length });
  }
  return matches;
}

export function applyOneEdit(
  content: string,
  edit: DesignEdit,
  index = 0,
): string {
  const { search, replace } = edit;
  if (typeof search !== "string" || search.length === 0) {
    throw new Error(`Edit ${index + 1}: "search" must be a non-empty string.`);
  }
  if (typeof replace !== "string") {
    throw new Error(`Edit ${index + 1}: "replace" must be a string.`);
  }

  const exact = countOccurrences(content, search);
  if (exact === 1) return content.split(search).join(replace);

  const matches = findWhitespaceFlexibleMatches(content, search);
  const flexible = matches.length;
  if (exact > 1 || flexible > 1) {
    const detail =
      exact > 1
        ? `${exact} places (exact) and ${flexible} places (whitespace-insensitive)`
        : `${flexible} places (whitespace-insensitive)`;
    throw new ApplyEditConflictError(
      `Edit ${index + 1}: "search" matched ${detail} — add more surrounding context so it matches exactly one location.`,
      "ambiguous",
    );
  }
  const only = matches.at(0);
  if (flexible === 1 && only) {
    return `${content.slice(0, only.start)}${replace}${content.slice(only.end)}`;
  }

  throw new ApplyEditConflictError(
    `Edit ${index + 1}: search text was not found in the file.${nearMissHint(content, search)} Read the current file (get-design-snapshot) and copy the exact text you want to change.`,
    "not_found",
  );
}

function nearMissHint(content: string, search: string): string {
  const result = findTargetedMatches(content, search);
  if (result.ok || result.reason !== "not_found") return "";
  const lines = (kind: "escaped" | "whitespaceOnly") =>
    result.candidates
      .filter((c) => c[kind])
      .map((c) => c.line)
      .join(", ");
  const escaped = lines("escaped");
  if (escaped) {
    return ` It has backslash escapes such as \\n where the file has real line breaks, tabs, or quotes (line ${escaped}): send the real characters in both search and replace.`;
  }
  const whitespace = lines("whitespaceOnly");
  return whitespace
    ? ` The file has this text with different whitespace at line ${whitespace}.`
    : "";
}

export function applyEditsInOrder(
  content: string,
  edits: DesignEdit[],
  applyOne: (content: string, edit: DesignEdit, index: number) => string,
): ApplyEditsResult {
  let next = content;
  const contentBeforeEachEdit: string[] = [];
  edits.forEach((edit, i) => {
    contentBeforeEachEdit.push(next);
    try {
      next = applyOne(next, edit, i);
    } catch (error) {
      if (!(error instanceof ApplyEditConflictError)) throw error;
      const removerIndex = next.includes(edit.search)
        ? null
        : findEditThatRemovedText(contentBeforeEachEdit, edit.search);
      if (removerIndex === null) throw error;
      throw new ApplyEditConflictError(
        editRemovedTextMessage(i, removerIndex),
        error.kind,
      );
    }
  });
  return { content: next, applied: edits.length };
}

export function applyEdits(
  content: string,
  edits: DesignEdit[],
): ApplyEditsResult {
  return applyEditsInOrder(content, edits, applyOneEdit);
}
