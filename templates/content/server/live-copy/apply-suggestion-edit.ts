import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { updateYFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import {
  LIVE_BODY_FIELD,
  materializeLiveBody,
  type LiveBody,
} from "../../shared/live-body.js";
import {
  canonicalizeNfm,
  docToNfm,
  nfmToDoc,
  type PMNode,
} from "../../shared/nfm.js";
import {
  applyMarkdownSuggestionWithSiblings,
  markdownPayload,
  suggestionEditorSchema,
  supportedSuggestionStructure,
  withSiblingRanges,
  type MarkdownRange,
  type MarkdownSuggestionOperationLike,
} from "../../shared/suggestion-apply.js";
import { resolveMarkdownSuggestionRange } from "../../shared/suggestion-rebase.js";

// The live-copy edit that accepts suggestions. It runs in the bounded worker
// that hosts Content's live-copy tasks, so it must stay free of database and
// server imports.

export const APPLY_SUGGESTION_EDIT = "apply-suggestion";

export type ApplySuggestionStep = {
  operation: MarkdownSuggestionOperationLike;
  /** Ranges of accepted suggestions saved from the same before-text. */
  acceptedSiblingRanges: MarkdownRange[];
};

export type ApplySuggestionInput = {
  /**
   * One step per accepted suggestion, in decision order. A proposal's members
   * commit together, each placed on the text the steps before it left.
   */
  steps: ApplySuggestionStep[];
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
 * Where a step changed `current` to give `placed`: the suggestion's own range
 * when splicing it there gives `placed`, else the smallest edit between the
 * two texts. Next to text that repeats, the smallest edit can sit in the
 * wrong copy, so it is only for a suggestion saved without a range.
 */
function changedRange(
  current: string,
  step: ApplySuggestionStep,
  placed: string,
): MarkdownRange {
  const { operation, acceptedSiblingRanges } = step;
  const changedText = markdownPayload(operation.after, "after").changedText;
  const gives = (range: MarkdownRange | null): range is MarkdownRange =>
    range !== null &&
    typeof changedText === "string" &&
    `${current.slice(0, range.from)}${changedText}${current.slice(range.to)}` ===
      placed;
  const direct = resolveMarkdownSuggestionRange(current, operation);
  if (gives(direct)) return direct;
  // A suggestion saved as the whole page before and after may have no range,
  // and it never needed the siblings' ranges to place.
  if (
    acceptedSiblingRanges.length &&
    markdownPayload(operation.before, "before").markdown !== current
  ) {
    const across = resolveMarkdownSuggestionRange(
      current,
      withSiblingRanges(operation, acceptedSiblingRanges),
    );
    if (gives(across)) return across;
  }
  const prefix = commonPrefixLength(current, placed);
  const suffix = commonSuffixLength(current, placed, prefix);
  return { from: prefix, to: current.length - suffix };
}

const nodeKey = (node: ProseMirrorNode) => JSON.stringify(node.toJSON());

type UpdateMeta = Parameters<typeof updateYFragment>[3];

/** A node of the live page, with where it sits in the page text. */
type LocatedNode = {
  node: ProseMirrorNode;
  /** Where its own Markdown sits in the page text. */
  span: BlockSpan;
  /** The top-level block it is in, and where its content starts there. */
  block: { node: ProseMirrorNode; span: BlockSpan };
  contentStart: number;
};

/**
 * The children of `container`, located in the page text by serializing its
 * block cut before and after each one. Null when a cut doesn't serialize as
 * a prefix of the block, as with blocks that close with a tag.
 */
function locateChildren(
  container: LocatedNode,
  current: string,
): LocatedNode[] | null {
  const { block } = container;
  const text = current.slice(block.span.from, block.span.to);
  const prefixLength = (position: number) => {
    const cut = docToNfm({
      type: "doc",
      content: [block.node.cut(0, position).toJSON() as PMNode],
    });
    return text.startsWith(cut) ? cut.length : -1;
  };
  const children: LocatedNode[] = [];
  let located = true;
  container.node.forEach((node, offset) => {
    const start = prefixLength(container.contentStart + offset);
    const end = prefixLength(container.contentStart + offset + node.nodeSize);
    if (start < 0 || end < start) located = false;
    const own = text.slice(start, end);
    children.push({
      node,
      span: {
        from: block.span.from + start + own.length - own.trimStart().length,
        to: block.span.from + end,
      },
      block,
      contentStart: container.contentStart + offset + 1,
    });
  });
  return located ? children : null;
}

/** Gives `element` the attributes of `node`, as updateYFragment does. */
function updateAttributes(element: Y.XmlElement, node: ProseMirrorNode) {
  const attributes = element.getAttributes();
  for (const [key, value] of Object.entries(node.attrs)) {
    if (value === null) element.removeAttribute(key);
    else if (key !== "ychange" && attributes[key] !== value)
      element.setAttribute(key, value as string);
  }
  for (const key of Object.keys(attributes))
    if (node.attrs[key] === undefined) element.removeAttribute(key);
}

/**
 * Rewrites `elements`, the children of `parent` from `at` that hold `olds`,
 * to hold `news`, for the change at `range`. Children keep their elements by
 * where they sit, not by what they say: of two that read the same, the one
 * outside the change keeps its element, and with it any edit a peer made
 * there concurrently. Where the text can't place them, a child that could
 * keep either of two elements is refused.
 */
function rewriteChildren(
  edit: {
    scratch: Y.Doc;
    meta: UpdateMeta;
    current: string;
    range: MarkdownRange;
  },
  parent: Y.XmlFragment | Y.XmlElement,
  at: number,
  elements: readonly unknown[],
  olds: readonly LocatedNode[] | null,
  oldNodes: readonly ProseMirrorNode[],
  news: readonly ProseMirrorNode[],
): ApplySuggestionRefusal | undefined {
  const { scratch, meta, range } = edit;
  const oldKeys = oldNodes.map(nodeKey);
  const newKeys = news.map(nodeKey);
  const same = (oldIndex: number, newIndex: number) =>
    oldKeys[oldIndex] === newKeys[newIndex];
  let left = 0;
  let right = 0;
  // A child wholly outside the change that reads the same keeps its element.
  if (olds) {
    while (
      left < oldKeys.length &&
      left < newKeys.length &&
      olds[left]!.span.to <= range.from &&
      same(left, left)
    )
      left += 1;
    while (
      left + right < oldKeys.length &&
      left + right < newKeys.length &&
      olds[oldKeys.length - 1 - right]!.span.from >= range.to &&
      same(oldKeys.length - 1 - right, newKeys.length - 1 - right)
    )
      right += 1;
  }
  // Inside the change, a child that reads the same at either end keeps its
  // element, and the rest are rewritten in place where their kind allows.
  const matchedLeft = left;
  const matchedRight = right;
  while (
    left + right < oldKeys.length &&
    left + right < newKeys.length &&
    same(left, left)
  )
    left += 1;
  while (
    left + right < oldKeys.length &&
    left + right < newKeys.length &&
    same(oldKeys.length - 1 - right, newKeys.length - 1 - right)
  )
    right += 1;
  if (!olds && oldKeys.length !== newKeys.length) {
    // Matching from the right first must keep the same elements.
    let rightFirst = matchedRight;
    while (
      matchedLeft + rightFirst < oldKeys.length &&
      matchedLeft + rightFirst < newKeys.length &&
      same(oldKeys.length - 1 - rightFirst, newKeys.length - 1 - rightFirst)
    )
      rightFirst += 1;
    if (rightFirst !== right)
      return refused("suggestion_unmappable", "repeated blocks");
  }

  const insert = (index: number, node: ProseMirrorNode) => {
    const element = new Y.XmlElement(node.type.name);
    parent.insert(index, [element]);
    updateYFragment(scratch, element, node, meta);
  };
  const start = at + left;
  const replaced = elements.slice(left, elements.length - right);
  const replacing = news.slice(left, news.length - right);
  const paired = Math.min(replaced.length, replacing.length);
  for (let index = 0; index < paired; index += 1) {
    const element = replaced[index];
    const old = oldNodes[left + index]!;
    const node = replacing[index]!;
    if (
      !(element instanceof Y.XmlElement) ||
      element.nodeName !== node.type.name
    ) {
      parent.delete(start + index, 1);
      insert(start + index, node);
      continue;
    }
    const children = element.toArray();
    if (
      old.isTextblock ||
      node.isTextblock ||
      !children.length ||
      children.length !== old.childCount ||
      children.some((child) => !(child instanceof Y.XmlElement))
    ) {
      updateYFragment(scratch, element, node, meta);
      continue;
    }
    updateAttributes(element, node);
    const located = olds
      ? locateChildren(olds[left + index]!, edit.current)
      : null;
    const nodes: ProseMirrorNode[] = [];
    const nextNodes: ProseMirrorNode[] = [];
    old.forEach((child) => nodes.push(child));
    node.forEach((child) => nextNodes.push(child));
    const refusal = rewriteChildren(
      edit,
      element,
      0,
      children,
      located,
      nodes,
      nextNodes,
    );
    if (refusal) return refusal;
  }
  if (replaced.length > paired)
    parent.delete(start + paired, replaced.length - paired);
  for (let index = paired; index < replacing.length; index += 1)
    insert(start + index, replacing[index]!);
}

/**
 * Rewrites the top-level blocks the change at `range` meets, so `fragment`
 * reads `placed`, and returns the text it should now read.
 */
function rewriteBlocks(
  scratch: Y.Doc,
  fragment: Y.XmlFragment,
  live: Extract<LiveBody, { kind: "body" }>,
  range: MarkdownRange,
  placed: string,
): string | ApplySuggestionRefusal {
  const current = live.markdown;
  const liveJson = live.root.toJSON() as PMNode;
  const blocks = liveJson.content ?? [];
  const spans = locateBlocks(blocks, current);
  const elements = fragment.toArray();
  if (!spans?.length || elements.length !== spans.length)
    return refused("suggestion_unmappable", "block layout");

  // The blocks whose span meets the change, ends included, plus one neighbor
  // on each side: blank lines and list continuations parse differently
  // without the block beside them.
  let first = spans.findIndex((span) => span.to >= range.from);
  if (first < 0) first = spans.length - 1;
  let last = first;
  while (last + 1 < spans.length && spans[last + 1]!.from <= range.to)
    last += 1;
  first = Math.max(0, first - 1);
  last = Math.min(spans.length - 1, last + 1);
  const segmentFrom = Math.min(range.from, spans[first]!.from);
  const segmentTo = Math.max(range.to, spans[last]!.to);
  const replacedSegment = placed.slice(
    segmentFrom,
    placed.length - (current.length - segmentTo),
  );
  const replacement = replacedSegment.trim()
    ? (nfmToDoc(replacedSegment).content ?? [])
    : [];

  let nextRoot: ProseMirrorNode;
  try {
    nextRoot = suggestionEditorSchema().nodeFromJSON({
      ...liveJson,
      content: [
        ...blocks.slice(0, first),
        ...replacement,
        ...blocks.slice(last + 1),
      ],
    });
    nextRoot.check();
  } catch (error) {
    return refused(
      "suggestion_unmappable",
      error instanceof Error ? error.message : "invalid document",
    );
  }
  const nextMarkdown = docToNfm(nextRoot.toJSON());
  // Outside the rewritten blocks the text must be byte-for-byte what it was,
  // and the whole page must read as the suggestion's own result.
  if (
    !nextMarkdown.startsWith(current.slice(0, segmentFrom)) ||
    !nextMarkdown.endsWith(current.slice(segmentTo)) ||
    canonicalizeNfm(nextMarkdown) !== canonicalizeNfm(placed)
  ) {
    return refused("suggestion_unmappable", "result differs");
  }

  const outside = [...elements.slice(0, first), ...elements.slice(last + 1)];
  const outsideText = outside.map((element) => element.toString());
  const window: LocatedNode[] = [];
  for (let index = first; index <= last; index += 1) {
    const node = live.root.child(index);
    const span = spans[index]!;
    window.push({ node, span, block: { node, span }, contentStart: 0 });
  }
  const refusal = scratch.transact(() =>
    rewriteChildren(
      {
        scratch,
        meta: { mapping: new Map(), isOMark: new Map() },
        current,
        range,
      },
      fragment,
      first,
      elements.slice(first, last + 1),
      window,
      window.map((located) => located.node),
      replacement.map((_, index) => nextRoot.child(first + index)),
    ),
  );
  if (refusal) return refusal;
  const after = fragment.toArray();
  const kept = [
    ...after.slice(0, first),
    ...after.slice(after.length - (elements.length - last - 1)),
  ];
  if (
    kept.length !== outside.length ||
    kept.some(
      (element, index) =>
        element !== outside[index] || element.toString() !== outsideText[index],
    )
  ) {
    return refused("suggestion_unmappable", "untouched block changed");
  }
  return nextMarkdown;
}

/**
 * Accepts suggestions on a live copy. They are placed on the page text the
 * live copy derives, never on a stored copy that may lag it, and only the
 * top-level blocks whose text they change are rewritten. Every other block
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
    const fragment = scratch.getXmlFragment(field);
    let live = materializeLiveBody(scratch);
    if (live.kind !== "body")
      return refused("suggestion_unmappable", `live copy is ${live.kind}`);
    if (live.markdown.includes("<InlineDatabase"))
      return refused("suggestion_body_unavailable", "inline database");

    if (!input.steps.length)
      return refused("suggestion_unmappable", "no steps");
    let changed = false;
    // Each step is placed on, and rewrites, the blocks the steps before it
    // left, so every change is found where it sits on the page.
    for (const [index, step] of input.steps.entries()) {
      const current = live.markdown;
      const placed = applyMarkdownSuggestionWithSiblings(
        current,
        step.operation,
        step.acceptedSiblingRanges,
      );
      if (placed === null) return refused("suggestion_stale", `step ${index}`);
      if (!supportedSuggestionStructure(current, placed))
        return refused("suggestion_structure_unsupported", `step ${index}`);
      if (placed === current) continue;
      const rewritten = rewriteBlocks(
        scratch,
        fragment,
        live,
        changedRange(current, step, placed),
        placed,
      );
      if (typeof rewritten !== "string") return rewritten;
      live = materializeLiveBody(scratch);
      if (live.kind !== "body")
        return refused(
          "suggestion_unmappable",
          `step ${index} left the live copy ${live.kind}`,
        );
      if (canonicalizeNfm(live.markdown) !== canonicalizeNfm(rewritten))
        return refused("suggestion_unmappable", "result differs");
      changed = true;
    }
    if (!changed) return;
    Y.applyUpdate(
      doc,
      Y.encodeStateAsUpdate(scratch, Y.encodeStateVector(doc)),
    );
  } finally {
    scratch.destroy();
  }
}
