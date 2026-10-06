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
  // The base compares in the form an editor holds it, as in the merge.
  const [baseText, holderText, otherText] = [
    parsedForm(base),
    holder,
    other,
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
    const paragraph = mergePlainParagraph(
      base[index],
      candidate[index],
      current[index],
      incomingWins,
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
