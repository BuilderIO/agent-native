import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { updateYFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { LIVE_BODY_FIELD, materializeLiveBody } from "../../shared/live-body.js";
import {
  canonicalizeNfm,
  docToNfm,
  nfmToDoc,
  type PMNode,
} from "../../shared/nfm.js";
import {
  applyMarkdownSuggestionWithSiblings,
  suggestionEditorSchema,
  supportedSuggestionStructure,
  type MarkdownRange,
  type MarkdownSuggestionOperationLike,
} from "../../shared/suggestion-apply.js";

// The live-copy edit that accepts one suggestion. It runs in the bounded
// worker that hosts Content's live-copy tasks, so it must stay free of
// database and server imports.

export const APPLY_SUGGESTION_EDIT = "apply-suggestion";

export type ApplySuggestionInput = {
  operation: MarkdownSuggestionOperationLike;
  /** Ranges of accepted suggestions saved from the same before-text. */
  acceptedSiblingRanges: MarkdownRange[];
};

export const APPLY_SUGGESTION_REFUSALS = [
  // The text the suggestion is anchored to is no longer on the page.
  "suggestion_stale",
  // The change would alter a structure suggestions cannot review.
  "suggestion_structure_unsupported",
  // The page holds content a suggestion may not be accepted into.
  "suggestion_body_unavailable",
  // The change can't be confined to the blocks it touches.
  "suggestion_unmappable",
] as const;

export type ApplySuggestionRefusalReason =
  (typeof APPLY_SUGGESTION_REFUSALS)[number];

export type ApplySuggestionRefusal = {
  kind: "refused";
  reason: ApplySuggestionRefusalReason;
  detail?: string;
};

type BlockSpan = { from: number; to: number };

/**
 * Where each top-level block's own Markdown sits in `markdown`, which must be
 * the blocks serialized together. Null when a block serializes differently
 * alone, or when anything but whitespace separates two blocks: then an edit
 * can't be confined to the blocks whose text it changes.
 */
function locateBlocks(
  blocks: readonly PMNode[],
  markdown: string,
): BlockSpan[] | null {
  const spans: BlockSpan[] = [];
  let cursor = 0;
  for (const block of blocks) {
    const text = docToNfm({ type: "doc", content: [block] });
    const at = markdown.indexOf(text, cursor);
    if (at < 0 || markdown.slice(cursor, at).trim()) return null;
    spans.push({ from: at, to: at + text.length });
    cursor = at + text.length;
  }
  return markdown.slice(cursor).trim() ? null : spans;
}

function commonPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left[length] === right[length]) length += 1;
  return length;
}

function commonSuffixLength(left: string, right: string, floor: number) {
  const limit = Math.min(left.length, right.length) - floor;
  let length = 0;
  while (
    length < limit &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  )
    length += 1;
  return length;
}

function refused(
  reason: ApplySuggestionRefusalReason,
  detail?: string,
): ApplySuggestionRefusal {
  return detail
    ? { kind: "refused", reason, detail }
    : { kind: "refused", reason };
}

/**
 * Accepts one suggestion on a live copy. The suggestion is placed on the page
 * text the live copy derives, never on a stored copy that may lag it, and only
 * the top-level blocks whose text it changes are rewritten. Every other block
 * keeps its Yjs element untouched, so concurrent edits elsewhere merge and
 * nothing outside the change moves. A refusal leaves `doc` as it was.
 */
export function applySuggestionEdit(
  doc: Y.Doc,
  field: string,
  input: ApplySuggestionInput,
): void | ApplySuggestionRefusal {
  if (field !== LIVE_BODY_FIELD)
    return refused("suggestion_unmappable", `field ${field}`);
  // Reading the tree deletes what the schema rejects, and the edit is checked
  // after it runs, so both happen on a copy; `doc` only takes a checked diff.
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
    const live = materializeLiveBody(scratch);
    if (live.kind !== "body")
      return refused("suggestion_unmappable", `live copy is ${live.kind}`);
    const current = live.markdown;
    if (current.includes("<InlineDatabase"))
      return refused("suggestion_body_unavailable", "inline database");

    const next = applyMarkdownSuggestionWithSiblings(
      current,
      input.operation,
      input.acceptedSiblingRanges,
    );
    if (next === null) return refused("suggestion_stale");
    if (next === current) return;
    if (!supportedSuggestionStructure(current, next))
      return refused("suggestion_structure_unsupported");

    const liveJson = live.root.toJSON() as PMNode;
    const blocks = liveJson.content ?? [];
    const spans = locateBlocks(blocks, current);
    if (!spans?.length) return refused("suggestion_unmappable", "block layout");

    // The changed range of the page text, as the smallest edit between the
    // two texts: placement can return a range wider than what changes.
    const prefix = commonPrefixLength(current, next);
    const suffix = commonSuffixLength(current, next, prefix);
    const changeFrom = prefix;
    const changeTo = current.length - suffix;

    // The blocks whose span meets the change, ends included, plus one
    // neighbor on each side: blank lines and list continuations parse
    // differently without the block beside them. Rewriting an unchanged
    // neighbor is free, because its Yjs element compares equal and is kept.
    let first = spans.findIndex((span) => span.to >= changeFrom);
    if (first < 0) first = spans.length - 1;
    let last = first;
    while (last + 1 < spans.length && spans[last + 1]!.from <= changeTo)
      last += 1;
    first = Math.max(0, first - 1);
    last = Math.min(spans.length - 1, last + 1);
    const segmentFrom = Math.min(changeFrom, spans[first]!.from);
    const segmentTo = Math.max(changeTo, spans[last]!.to);
    const replacedSegment = next.slice(
      segmentFrom,
      next.length - (current.length - segmentTo),
    );
    const replacement = replacedSegment.trim()
      ? (nfmToDoc(replacedSegment).content ?? [])
      : [];
    const nextJson: PMNode = {
      ...liveJson,
      content: [
        ...blocks.slice(0, first),
        ...replacement,
        ...blocks.slice(last + 1),
      ],
    };

    let nextRoot: ProseMirrorNode;
    try {
      nextRoot = suggestionEditorSchema().nodeFromJSON(nextJson);
      nextRoot.check();
    } catch (error) {
      return refused(
        "suggestion_unmappable",
        error instanceof Error ? error.message : "invalid document",
      );
    }
    const nextMarkdown = docToNfm(nextRoot.toJSON());
    // Outside the rewritten blocks the text must be byte-for-byte what it
    // was, and the whole page must read as the suggestion's own result.
    if (
      !nextMarkdown.startsWith(current.slice(0, segmentFrom)) ||
      !nextMarkdown.endsWith(current.slice(segmentTo)) ||
      canonicalizeNfm(nextMarkdown) !== canonicalizeNfm(next)
    ) {
      return refused("suggestion_unmappable", "result differs");
    }

    const fragment = scratch.getXmlFragment(field);
    const elementsBefore = fragment.toArray();
    const untouched = [
      ...elementsBefore.slice(0, first),
      ...elementsBefore.slice(last + 1),
    ];
    const untouchedText = untouched.map((element) => element.toString());
    updateYFragment(scratch, fragment, nextRoot, {
      mapping: new Map(),
      isOMark: new Map(),
    });
    const elementsAfter = fragment.toArray();
    const keptElements = [
      ...elementsAfter.slice(0, first),
      ...elementsAfter.slice(elementsAfter.length - (blocks.length - last - 1)),
    ];
    if (
      keptElements.length !== untouched.length ||
      keptElements.some(
        (element, index) =>
          element !== untouched[index] ||
          element.toString() !== untouchedText[index],
      )
    ) {
      return refused("suggestion_unmappable", "untouched block changed");
    }
    Y.applyUpdate(
      doc,
      Y.encodeStateAsUpdate(scratch, Y.encodeStateVector(doc)),
    );
  } finally {
    scratch.destroy();
  }
}
