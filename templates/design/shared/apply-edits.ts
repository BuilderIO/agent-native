/**
 * Surgical search/replace engine for design files. Lets the agent make the
 * smallest possible change to an HTML/CSS document instead of regenerating the
 * whole file — the "smart diff" path used by the `edit-design` action.
 *
 * Two matching strategies, tried in order, both requiring a UNIQUE match so an
 * edit can never silently hit the wrong place:
 *   1. exact substring
 *   2. whitespace-flexible (any run of whitespace in `search` matches any run
 *      of whitespace in the file) — tolerates re-indentation / reflowed markup
 *
 * Pure + dependency-free so it is trivially unit-testable.
 */

export interface DesignEdit {
  /** Exact text to find, with enough surrounding context to be unique. */
  search: string;
  /** Replacement text. Inserted verbatim — `$`/`$1` are NOT interpreted. */
  replace: string;
}

export interface ApplyEditsResult {
  content: string;
  applied: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  // Step by 1 (not by needle length) so self-overlapping matches are counted.
  // A count > 1 does NOT immediately throw — Strategy 2 runs first and may
  // still resolve a unique non-overlapping match.
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return count;
}

/**
 * Apply a single edit. Throws a clear, agent-actionable error when the search
 * text is missing or ambiguous so the agent can re-read the file and retry.
 */
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

  // Strategy 1 — exact substring.
  const exact = countOccurrences(content, search);
  if (exact === 1) return content.split(search).join(replace);
  // When exact > 1 (including self-overlapping matches), fall through to
  // Strategy 2 before declaring ambiguity. Strategy 2 uses a non-overlapping
  // regex scan, so a search string that appears self-overlapping under Strategy
  // 1 may still resolve to a single unique whitespace-flexible match.

  // Strategy 2 — whitespace-flexible.
  const pattern = escapeRegExp(search).replace(/\s+/g, "\\s+");
  const re = new RegExp(pattern, "g");
  const matches = content.match(re);
  const flexible = matches ? matches.length : 0;
  if (flexible === 1) {
    // Function replacer so `$&`/`$1` in `replace` are inserted literally.
    return content.replace(re, () => replace);
  }
  if (flexible > 1) {
    const detail =
      exact > 1
        ? `${exact} places (exact) and ${flexible} places (whitespace-insensitive)`
        : `${flexible} places (whitespace-insensitive)`;
    throw new Error(
      `Edit ${index + 1}: "search" matched ${detail} — add more surrounding context so it matches exactly one location.`,
    );
  }

  throw new Error(
    `Edit ${index + 1}: "search" text was not found in the file. Read the current file (get-design-snapshot) and copy the exact text you want to change.`,
  );
}

/**
 * Apply edits in order against a single document. Edits are sequential — a
 * later edit sees the result of earlier ones. Atomic at the call site: the
 * caller should only persist the returned content (this never mutates input).
 */
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
