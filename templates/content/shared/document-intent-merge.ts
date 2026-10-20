import DiffMatchPatch, {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from "diff-match-patch";

import {
  compareDocumentBodyIntents,
  type CommittedDocumentBodyIntent,
  type DocumentBodyIntent,
} from "./document-intent-order.js";
import { docToNfm, nfmToDoc, type PMNode } from "./nfm.js";

export interface PriorDocumentBodyIntent extends CommittedDocumentBodyIntent {
  affectedBlockIndexes: number[];
  canonicalChanged: boolean;
}

export type DocumentIntentMerge =
  | {
      status: "resolved";
      content: string;
      changedBlockIndexes: number[];
      displaced: boolean;
    }
  | { status: "preservation-required"; reason: "provenance" | "structure" };

function stableBlock(block: PMNode): string {
  return JSON.stringify(block);
}

function parseStableBlocks(content: string): PMNode[] | null {
  try {
    const parsed = nfmToDoc(content);
    return docToNfm(parsed) === content ? parsed.content : null;
  } catch {
    // coercion-ok: null is a typed preservation-required parse result, never a successful merge.
    return null;
  }
}

function parsedForm(content: string): string | null {
  try {
    return docToNfm(nfmToDoc(content));
  } catch {
    // coercion-ok: null is a typed preservation-required parse result, never a successful merge.
    return null;
  }
}

function hasAmbiguousIdentity(
  base: readonly string[],
  candidate: readonly string[],
  current: readonly string[],
  changed: readonly number[],
): boolean {
  for (const index of changed) {
    const block = base[index];
    if (
      base.indexOf(block) !== base.lastIndexOf(block) ||
      candidate.indexOf(block) !== candidate.lastIndexOf(block) ||
      current.indexOf(block) !== current.lastIndexOf(block)
    ) {
      return true;
    }
  }
  return false;
}

type TextHunk = { from: number; to: number; insert: string };

function textHunks(before: string, after: string): TextHunk[] {
  const differ = new DiffMatchPatch();
  const diffs = differ.diff_main(before, after, true);
  differ.diff_cleanupSemantic(diffs);
  const hunks: TextHunk[] = [];
  let offset = 0;
  let pending: TextHunk | null = null;
  const flush = () => {
    if (pending) hunks.push(pending);
    pending = null;
  };
  for (const [kind, text] of diffs) {
    if (kind === DIFF_EQUAL) {
      flush();
      offset += text.length;
      continue;
    }
    pending ??= { from: offset, to: offset, insert: "" };
    if (kind === DIFF_DELETE) {
      pending.to += text.length;
      offset += text.length;
    } else if (kind === DIFF_INSERT) {
      pending.insert += text;
    }
  }
  flush();
  const grouped: TextHunk[] = [];
  for (const hunk of hunks) {
    const previous = grouped[grouped.length - 1];
    if (
      previous &&
      /^[\p{L}\p{N}_]+$/u.test(before.slice(previous.from, hunk.to))
    ) {
      previous.insert += before.slice(previous.to, hunk.from) + hunk.insert;
      previous.to = hunk.to;
    } else {
      grouped.push({ ...hunk });
    }
  }
  return grouped;
}

const EMPTY_BLOCK = "<empty-block/>";

// Typing into an empty paragraph replaces its marker, so empty paragraphs
// compare as empty lines. Null when the blocks don't serialize on their own.
function comparableText(content: string, blocks: PMNode[]): string | null {
  const serialized = blocks.map((block) =>
    docToNfm({ type: "doc", content: [block] }),
  );
  if (serialized.join("\n") !== content) return null;
  return blocks
    .map((block, index) =>
      block.type === "paragraph" &&
      !block.content?.length &&
      serialized[index] === EMPTY_BLOCK
        ? ""
        : serialized[index],
    )
    .join("\n");
}

// A diff can place a change anywhere along repeated text, so the range covers
// every position the hunk could slide to. `lastFrom` is its latest start.
function slidRange(
  text: string,
  hunk: TextHunk,
): { from: number; to: number; lastFrom: number } {
  const last = (value: string, fallback: string) =>
    value ? value[value.length - 1] : fallback;
  let removed = text.slice(hunk.from, hunk.to);
  let added = hunk.insert;
  let from = hunk.from;
  while (from > 0) {
    const char = text[from - 1];
    if (last(removed, char) !== last(added, char)) break;
    if (removed) removed = char + removed.slice(0, -1);
    if (added) added = char + added.slice(0, -1);
    from -= 1;
  }
  removed = text.slice(hunk.from, hunk.to);
  added = hunk.insert;
  let to = hunk.to;
  while (to < text.length) {
    const char = text[to];
    if ((removed[0] ?? char) !== (added[0] ?? char)) break;
    if (removed) removed = removed.slice(1) + char;
    if (added) added = added.slice(1) + char;
    to += 1;
  }
  return { from, to, lastFrom: hunk.from + to - hunk.to };
}

// Collaboration delivers each editor's changes to the others, so a body
// authored against an older revision can already hold every change another
// body made since then. The holder is then the merge, with nothing lost. Its
// edits must stay clear of the other body's changes, except for typing into
// or right after text the other body added without replacing anything.
function holdsChanges(base: string, holder: string, other: string): boolean {
  const changes = textHunks(other, base).map((hunk) => ({
    ...slidRange(other, hunk),
    added: !hunk.insert,
  }));
  return textHunks(other, holder).every((hunk) => {
    const edit = slidRange(other, hunk);
    const typed = hunk.from === hunk.to;
    return changes.every(
      (change) =>
        edit.to < change.from ||
        edit.from > change.to ||
        (typed && change.added && edit.from > change.lastFrom),
    );
  });
}

/**
 * Whether `holder` holds every change `other` made to `base`, with any edits
 * of its own clear of them. False when a body cannot be compared as text.
 */
export function bodyHoldsChanges(
  base: string,
  holder: string,
  other: string,
): boolean {
  // Only the holder comes from an editor. The base and the other body can be
  // stored Markdown, such as an agent's blank-line paragraphs, so they compare
  // in the form an editor holds them, as in the merge.
  const [baseText, holderText, otherText] = [
    parsedForm(base),
    holder,
    parsedForm(other),
  ].map((content) => {
    if (content === null) return null;
    const blocks = parseStableBlocks(content);
    return blocks ? comparableText(content, blocks) : null;
  });
  return (
    baseText !== null &&
    holderText !== null &&
    otherText !== null &&
    holdsChanges(baseText, holderText, otherText)
  );
}

function textHunksOverlap(left: TextHunk, right: TextHunk): boolean {
  if (left.from === left.to && right.from === right.to)
    return left.from === right.from;
  if (left.from === left.to)
    return right.from < left.from && left.from < right.to;
  if (right.from === right.to)
    return left.from < right.from && right.from < left.to;
  return left.from < right.to && right.from < left.to;
}

// Collaboration delivers a peer's typing as it happens, so a body can hold the
// start of an insertion the other body finished. That is one insertion, not
// two competing ones; returns the hunk that holds all of it.
function heldInsertion(left: TextHunk, right: TextHunk): TextHunk | null {
  if (left.from !== left.to || right.from !== right.to) return null;
  if (left.from !== right.from) return null;
  if (left.insert.startsWith(right.insert)) return left;
  if (right.insert.startsWith(left.insert)) return right;
  return null;
}

function blockSpans(
  content: string,
): Array<{ block: PMNode; from: number; to: number }> | null {
  const blocks = parseStableBlocks(content);
  if (!blocks) return null;
  const serialized = blocks.map((block) =>
    docToNfm({ type: "doc", content: [block] }),
  );
  if (serialized.join("\n") !== content) return null;
  let offset = 0;
  return blocks.map((block, index) => {
    const from = offset;
    offset += serialized[index].length + 1;
    return { block, from, to: from + serialized[index].length };
  });
}

/**
 * Merges a Blocks field's unsaved text with a newer version saved elsewhere,
 * both edited from `base`. Their changes always land. Mine land too, except
 * where both changed the same words: their words stay in place, and the
 * paragraphs holding mine are added at the end of the field (`moved`).
 */
export function mergeBlocksFieldEdits(
  base: string,
  mine: string,
  theirs: string,
): { content: string; moved: boolean } {
  if (mine === theirs || mine === base)
    return { content: theirs, moved: false };
  if (theirs === base) return { content: mine, moved: false };
  // Mine comes from an editor; the others can be stored Markdown, so all
  // three compare in the form an editor holds them.
  const baseText = parsedForm(base);
  const mineText = parsedForm(mine);
  const theirText = parsedForm(theirs);
  if (baseText === null || mineText === null || theirText === null) {
    return { content: theirs, moved: true };
  }
  if (mineText === theirText || mineText === baseText) {
    return { content: theirs, moved: false };
  }
  if (theirText === baseText) return { content: mine, moved: false };
  // One side can already hold the other's changes, such as a save of mine
  // that landed before its answer reached the editor.
  if (bodyHoldsChanges(base, mineText, theirs)) {
    return { content: mine, moved: false };
  }
  if (bodyHoldsChanges(base, theirText, mine)) {
    return { content: theirs, moved: false };
  }

  const theirHunks = textHunks(baseText, theirText);
  const applied = new Set(theirHunks);
  const placed: TextHunk[] = [];
  const unplaced: Array<{ from: number; to: number }> = [];
  let shift = 0;
  for (const hunk of textHunks(baseText, mineText)) {
    const at = hunk.from + shift;
    shift += hunk.insert.length - (hunk.to - hunk.from);
    const overlaps = theirHunks.filter((other) =>
      textHunksOverlap(hunk, other),
    );
    const held =
      overlaps.length === 1 ? heldInsertion(hunk, overlaps[0]) : null;
    if (held) {
      if (held === hunk) {
        applied.delete(overlaps[0]);
        placed.push(hunk);
      }
    } else if (
      overlaps.length > 0 &&
      hunk.from === hunk.to &&
      overlaps.every(
        (other) => other.from === hunk.from && other.from === other.to,
      )
    ) {
      // Both typed at the same spot: keep both, theirs first.
      for (const other of overlaps) applied.delete(other);
      placed.push({
        from: hunk.from,
        to: hunk.to,
        insert: overlaps.map((other) => other.insert).join("") + hunk.insert,
      });
    } else if (
      overlaps.length > 0 &&
      overlaps.every(
        (other) =>
          other.from === hunk.from &&
          other.to === hunk.to &&
          other.insert === hunk.insert,
      )
    ) {
      // The same change on both sides.
    } else if (overlaps.length > 0) {
      if (hunk.insert) unplaced.push({ from: at, to: at + hunk.insert.length });
    } else {
      placed.push(hunk);
    }
  }

  let merged = baseText;
  for (const hunk of [...applied, ...placed].sort(
    (left, right) => right.from - left.from || right.to - left.to,
  )) {
    merged = `${merged.slice(0, hunk.from)}${hunk.insert}${merged.slice(hunk.to)}`;
  }
  // A merge that splits markup the editor can't hold keeps their text and
  // moves every paragraph of mine that changed.
  const mergedSpans = parsedForm(merged) === merged ? blockSpans(merged) : null;
  const mineSpans = blockSpans(mineText);
  if (!mergedSpans || !mineSpans) {
    const theirBlocks = parseStableBlocks(theirText);
    const baseBlocks = new Set(
      (parseStableBlocks(baseText) ?? []).map(stableBlock),
    );
    const mineBlocks = parseStableBlocks(mineText);
    if (!theirBlocks || !mineBlocks) return { content: theirs, moved: true };
    const kept = new Set(theirBlocks.map(stableBlock));
    const moved = mineBlocks.filter(
      (block) =>
        !baseBlocks.has(stableBlock(block)) && !kept.has(stableBlock(block)),
    );
    return {
      content: moved.length
        ? docToNfm({ type: "doc", content: [...theirBlocks, ...moved] })
        : theirs,
      moved: moved.length > 0,
    };
  }
  const kept = new Set(mergedSpans.map((span) => stableBlock(span.block)));
  const moved = mineSpans
    .filter((span) =>
      unplaced.some((range) => span.from < range.to && range.from < span.to),
    )
    .map((span) => span.block)
    .filter((block) => !kept.has(stableBlock(block)));
  if (!moved.length) return { content: merged, moved: false };
  return {
    content: docToNfm({
      type: "doc",
      content: [...mergedSpans.map((span) => span.block), ...moved],
    }),
    moved: true,
  };
}

function plainParagraphText(block: PMNode): string | null {
  if (block.type !== "paragraph" || block.attrs) return null;
  if (!block.content?.length) return "";
  if (
    block.content.some(
      (node) => node.type !== "text" || node.marks || node.attrs,
    )
  ) {
    return null;
  }
  return block.content.map((node) => node.text ?? "").join("");
}

function mergePlainParagraph(
  base: PMNode,
  candidate: PMNode,
  current: PMNode,
  incomingWins: boolean,
  appendStaleSameWriterInsertions = false,
): { block: PMNode; displaced: boolean } | null {
  const before = plainParagraphText(base);
  const desired = plainParagraphText(candidate);
  const existing = plainParagraphText(current);
  if (before === null || desired === null || existing === null) return null;
  const incomingHunks = textHunks(before, desired);
  const currentHunks = textHunks(before, existing);
  let displaced = false;
  const acceptedCurrent = new Set(currentHunks);
  const acceptedIncoming: TextHunk[] = [];
  for (const hunk of incomingHunks) {
    const overlaps = currentHunks.filter((other) =>
      textHunksOverlap(hunk, other),
    );
    const held =
      overlaps.length === 1 ? heldInsertion(hunk, overlaps[0]) : null;
    if (held) {
      if (held === hunk) {
        acceptedCurrent.delete(overlaps[0]);
        acceptedIncoming.push(hunk);
      }
    } else if (
      appendStaleSameWriterInsertions &&
      hunk.from === hunk.to &&
      overlaps.length === 1 &&
      overlaps[0].from === overlaps[0].to &&
      hunk.from === overlaps[0].from
    ) {
      acceptedCurrent.delete(overlaps[0]);
      acceptedIncoming.push({
        from: hunk.from,
        to: hunk.to,
        insert: `${overlaps[0].insert}${hunk.insert}`,
      });
    } else if (!overlaps.length) {
      acceptedIncoming.push(hunk);
    } else if (incomingWins) {
      for (const other of overlaps) acceptedCurrent.delete(other);
      acceptedIncoming.push(hunk);
    } else {
      displaced = true;
    }
  }
  const all = [...acceptedCurrent, ...acceptedIncoming].sort(
    (left, right) => right.from - left.from || right.to - left.to,
  );
  let merged = before;
  for (const hunk of all) {
    merged = `${merged.slice(0, hunk.from)}${hunk.insert}${merged.slice(hunk.to)}`;
  }
  return {
    block: {
      ...base,
      content: merged ? [{ type: "text", text: merged }] : undefined,
    },
    displaced,
  };
}

export function mergeDocumentBodyIntents(args: {
  authoredBaseContent: string;
  authoredCandidateContent: string;
  currentContent: string;
  currentRevision: number;
  incoming: DocumentBodyIntent;
  priorIntents: PriorDocumentBodyIntent[];
}): DocumentIntentMerge {
  if (
    args.currentRevision === args.incoming.authoredBaseRevision &&
    args.currentContent === args.authoredBaseContent
  ) {
    const base = nfmToDoc(args.authoredBaseContent).content;
    const candidate = nfmToDoc(args.authoredCandidateContent).content;
    const changedBlockIndexes =
      base.length === candidate.length
        ? base.flatMap((block, index) =>
            stableBlock(block) !== stableBlock(candidate[index]) ? [index] : [],
          )
        : [];
    return {
      status: "resolved",
      content: args.authoredCandidateContent,
      changedBlockIndexes,
      displaced: false,
    };
  }
  // The merge keeps blocks only from the candidate and the current body, so
  // those must serialize exactly. The base just tells which blocks each side
  // changed, and an editor holds a body in the form it parses to: an agent's
  // blank-line Markdown would otherwise divert every save authored on it.
  const baseContent = parsedForm(args.authoredBaseContent);
  const base = baseContent === null ? null : parseStableBlocks(baseContent);
  const candidate = parseStableBlocks(args.authoredCandidateContent);
  const current = parseStableBlocks(args.currentContent);
  if (baseContent === null || !base || !candidate || !current) {
    return { status: "preservation-required", reason: "structure" };
  }
  const baseKeys = base.map(stableBlock);
  const candidateKeys = candidate.map(stableBlock);
  const currentKeys = current.map(stableBlock);
  const baseText = comparableText(baseContent, base);
  const candidateText = comparableText(
    args.authoredCandidateContent,
    candidate,
  );
  const currentText = comparableText(args.currentContent, current);
  const comparable =
    baseText !== null && candidateText !== null && currentText !== null;
  if (comparable && holdsChanges(baseText, candidateText, currentText)) {
    return {
      status: "resolved",
      content: args.authoredCandidateContent,
      changedBlockIndexes:
        candidateKeys.length === currentKeys.length
          ? candidateKeys.flatMap((block, index) =>
              block !== currentKeys[index] ? [index] : [],
            )
          : [],
      displaced: false,
    };
  }
  if (comparable && holdsChanges(baseText, currentText, candidateText)) {
    return {
      status: "resolved",
      content: args.currentContent,
      changedBlockIndexes: [],
      displaced: false,
    };
  }
  if (base.length !== candidate.length || base.length !== current.length) {
    return { status: "preservation-required", reason: "structure" };
  }
  const changed = baseKeys.flatMap((block, index) =>
    block !== candidateKeys[index] || block !== currentKeys[index]
      ? [index]
      : [],
  );
  if (hasAmbiguousIdentity(baseKeys, candidateKeys, currentKeys, changed)) {
    return { status: "preservation-required", reason: "structure" };
  }
  const committed = args.priorIntents.filter(
    (intent) =>
      intent.canonicalChanged &&
      intent.committedRevision > args.incoming.authoredBaseRevision &&
      intent.committedRevision <= args.currentRevision,
  );
  const revisions = new Set(
    committed.map((intent) => intent.committedRevision),
  );
  if (
    revisions.size !==
    args.currentRevision - args.incoming.authoredBaseRevision
  ) {
    return { status: "preservation-required", reason: "provenance" };
  }

  const merged = [...current];
  let displaced = false;
  for (const index of changed) {
    if (candidateKeys[index] === baseKeys[index]) continue;
    if (
      currentKeys[index] === baseKeys[index] ||
      currentKeys[index] === candidateKeys[index]
    ) {
      merged[index] = candidate[index];
      continue;
    }
    const touching = committed.filter((intent) =>
      intent.affectedBlockIndexes.includes(index),
    );
    if (!touching.length) {
      return { status: "preservation-required", reason: "provenance" };
    }
    // The current block holds every touching intent's change, so the
    // incoming change replaces an overlapping one only when it orders after
    // all of them; otherwise the overlap is displaced.
    const orders = touching.map((prior) =>
      compareDocumentBodyIntents(args.incoming, prior),
    );
    if (orders.includes("same")) {
      return { status: "preservation-required", reason: "provenance" };
    }
    const incomingWins = orders.every(
      (order) =>
        order === "incoming-after" || order === "incoming-concurrent-wins",
    );
    const appendStaleSameWriterInsertions = touching.every(
      (prior) =>
        prior.writerId === args.incoming.writerId &&
        args.incoming.generation !== undefined &&
        prior.generation !== undefined &&
        args.incoming.generation > prior.generation &&
        args.incoming.authoredBaseRevision < prior.committedRevision,
    );
    const paragraph = mergePlainParagraph(
      base[index],
      candidate[index],
      current[index],
      incomingWins,
      appendStaleSameWriterInsertions,
    );
    if (paragraph) {
      merged[index] = paragraph.block;
      displaced ||= paragraph.displaced;
    } else if (incomingWins) {
      merged[index] = candidate[index];
    } else {
      displaced = true;
    }
  }
  const content = docToNfm({ type: "doc", content: merged });
  const changedBlockIndexes = merged.flatMap((block, index) =>
    stableBlock(block) !== currentKeys[index] ? [index] : [],
  );
  return { status: "resolved", content, changedBlockIndexes, displaced };
}
