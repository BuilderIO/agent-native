import DiffMatchPatch, {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from "diff-match-patch";

import { docToNfm, nfmToDoc, type PMNode } from "../../shared/nfm.js";

/** Base blocks `from`..`to` become `insert`, whose keys are `keys`. */
type BlockHunk = {
  from: number;
  to: number;
  insert: PMNode[];
  keys: string[];
};

// diff-match-patch compares strings, so each distinct block becomes one
// UTF-16 code unit; a body with more distinct blocks than that is not rebased.
const MAX_DISTINCT_BLOCKS = 0xffff;

function blockHunks(
  base: readonly string[],
  afterKeys: readonly string[],
  afterBlocks: readonly PMNode[],
  codes: Map<string, string>,
): BlockHunk[] | null {
  const encode = (keys: readonly string[]) => {
    let text = "";
    for (const key of keys) {
      let code = codes.get(key);
      if (code === undefined) {
        if (codes.size >= MAX_DISTINCT_BLOCKS) return null;
        code = String.fromCharCode(codes.size + 1);
        codes.set(key, code);
      }
      text += code;
    }
    return text;
  };
  const before = encode(base);
  const target = encode(afterKeys);
  if (before === null || target === null) return null;
  const hunks: BlockHunk[] = [];
  let from = 0;
  let to = 0;
  let pending: BlockHunk | null = null;
  for (const [kind, text] of new DiffMatchPatch().diff_main(
    before,
    target,
    false,
  )) {
    if (kind === DIFF_EQUAL) {
      if (pending) hunks.push(pending);
      pending = null;
      from += text.length;
      to += text.length;
      continue;
    }
    pending ??= { from, to: from, insert: [], keys: [] };
    if (kind === DIFF_DELETE) {
      pending.to += text.length;
      from += text.length;
    } else if (kind === DIFF_INSERT) {
      pending.insert.push(...afterBlocks.slice(to, to + text.length));
      pending.keys.push(...afterKeys.slice(to, to + text.length));
      to += text.length;
    }
  }
  if (pending) hunks.push(pending);
  return hunks;
}

/** Every position a hunk could slide to; an insertion stays one. */
type SlidRange = { from: number; to: number; insertion: boolean };

// A diff places a change at one of the positions it could slide to along
// blocks that read the same, and the writer may have made it at any of them,
// so the change spans all of them.
function slidRange(base: readonly string[], hunk: BlockHunk): SlidRange {
  const removed = hunk.to - hunk.from;
  const added = hunk.keys;
  let left = 0;
  while (hunk.from - left > 0) {
    const block = base[hunk.from - left - 1];
    const lastRemoved = removed ? base[hunk.to - 1 - left] : block;
    const lastAdded = !added.length
      ? block
      : left < added.length
        ? added[added.length - 1 - left]
        : base[hunk.from - 1 - (left - added.length)];
    if (lastRemoved !== lastAdded) break;
    left += 1;
  }
  let right = 0;
  while (hunk.to + right < base.length) {
    const block = base[hunk.to + right];
    const firstRemoved = removed ? base[hunk.from + right] : block;
    const firstAdded = !added.length
      ? block
      : right < added.length
        ? added[right]
        : base[hunk.to + (right - added.length)];
    if (firstRemoved !== firstAdded) break;
    right += 1;
  }
  return {
    from: hunk.from - left,
    to: hunk.to + right,
    insertion: hunk.from === hunk.to,
  };
}

function sameHunk(left: BlockHunk, right: BlockHunk): boolean {
  return (
    left.from === right.from &&
    left.to === right.to &&
    left.keys.length === right.keys.length &&
    left.keys.every((key, index) => key === right.keys[index])
  );
}

// An insertion is placed by the blocks on either side of it, so it conflicts
// with a change that touches either one, or with another insertion there.
function rangesOverlap(left: SlidRange, right: SlidRange): boolean {
  if (left.insertion || right.insertion) {
    return left.from <= right.to && right.from <= left.to;
  }
  return left.from < right.to && right.from < left.to;
}

/**
 * Applies the blocks `candidate` changed from `base` to `current`, which
 * other writers moved on from `base`. Null unless that is unambiguous:
 * - each base block the edit removes, and each block beside an insertion,
 *   reads unlike every other block in `base` and `current`, or which one
 *   the edit meant would depend on how the diff aligned the bodies;
 * - no change another writer made overlaps the edit's changes, or borders
 *   its insertions, at any position either could slide to;
 * - no block either side removes or adds reads the same as one the other
 *   side removes or adds, since a move and a delete-and-retype read alike.
 * A change both made at the same place is taken once, unless it could slide,
 * since they may have made it at different places.
 */
export function rebaseBodyEdit(
  base: string,
  candidate: string,
  current: string,
): string | null {
  const baseBlocks = nfmToDoc(base).content;
  const candidateBlocks = nfmToDoc(candidate).content;
  const currentBlocks = nfmToDoc(current).content;
  const baseKeys = baseBlocks.map((block) => JSON.stringify(block));
  const currentKeys = currentBlocks.map((block) => JSON.stringify(block));
  const codes = new Map<string, string>();
  const edit = blockHunks(
    baseKeys,
    candidateBlocks.map((block) => JSON.stringify(block)),
    candidateBlocks,
    codes,
  );
  const others = blockHunks(baseKeys, currentKeys, currentBlocks, codes);
  if (!edit || !others) return null;
  if (!edit.length) return current;
  const counts = new Map<string, { base: number; current: number }>();
  for (const key of baseKeys) {
    const count = counts.get(key) ?? { base: 0, current: 0 };
    counts.set(key, { ...count, base: count.base + 1 });
  }
  for (const key of currentKeys) {
    const count = counts.get(key);
    if (count) count.current += 1;
  }
  const readsOnce = (index: number) => {
    if (index < 0 || index >= baseKeys.length) return true;
    const count = counts.get(baseKeys[index]);
    return count?.base === 1 && count.current <= 1;
  };
  for (const hunk of edit) {
    for (let index = hunk.from; index < hunk.to; index += 1)
      if (!readsOnce(index)) return null;
    if (
      hunk.from === hunk.to &&
      !(readsOnce(hunk.from - 1) && readsOnce(hunk.from))
    )
      return null;
  }
  const editRanges = edit.map((hunk) => slidRange(baseKeys, hunk));
  const otherRanges = others.map((hunk) => slidRange(baseKeys, hunk));
  const shared = new Set<BlockHunk>();
  edit.forEach((hunk, index) => {
    const same = others.find((other) => sameHunk(hunk, other));
    const range = editRanges[index];
    if (same && range.from === hunk.from && range.to === hunk.to) {
      shared.add(hunk);
      shared.add(same);
    }
  });
  const blocksOf = (hunks: readonly BlockHunk[], all: boolean) => {
    const keys = new Set<string>();
    for (const hunk of hunks) {
      if (!all && shared.has(hunk)) continue;
      for (let index = hunk.from; index < hunk.to; index += 1)
        keys.add(baseKeys[index]);
      for (const key of hunk.keys) keys.add(key);
    }
    return keys;
  };
  const editBlocks = blocksOf(edit, true);
  const otherBlocks = blocksOf(others, true);
  for (const key of blocksOf(edit, false))
    if (otherBlocks.has(key)) return null;
  for (const key of blocksOf(others, false))
    if (editBlocks.has(key)) return null;
  for (let index = 0; index < edit.length; index += 1) {
    for (let other = 0; other < others.length; other += 1) {
      if (shared.has(edit[index]) && sameHunk(edit[index], others[other]))
        continue;
      if (rangesOverlap(editRanges[index], otherRanges[other])) return null;
    }
  }
  const merged = [...baseBlocks];
  for (const hunk of [
    ...edit,
    ...others.filter((other) => !shared.has(other)),
  ].sort((left, right) => right.from - left.from || right.to - left.to)) {
    merged.splice(hunk.from, hunk.to - hunk.from, ...hunk.insert);
  }
  return docToNfm({
    type: "doc",
    content: merged.length ? merged : [{ type: "paragraph" }],
  });
}
