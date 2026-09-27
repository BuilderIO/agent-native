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

function textHunksOverlap(left: TextHunk, right: TextHunk): boolean {
  if (left.from === left.to && right.from === right.to)
    return left.from === right.from;
  if (left.from === left.to)
    return right.from < left.from && left.from < right.to;
  if (right.from === right.to)
    return left.from < right.from && right.from < left.to;
  return left.from < right.to && right.from < left.to;
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
    if (!overlaps.length) {
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

/**
 * Resolve block replacements only where the original block identity and every
 * intervening canonical writer are known. Inserts, moves, and duplicate target
 * blocks need a richer identity proof and remain recoverable instead.
 */
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
  const base = parseStableBlocks(args.authoredBaseContent);
  const candidate = parseStableBlocks(args.authoredCandidateContent);
  const current = parseStableBlocks(args.currentContent);
  if (!base || !candidate || !current) {
    return { status: "preservation-required", reason: "structure" };
  }
  if (base.length !== candidate.length || base.length !== current.length) {
    return { status: "preservation-required", reason: "structure" };
  }
  const baseKeys = base.map(stableBlock);
  const candidateKeys = candidate.map(stableBlock);
  const currentKeys = current.map(stableBlock);
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
    if (touching.length !== 1) {
      return { status: "preservation-required", reason: "provenance" };
    }
    const prior = touching[0];
    const order = compareDocumentBodyIntents(args.incoming, prior);
    if (order === "same") {
      return { status: "preservation-required", reason: "provenance" };
    }
    const incomingWins =
      order === "incoming-after" || order === "incoming-concurrent-wins";
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
