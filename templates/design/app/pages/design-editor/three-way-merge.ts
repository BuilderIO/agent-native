import DiffMatchPatch from "diff-match-patch";

const { DIFF_DELETE, DIFF_EQUAL } = DiffMatchPatch;

const diffMatchPatch = new DiffMatchPatch();
// A timed-out diff is still a valid (coarser) diff, so the only cost of a slow
// document is a wider hunk and therefore an earlier, loud conflict.
diffMatchPatch.Diff_Timeout = 0.5;

type HunkSide = "mine" | "theirs" | "both";

interface Hunk {
  start: number;
  end: number;
  text: string;
  side: HunkSide;
}

function hunksFromBase(
  base: string,
  next: string,
  side: "mine" | "theirs",
): Hunk[] {
  const diffs = diffMatchPatch.diff_main(base, next);
  diffMatchPatch.diff_cleanupSemantic(diffs);
  const hunks: Hunk[] = [];
  let cursor = 0;
  let open: Hunk | null = null;
  for (const [operation, text] of diffs) {
    if (operation === DIFF_EQUAL) {
      open = null;
      cursor += text.length;
      continue;
    }
    if (!open) {
      open = { start: cursor, end: cursor, text: "", side };
      hunks.push(open);
    }
    if (operation === DIFF_DELETE) {
      open.end += text.length;
      cursor += text.length;
    } else {
      open.text += text;
    }
  }
  return hunks;
}

/**
 * Merges two independent edits of `base`. Both edits are expressed as hunks in
 * base coordinates and applied together only when no two hunks overlap or
 * touch, so a merge never depends on fuzzy matching: there is no match
 * threshold or distance to tune, an edit either lands exactly where it was made
 * or the merge is refused. Identical hunks (both sides made the same edit)
 * collapse into one. Returns null for any overlap, so a same-spot conflict
 * stays the caller's to surface. Two different insertions at the very same
 * point are an overlap too, unless the caller opts into
 * `keepBothInsertionsAtSamePoint`, which keeps both with theirs first and mine
 * last (right for appended declarations, where the later writer should win).
 */
export function threeWayMergeContent({
  base,
  mine,
  theirs,
  keepBothInsertionsAtSamePoint = false,
}: {
  base: string;
  mine: string;
  theirs: string;
  keepBothInsertionsAtSamePoint?: boolean;
}): string | null {
  if (theirs === mine) return theirs;
  if (theirs === base) return mine;
  if (mine === base) return theirs;
  const hunks = [
    ...hunksFromBase(base, mine, "mine"),
    ...hunksFromBase(base, theirs, "theirs"),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Hunk[] = [];
  for (const hunk of hunks) {
    const previous = merged[merged.length - 1];
    if (previous && hunk.start <= previous.end) {
      if (
        hunk.start === previous.start &&
        hunk.end === previous.end &&
        hunk.text === previous.text
      ) {
        continue;
      }
      if (
        keepBothInsertionsAtSamePoint &&
        hunk.start === hunk.end &&
        previous.start === previous.end &&
        hunk.start === previous.start &&
        hunk.side !== previous.side &&
        previous.side !== "both"
      ) {
        previous.text =
          previous.side === "theirs"
            ? previous.text + hunk.text
            : hunk.text + previous.text;
        previous.side = "both";
        continue;
      }
      return null;
    }
    merged.push(hunk);
  }
  let result = "";
  let position = 0;
  for (const hunk of merged) {
    result += base.slice(position, hunk.start) + hunk.text;
    position = hunk.end;
  }
  return result + base.slice(position);
}
