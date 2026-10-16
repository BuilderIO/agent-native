import DiffMatchPatch, {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from "diff-match-patch";

import { docToNfm, nfmToDoc, type PMNode } from "../../shared/nfm.js";

/** Base blocks `from`..`to` become `insert`. */
type BlockHunk = { from: number; to: number; insert: PMNode[] };

// diff-match-patch compares strings, so each distinct block becomes one
// UTF-16 code unit; a body with more distinct blocks than that is not rebased.
const MAX_DISTINCT_BLOCKS = 0xffff;

function blockHunks(
  base: readonly string[],
  after: readonly string[],
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
  const target = encode(after);
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
    pending ??= { from, to: from, insert: [] };
    if (kind === DIFF_DELETE) {
      pending.to += text.length;
      from += text.length;
    } else if (kind === DIFF_INSERT) {
      pending.insert.push(...afterBlocks.slice(to, to + text.length));
      to += text.length;
    }
  }
  if (pending) hunks.push(pending);
  return hunks;
}

function sameHunk(left: BlockHunk, right: BlockHunk): boolean {
  return (
    left.from === right.from &&
    left.to === right.to &&
    JSON.stringify(left.insert) === JSON.stringify(right.insert)
  );
}

// An insertion is placed by the blocks on either side of it, so it conflicts
// with a change that touches either one, or with another insertion there.
function hunksOverlap(left: BlockHunk, right: BlockHunk): boolean {
  if (left.from === left.to || right.from === right.to) {
    return left.from <= right.to && right.from <= left.to;
  }
  return left.from < right.to && right.from < left.to;
}

/**
 * Applies the blocks `candidate` changed from `base` to `current`, which
 * other writers moved on from `base`. Null unless that is unambiguous: every
 * base block the edit replaces must appear once in both bodies, or the edit
 * could land on a different passage that reads the same, and nothing another
 * writer changed may overlap the edit's blocks or border its insertions.
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
  const occurrences = (keys: readonly string[], key: string) =>
    keys.reduce((count, other) => count + (other === key ? 1 : 0), 0);
  for (const hunk of edit) {
    for (let index = hunk.from; index < hunk.to; index += 1) {
      const key = baseKeys[index];
      if (occurrences(baseKeys, key) !== 1) return null;
      // Absent, another writer changed it, which the overlap check decides.
      if (occurrences(currentKeys, key) > 1) return null;
    }
  }
  const kept: BlockHunk[] = [];
  for (const other of others) {
    const shared = edit.find((hunk) => hunksOverlap(hunk, other));
    if (!shared) kept.push(other);
    else if (!sameHunk(shared, other)) return null;
  }
  const merged = [...baseBlocks];
  for (const hunk of [...edit, ...kept].sort(
    (left, right) => right.from - left.from || right.to - left.to,
  )) {
    merged.splice(hunk.from, hunk.to - hunk.from, ...hunk.insert);
  }
  return docToNfm({
    type: "doc",
    content: merged.length ? merged : [{ type: "paragraph" }],
  });
}
