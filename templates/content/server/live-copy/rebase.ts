import DiffMatchPatch, {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from "diff-match-patch";

import {
  docToNfm,
  nfmToDoc,
  parseNfmWithLosses,
  type PMNode,
} from "../../shared/nfm.js";

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

/** A range of a body's Markdown text. */
export type BodyTextRange = { start: number; end: number };

// The base blocks a range touches are the ones that change when its text
// becomes a word the body doesn't hold.
function touchedBlocks(
  base: string,
  baseKeys: readonly string[],
  ranges: readonly BodyTextRange[],
  codes: Map<string, string>,
): SlidRange[] | null {
  let word = "authoredrange";
  while (base.includes(word)) word += "x";
  let probe = base;
  for (const range of [...ranges].sort(
    (left, right) => right.start - left.start,
  ))
    probe = probe.slice(0, range.start) + word + probe.slice(range.end);
  const blocks = nfmToDoc(probe).content;
  const hunks = blockHunks(
    baseKeys,
    blocks.map((block) => JSON.stringify(block)),
    blocks,
    codes,
  );
  return (
    hunks?.map((hunk) => ({
      from: hunk.from,
      to: hunk.to,
      insertion: hunk.from === hunk.to,
    })) ?? null
  );
}

// The base block the line holding `offset` belongs to, read from how the
// text through that line parses. Null when that parse's blocks before its
// last differ from base's, as when the cut leaves open a container a later
// line closes.
function blockAtLine(
  base: string,
  baseKeys: readonly string[],
  offset: number,
): number | null {
  const lineEnd = base.indexOf("\n", offset);
  const blocks = nfmToDoc(
    lineEnd === -1 ? base : base.slice(0, lineEnd),
  ).content;
  const last = blocks.length - 1;
  if (last < 0 || last >= baseKeys.length) return null;
  for (let index = 0; index < last; index += 1)
    if (JSON.stringify(blocks[index]) !== baseKeys[index]) return null;
  return last;
}

// The base blocks the lines of each range belong to, where `touchedBlocks`
// may read more: a range that takes a closing code fence leaves its probe's
// code block open over every block after it. Null for an empty range, which
// marks a place between blocks, or for a block the probe didn't touch.
function coveredBlocks(
  base: string,
  baseKeys: readonly string[],
  ranges: readonly BodyTextRange[],
  touched: readonly SlidRange[],
): SlidRange[] | null {
  const covered: SlidRange[] = [];
  for (const range of ranges) {
    if (range.end === range.start) return null;
    const from = blockAtLine(base, baseKeys, range.start);
    const to = blockAtLine(base, baseKeys, range.end - 1);
    if (from === null || to === null || to < from) return null;
    for (let index = from; index <= to; index += 1)
      if (!touched.some((hunk) => hunk.from <= index && index < hunk.to))
        return null;
    covered.push({ from, to: to + 1, insertion: false });
  }
  return covered;
}

type BlockCounts = Map<string, { base: number; current: number }>;

// How many times each base block reads in base and in current.
function blockCounts(
  baseKeys: readonly string[],
  currentKeys: readonly string[],
): BlockCounts {
  const counts: BlockCounts = new Map();
  for (const key of baseKeys) {
    const count = counts.get(key) ?? { base: 0, current: 0 };
    counts.set(key, { ...count, base: count.base + 1 });
  }
  for (const key of currentKeys) {
    const count = counts.get(key);
    if (count) count.current += 1;
  }
  return counts;
}

// Content opts out of `noUncheckedIndexedAccess`, so `items[index]` reads as
// never missing there.
function itemAt<T>(items: readonly T[], index: number): T | undefined {
  return items[index];
}

// Each base block a hunk removes, and each block beside an insertion, reads
// unlike every other block in base and current.
function placedOnce(
  hunk: BlockHunk,
  baseKeys: readonly string[],
  counts: BlockCounts,
): boolean {
  const readsOnce = (index: number) => {
    const key = itemAt(baseKeys, index);
    if (key === undefined) return true;
    const count = counts.get(key);
    return count?.base === 1 && count.current <= 1;
  };
  for (let index = hunk.from; index < hunk.to; index += 1)
    if (!readsOnce(index)) return false;
  return (
    hunk.from !== hunk.to || (readsOnce(hunk.from - 1) && readsOnce(hunk.from))
  );
}

// The edit's hunks another writer made too, at a place neither could slide
// from, with the other writer's hunks they match.
function sharedHunks(
  edit: readonly BlockHunk[],
  editRanges: readonly SlidRange[],
  others: readonly BlockHunk[],
): Set<BlockHunk> {
  const shared = new Set<BlockHunk>();
  edit.forEach((hunk, index) => {
    const same = others.find((other) => sameHunk(hunk, other));
    const range = itemAt(editRanges, index);
    if (same && range && range.from === hunk.from && range.to === hunk.to) {
      shared.add(hunk);
      shared.add(same);
    }
  });
  return shared;
}

// The base blocks hunks remove, and the blocks they add that base or current
// already holds.
function hunkBlocks(
  hunks: readonly BlockHunk[],
  baseKeys: readonly string[],
  counts: BlockCounts,
  skip?: ReadonlySet<BlockHunk>,
): Set<string> {
  const keys = new Set<string>();
  for (const hunk of hunks) {
    if (skip?.has(hunk)) continue;
    for (const key of baseKeys.slice(hunk.from, hunk.to)) keys.add(key);
    for (const key of hunk.keys) if (counts.has(key)) keys.add(key);
  }
  return keys;
}

/**
 * Applies the blocks `candidate` changed from `base` to `current`, which
 * other writers moved on from `base`. Null unless that is unambiguous:
 * - each base block the edit removes, and each block beside an insertion,
 *   reads unlike every other block in `base` and `current`, or which one
 *   the edit meant would depend on how the diff aligned the bodies;
 * - no change another writer made overlaps the edit's changes, or borders
 *   its insertions, at any position either could slide to;
 * - no change another writer made touches a block the `authored` ranges of
 *   `base` touch, such as the text an edit's find replaced, though the diff
 *   may read some of those blocks as kept;
 * - no block of `base` either side removes or adds reads the same as one the
 *   other side removes or adds, since a move and a delete-and-retype read
 *   alike. A new block both add in different places is added twice.
 * A change both made at the same place is taken once, unless it could slide,
 * since they may have made it at different places.
 */
export function rebaseBodyEdit(
  base: string,
  candidate: string,
  current: string,
  authored: readonly BodyTextRange[] = [],
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
  const counts = blockCounts(baseKeys, currentKeys);
  if (!edit.every((hunk) => placedOnce(hunk, baseKeys, counts))) return null;
  const editRanges = edit.map((hunk) => slidRange(baseKeys, hunk));
  const otherRanges = others.map((hunk) => slidRange(baseKeys, hunk));
  const shared = sharedHunks(edit, editRanges, others);
  const editBlocks = hunkBlocks(edit, baseKeys, counts);
  const otherBlocks = hunkBlocks(others, baseKeys, counts);
  for (const key of hunkBlocks(edit, baseKeys, counts, shared))
    if (otherBlocks.has(key)) return null;
  for (const key of hunkBlocks(others, baseKeys, counts, shared))
    if (editBlocks.has(key)) return null;
  for (let index = 0; index < edit.length; index += 1) {
    for (let other = 0; other < others.length; other += 1) {
      if (shared.has(edit[index]) && sameHunk(edit[index], others[other]))
        continue;
      if (rangesOverlap(editRanges[index], otherRanges[other])) return null;
    }
  }
  if (authored.length) {
    const othersTouch = (ranges: readonly SlidRange[]) =>
      ranges.some((range) =>
        others.some(
          (other, index) =>
            !shared.has(other) && rangesOverlap(range, otherRanges[index]),
        ),
      );
    const touched = touchedBlocks(base, baseKeys, authored, codes);
    if (!touched) return null;
    if (othersTouch(touched)) {
      const covered = coveredBlocks(base, baseKeys, authored, touched);
      if (!covered || othersTouch(covered)) return null;
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

/** Blocks an undo leaves as they are, because a later change overlaps them. */
export type KeptBackBlocks = {
  /** The blocks as the undone edit left them, in Markdown. */
  changedTo: string;
  /** The blocks as they read before that edit, in Markdown. */
  changedFrom: string;
};

// A change that rewrote several blocks in a row reads block by block: an
// edit's is taken back one block at a time, so a later change to one of them
// keeps back only that one, and a later writer's shows which of those blocks
// it already took back.
function eachRewrittenBlock(hunk: BlockHunk): BlockHunk[] {
  const removed = hunk.to - hunk.from;
  if (removed < 2 || removed !== hunk.insert.length) return [hunk];
  return hunk.insert.map((block, index) => ({
    from: hunk.from + index,
    to: hunk.from + index + 1,
    insert: [block],
    keys: hunk.keys.slice(index, index + 1),
  }));
}

function blocksMarkdown(blocks: readonly PMNode[]): string {
  return blocks.length ? docToNfm({ type: "doc", content: [...blocks] }) : "";
}

/**
 * Takes back, in `current`, the blocks an edit changed from `before` to
 * `after`, where other writers may have moved `current` on from `after`.
 * Each of the edit's changes is taken back on its own, under
 * `rebaseBodyEdit`'s rules: a change a later one overlaps or borders, or
 * whose place depends on how the diff aligned the bodies, stays as `current`
 * has it and is listed in `keptBack`. A change `current` already takes back
 * is left alone. Every later change stays. Null when the parser drops part
 * of a body, since the page the merge writes would lose that part.
 */
export function revertBodyEdit(
  after: string,
  before: string,
  current: string,
): { content: string; keptBack: KeptBackBlocks[] } | null {
  if (current === after) return { content: before, keptBack: [] };
  if (current === before) return { content: current, keptBack: [] };
  const parsedAfter = parseNfmWithLosses(after);
  const parsedBefore = parseNfmWithLosses(before);
  const parsedCurrent = parseNfmWithLosses(current);
  if (
    parsedAfter.losses.length ||
    parsedBefore.losses.length ||
    parsedCurrent.losses.length
  ) {
    return null;
  }
  const baseBlocks = parsedAfter.doc.content;
  const beforeBlocks = parsedBefore.doc.content;
  const currentBlocks = parsedCurrent.doc.content;
  const baseKeys = baseBlocks.map((block) => JSON.stringify(block));
  const currentKeys = currentBlocks.map((block) => JSON.stringify(block));
  const codes = new Map<string, string>();
  const undo = blockHunks(
    baseKeys,
    beforeBlocks.map((block) => JSON.stringify(block)),
    beforeBlocks,
    codes,
  );
  const laterHunks = blockHunks(baseKeys, currentKeys, currentBlocks, codes);
  if (!undo || !laterHunks) {
    return {
      content: current,
      keptBack:
        before === after ? [] : [{ changedTo: after, changedFrom: before }],
    };
  }
  const edit = undo.flatMap(eachRewrittenBlock);
  const others = laterHunks.flatMap(eachRewrittenBlock);
  const counts = blockCounts(baseKeys, currentKeys);
  const editRanges = edit.map((hunk) => slidRange(baseKeys, hunk));
  const otherRanges = others.map((hunk) => slidRange(baseKeys, hunk));
  const shared = sharedHunks(edit, editRanges, others);
  const otherBlocks = hunkBlocks(others, baseKeys, counts);
  const taken: BlockHunk[] = [];
  const keptBack: KeptBackBlocks[] = [];
  for (const hunk of edit) {
    if (shared.has(hunk)) continue;
    const blocks = hunkBlocks([hunk], baseKeys, counts);
    const editRange = slidRange(baseKeys, hunk);
    const overlapped =
      !placedOnce(hunk, baseKeys, counts) ||
      [...blocks].some((key) => otherBlocks.has(key)) ||
      otherRanges.some((range) => rangesOverlap(editRange, range));
    if (!overlapped) {
      taken.push(hunk);
      continue;
    }
    keptBack.push({
      changedTo: blocksMarkdown(baseBlocks.slice(hunk.from, hunk.to)),
      changedFrom: blocksMarkdown(hunk.insert),
    });
  }
  if (!taken.length) return { content: current, keptBack };
  const merged = [...baseBlocks];
  for (const hunk of [...taken, ...others].sort(
    (left, right) => right.from - left.from || right.to - left.to,
  )) {
    merged.splice(hunk.from, hunk.to - hunk.from, ...hunk.insert);
  }
  return {
    content: docToNfm({
      type: "doc",
      content: merged.length ? merged : [{ type: "paragraph" }],
    }),
    keptBack,
  };
}
