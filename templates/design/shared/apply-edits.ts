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
  return Array.from(content.matchAll(re), (match) => ({
    start: match.index,
    end: match.index + match[1].length,
  }));
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
  if (flexible === 1) {
    const { start, end } = matches[0];
    return `${content.slice(0, start)}${replace}${content.slice(end)}`;
  }

  throw new ApplyEditConflictError(
    `Edit ${index + 1}: search text was not found in the file. Read the current file (get-design-snapshot) and copy the exact text you want to change.`,
    "not_found",
  );
}

export function applyEdits(
  content: string,
  edits: DesignEdit[],
): ApplyEditsResult {
  let next = content;
  edits.forEach((edit, i) => {
    next = applyOneEdit(next, edit, i);
  });
  return { content: next, applied: edits.length };
}
