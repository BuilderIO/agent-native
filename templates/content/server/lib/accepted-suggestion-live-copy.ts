import {
  Fragment,
  Slice,
  type Node as ProseMirrorNode,
  type Schema,
} from "@tiptap/pm/model";
import {
  prosemirrorJSONToYXmlFragment,
  updateYFragment,
  yXmlFragmentToProsemirrorJSON,
} from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { docToNfm, type PMNode } from "../../shared/nfm.js";
import {
  parseSuggestionPlacement,
  WORD_CHARACTER,
  type SuggestionPlacement,
} from "../../shared/suggestion-placement.js";

/** Where the stored Page and the accepted result first and last differ. */
type StoredChange = {
  start: number;
  endBefore: number;
  endAfter: number;
  /** Where the text both share at the end starts in the stored Page. */
  sharedEnd: number;
};

const OBJECT_REPLACEMENT = "￼";
// Every runtime this serves has Intl.Segmenter; its types arrive with ES2022.
type GraphemeSegmenter = {
  segment(text: string): Iterable<{ segment: string }>;
};
const graphemes = new (
  Intl as unknown as {
    Segmenter: new (
      locales: undefined,
      options: { granularity: "grapheme" },
    ) => GraphemeSegmenter;
  }
).Segmenter(undefined, { granularity: "grapheme" });

function readLiveCopy(
  fragment: Y.XmlFragment,
  schema: Schema,
): ProseMirrorNode | null {
  try {
    return schema.nodeFromJSON(yXmlFragmentToProsemirrorJSON(fragment));
  } catch {
    // coercion-ok: a live copy this schema can't read takes the stored result.
    return null;
  }
}

function storedChange(
  before: ProseMirrorNode,
  after: ProseMirrorNode,
): StoredChange | null {
  const start = before.content.findDiffStart(after.content);
  if (start === null) return null;
  const end = before.content.findDiffEnd(after.content)!;
  let endBefore = end.a;
  let endAfter = end.b;
  // Along repeated text the two ends cross; the shorter side stays empty.
  if (endBefore < start && before.content.size < after.content.size) {
    endAfter = start + (endAfter - endBefore);
    endBefore = start;
  } else if (endAfter < start) {
    endBefore = start + (endBefore - endAfter);
    endAfter = start;
  }
  return { start, endBefore, endAfter, sharedEnd: end.a };
}

function textOnly(content: Fragment): boolean {
  let text = true;
  content.forEach((node) => {
    if (!node.isText) text = false;
  });
  return text;
}

function plainText(text: Y.XmlText): string {
  return text
    .toDelta()
    .map((op: { insert?: unknown }) =>
      typeof op.insert === "string" ? op.insert : OBJECT_REPLACEMENT,
    )
    .join("");
}

/** The smallest edit from one text to another that keeps characters whole. */
function textSplice(before: string, after: string) {
  const a = Array.from(graphemes.segment(before), (part) => part.segment);
  const b = Array.from(graphemes.segment(after), (part) => part.segment);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail += 1;
  return {
    at: a.slice(0, head).join("").length,
    remove: a.slice(head, a.length - tail).join("").length,
    insert: b.slice(head, b.length - tail).join(""),
  };
}

/**
 * Deletes `length` characters at `index`. y-prosemirror records typing as
 * far right as the text allows, so a space typed before " cat" goes in after
 * that word's space. When the deleted text starts with a space and the same
 * space, formatted the same, follows it, the deletion moves right past it and
 * that typing stays whole. Only spaces move it: a repeated word could be one
 * someone else is editing.
 */
function deleteText(text: Y.XmlText, index: number, length: number) {
  const characters = plainText(text);
  const formats = text
    .toDelta()
    .flatMap((op: { insert?: unknown; attributes?: unknown }) =>
      Array<string>(typeof op.insert === "string" ? op.insert.length : 1).fill(
        JSON.stringify(op.attributes ?? {}),
      ),
    );
  let start = index;
  while (
    /\s/u.test(characters[start] ?? "") &&
    characters[start] === characters[start + length] &&
    formats[start] === formats[start + length]
  )
    start += 1;
  text.delete(start, length);
}

/**
 * Replaces `from` with `to` in `text` at `offset`. Yjs places new text by the
 * characters on either side of it, and puts anyone else's typing between the
 * same two characters in client order. So the new text goes in between code
 * points inside `from`, where nobody typing beside it is, before the old text
 * is deleted. That can be inside an emoji with a skin tone, which is deleted
 * whole. A code point next to the change is retyped when the change has no
 * inside of its own.
 */
function spliceText(text: Y.XmlText, offset: number, from: string, to: string) {
  const { at, remove, insert } = textSplice(from, to);
  if (!insert) {
    if (remove) deleteText(text, offset + at, remove);
    return;
  }
  const boundaries = [0];
  for (const character of from)
    boundaries.push(boundaries[boundaries.length - 1]! + character.length);
  const lastBefore = (limit: number) =>
    boundaries.reduce((best, boundary) => (boundary < limit ? boundary : best));
  let start = at;
  let end = at + remove;
  let anchor = at;
  if (remove) {
    // Between the last two code points replaced, or after a lone one.
    const inside = lastBefore(end);
    anchor = inside > at ? inside : end < from.length || at === 0 ? end : at;
  } else if (at === 0) {
    // New text at the start goes in after the first code point, retyped.
    end = boundaries[1] ?? 0;
    anchor = end;
  } else {
    // New text follows what's before it, so it goes in ahead of the code
    // point before it, retyped, rather than beside what comes next.
    const previous = lastBefore(at);
    if (previous > 0) {
      start = previous;
      anchor = previous;
    }
  }
  const replacement =
    from.slice(start, at) + insert + from.slice(at + remove, end);
  text.insert(offset + anchor, replacement);
  if (end > anchor)
    text.delete(offset + anchor + replacement.length, end - anchor);
  if (anchor > start) text.delete(offset + start, anchor - start);
}

/**
 * Brings the live copy to `target`. Text already matches wherever a splice
 * put it there, so this only changes formatting and anything else that
 * differs, block by block.
 */
function syncLiveCopy(
  doc: Y.Doc,
  fragment: Y.XmlFragment,
  target: ProseMirrorNode,
) {
  updateYFragment(doc, fragment, target, {
    mapping: new Map(),
    isOMark: new Map(),
  });
}

function childPosition(node: ProseMirrorNode, index: number): number {
  let position = 0;
  for (let child = 0; child < index; child += 1)
    position += node.child(child).nodeSize;
  return position;
}

/** The live copy's element for the node starting at `position`. */
function liveElementAt(
  fragment: Y.XmlFragment,
  live: ProseMirrorNode,
  position: number,
): Y.XmlElement | null {
  const $inside = live.resolve(position + 1);
  let type: Y.XmlFragment = fragment;
  for (let depth = 0; depth < $inside.depth; depth += 1) {
    const child: unknown = type.get($inside.index(depth));
    if (
      !(child instanceof Y.XmlElement) ||
      child.nodeName !== $inside.node(depth + 1).type.name
    )
      return null;
    type = child;
  }
  return type instanceof Y.XmlElement ? type : null;
}

/** The textblock holding `text` in the live copy, and where it starts. */
function liveTextblock(
  fragment: Y.XmlFragment,
  live: ProseMirrorNode,
  text: Y.XmlText,
) {
  const element = text.parent;
  if (!(element instanceof Y.XmlElement)) return null;
  const path: number[] = [];
  for (let type: Y.XmlFragment = element; type !== fragment; ) {
    const parent: unknown = type.parent;
    if (!(parent instanceof Y.XmlFragment)) return null;
    const index = parent.toArray().indexOf(type as Y.XmlElement);
    if (index < 0) return null;
    path.unshift(index);
    type = parent;
  }
  let node = live;
  let start = 0;
  for (const index of path) {
    if (index >= node.childCount) return null;
    start += childPosition(node, index) + 1;
    node = node.child(index);
  }
  if (!node.isTextblock || node.type.name !== element.nodeName) return null;
  let offset: number | null = null;
  let size = 0;
  for (const child of element.toArray()) {
    if (child === text) offset = size;
    size += child instanceof Y.XmlText ? child.length : 1;
  }
  if (offset === null || size !== node.content.size) return null;
  return { node, start, offset };
}

/** The live range a placement points at, when both ends share one text. */
function placedRange(
  doc: Y.Doc,
  fragment: Y.XmlFragment,
  live: ProseMirrorNode,
  placement: SuggestionPlacement,
) {
  let from: Y.AbsolutePosition | null;
  let to: Y.AbsolutePosition | null;
  try {
    from = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(placement.from),
      doc,
    );
    to = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(placement.to),
      doc,
    );
  } catch {
    // coercion-ok: a placement this live copy can't resolve isn't used.
    return null;
  }
  if (
    !from ||
    !to ||
    from.type !== to.type ||
    !(from.type instanceof Y.XmlText) ||
    from.index > to.index
  )
    return null;
  const text = from.type;
  const textblock = liveTextblock(fragment, live, text);
  if (!textblock) return null;
  return {
    text,
    from: from.index,
    to: to.index,
    textblock: textblock.node,
    // Offsets inside the textblock.
    blockFrom: textblock.offset + from.index,
    blockTo: textblock.offset + to.index,
    // Positions in the live Page.
    pageFrom: textblock.start + textblock.offset + from.index,
    pageTo: textblock.start + textblock.offset + to.index,
  };
}

function characterBeside(
  textblock: ProseMirrorNode,
  offset: number,
  side: "before" | "after",
): string {
  if (side === "before") {
    const text = textblock.textBetween(
      Math.max(0, offset - 2),
      offset,
      "",
      OBJECT_REPLACEMENT,
    );
    const characters = Array.from(text);
    return characters[characters.length - 1] ?? "";
  }
  const text = textblock.textBetween(
    offset,
    Math.min(textblock.content.size, offset + 2),
    "",
    OBJECT_REPLACEMENT,
  );
  return Array.from(text)[0] ?? "";
}

/**
 * Writes the change where the reviewer saw the words, when they still read
 * the same there and the change stays inside them.
 */
function writeAtPlacement(
  doc: Y.Doc,
  fragment: Y.XmlFragment,
  live: ProseMirrorNode,
  before: ProseMirrorNode,
  after: ProseMirrorNode,
  change: StoredChange,
  placement: SuggestionPlacement,
): boolean {
  const range = placedRange(doc, fragment, live, placement);
  if (!range) return false;
  const length = range.pageTo - range.pageFrom;
  const seen = range.textblock.content.cut(range.blockFrom, range.blockTo);
  const growth = after.content.size - before.content.size;
  // The same words in the stored Page, wherever they hold the whole change.
  let chosen: {
    from: number;
    to: number;
    textblock: ProseMirrorNode;
    offset: number;
    replacement: Fragment;
  } | null = null;
  const last = Math.min(change.start, before.content.size - length);
  for (
    let from = Math.max(0, change.sharedEnd - length);
    from <= last;
    from++
  ) {
    const to = from + length;
    if (to + growth < from) continue;
    const $from = before.resolve(from);
    const $to = before.resolve(to);
    const $next = after.resolve(from);
    const $nextEnd = after.resolve(to + growth);
    if (
      !$from.parent.isTextblock ||
      !$from.sameParent($to) ||
      !$next.parent.isTextblock ||
      !$next.sameParent($nextEnd)
    )
      continue;
    const offset = from - $from.start();
    if (!$from.parent.content.cut(offset, offset + length).eq(seen)) continue;
    const replacement = $next.parent.content.cut(
      from - $next.start(),
      to + growth - $next.start(),
    );
    // Lookalike text that would take different edits: not sure which.
    if (chosen && !chosen.replacement.eq(replacement)) return false;
    chosen ??= { from, to, textblock: $from.parent, offset, replacement };
  }
  if (!chosen) return false;
  let target: ProseMirrorNode;
  try {
    const replacement = new Slice(chosen.replacement, 0, 0);
    if (!before.replace(chosen.from, chosen.to, replacement).eq(after))
      return false;
    target = live.replace(range.pageFrom, range.pageTo, replacement);
  } catch {
    // coercion-ok: a change this range can't hold goes through the fallback.
    return false;
  }
  // A letter typed onto either end makes a different word than was reviewed.
  // An end that is a space or punctuation has no word for a letter to join.
  for (const side of ["before", "after"] as const) {
    const edge = side === "before" ? range.blockFrom : range.blockTo;
    const inside = characterBeside(
      range.textblock,
      edge,
      side === "before" ? "after" : "before",
    );
    if (length > 0 && !WORD_CHARACTER.test(inside)) continue;
    const liveCharacter = characterBeside(range.textblock, edge, side);
    const storedCharacter = characterBeside(
      chosen.textblock,
      side === "before" ? chosen.offset : chosen.offset + length,
      side,
    );
    if (liveCharacter !== storedCharacter && WORD_CHARACTER.test(liveCharacter))
      return false;
  }
  const replacement = chosen.replacement;
  doc.transact(() => {
    const was = plainText(range.text).slice(range.from, range.to);
    if (
      textOnly(replacement) &&
      was === seen.textBetween(0, seen.size, "", OBJECT_REPLACEMENT)
    )
      spliceText(
        range.text,
        range.from,
        was,
        replacement.textBetween(0, replacement.size),
      );
    syncLiveCopy(doc, fragment, target);
  });
  return true;
}

/** Where `page` holds a paragraph reading exactly `stored`, if only once. */
function uniqueTextblock(
  page: ProseMirrorNode,
  stored: ProseMirrorNode,
): number | null {
  let found: number | null = null;
  let count = 0;
  page.descendants((node, position) => {
    if (count > 1) return false;
    if (!node.isTextblock) return true;
    if (node.eq(stored)) {
      found = position;
      count += 1;
    }
    return false;
  });
  return count === 1 ? found : null;
}

/**
 * Where the stored blocks `first` to `end` sit in the live copy: they must
 * match exactly, and the blocks around them place them when they repeat.
 */
function liveBlockRun(
  live: ProseMirrorNode,
  before: ProseMirrorNode,
  first: number,
  end: number,
): number | null {
  const size = end - first;
  let found: number | null = null;
  let best = -1;
  let tied = false;
  for (let offset = 0; offset + size <= live.childCount; offset += 1) {
    let matches = true;
    for (let index = 0; matches && index < size; index += 1)
      matches = live.child(offset + index).eq(before.child(first + index));
    if (!matches) continue;
    const leftMatches =
      first === 0
        ? offset === 0
        : offset > 0 && live.child(offset - 1).eq(before.child(first - 1));
    const rightMatches =
      end === before.childCount
        ? offset + size === live.childCount
        : offset + size < live.childCount &&
          live.child(offset + size).eq(before.child(end));
    const score = Number(leftMatches) + Number(rightMatches);
    // Added blocks have nothing of their own to find them by.
    if (size === 0 && score === 0) continue;
    if (score > best) {
      best = score;
      found = offset;
      tied = false;
    } else if (score === best) tied = true;
  }
  return tied ? null : found;
}

/**
 * Whether the stored blocks `first` to `end` can be only one place in the
 * stored Page. Once one of two repeated copies changes in the live copy, the
 * other is the only match left and would take the edit instead.
 */
function storedRunIsUnique(
  before: ProseMirrorNode,
  first: number,
  end: number,
): boolean {
  if (end === first) return liveBlockRun(before, before, first, end) === first;
  const size = end - first;
  for (let offset = 0; offset + size <= before.childCount; offset += 1) {
    if (offset === first) continue;
    let matches = true;
    for (let index = 0; matches && index < size; index += 1)
      matches = before.child(offset + index).eq(before.child(first + index));
    if (matches) return false;
  }
  return true;
}

/**
 * Without the reviewer's place, the change goes in only where the live copy
 * still holds the paragraph, or the blocks, exactly as stored.
 */
function writeWhereUnchanged(
  doc: Y.Doc,
  fragment: Y.XmlFragment,
  live: ProseMirrorNode,
  before: ProseMirrorNode,
  after: ProseMirrorNode,
  change: StoredChange,
): boolean {
  const unchanged = live.eq(before);
  const $start = before.resolve(change.start);
  const $end = before.resolve(change.endBefore);
  const $next = after.resolve(change.start);
  const $nextEnd = after.resolve(change.endAfter);
  if (
    $start.parent.isTextblock &&
    $start.sameParent($end) &&
    $next.parent.isTextblock &&
    $next.sameParent($nextEnd) &&
    $start.before() === $next.before()
  ) {
    const stored = $start.parent;
    const next = $next.parent;
    // A paragraph the stored Page repeats can't be told from its twin.
    const position = unchanged
      ? $start.before()
      : uniqueTextblock(before, stored) === null
        ? null
        : uniqueTextblock(live, stored);
    if (position === null) return false;
    const element = liveElementAt(fragment, live, position);
    if (!element) return false;
    const target = live.replace(
      position,
      position + stored.nodeSize,
      new Slice(Fragment.from(next), 0, 0),
    );
    doc.transact(() => {
      const [text] = element.toArray();
      if (
        element.length === 1 &&
        text instanceof Y.XmlText &&
        textOnly(stored.content) &&
        textOnly(next.content) &&
        plainText(text) === stored.textContent
      )
        spliceText(text, 0, stored.textContent, next.textContent);
      syncLiveCopy(doc, fragment, target);
    });
    return true;
  }
  // Otherwise whole blocks change: the ones the two Pages don't share.
  let first = 0;
  while (
    first < before.childCount &&
    first < after.childCount &&
    before.child(first).eq(after.child(first))
  )
    first += 1;
  let shared = 0;
  while (
    shared < before.childCount - first &&
    shared < after.childCount - first &&
    before
      .child(before.childCount - 1 - shared)
      .eq(after.child(after.childCount - 1 - shared))
  )
    shared += 1;
  const end = before.childCount - shared;
  const nextEnd = after.childCount - shared;
  const offset = unchanged
    ? first
    : storedRunIsUnique(before, first, end)
      ? liveBlockRun(live, before, first, end)
      : null;
  if (offset === null) return false;
  const blocks: ProseMirrorNode[] = [];
  for (let index = first; index < nextEnd; index += 1)
    blocks.push(after.child(index));
  let target: ProseMirrorNode;
  try {
    target = live.replace(
      childPosition(live, offset),
      childPosition(live, offset + end - first),
      new Slice(Fragment.fromArray(blocks), 0, 0),
    );
  } catch {
    // coercion-ok: blocks the live Page can't hold there are a conflict.
    return false;
  }
  doc.transact(() => syncLiveCopy(doc, fragment, target));
  return true;
}

/**
 * Writes an accepted suggestion into the live copy. Open editors send typing
 * there about half a second before it reaches the stored body, so the change
 * goes where the reviewer saw the words and leaves what was typed around
 * them in place. Returns false, writing nothing, when the live copy doesn't
 * show those words as the stored Page does: someone edited them, or the live
 * copy hasn't caught up with a save yet.
 */
export function writeAcceptedSuggestion(
  doc: Y.Doc,
  schema: Schema,
  input: {
    before: ProseMirrorNode;
    after: ProseMirrorNode;
    /** Where the reviewing editor showed the words, when it sent that. */
    placement?: unknown;
  },
): boolean {
  const fragment = doc.getXmlFragment("default");
  const live = fragment.length ? readLiveCopy(fragment, schema) : null;
  if (!live) {
    replaceLiveCopy(doc, schema, input.after);
    return true;
  }
  const change = storedChange(input.before, input.after);
  if (!change) return true;
  const placement = parseSuggestionPlacement(input.placement);
  return (
    (placement !== null &&
      writeAtPlacement(
        doc,
        fragment,
        live,
        input.before,
        input.after,
        change,
        placement,
      )) ||
    writeWhereUnchanged(doc, fragment, live, input.before, input.after, change)
  );
}

/** Makes the live copy read `page`, for a Page nobody has open. */
export function replaceLiveCopy(
  doc: Y.Doc,
  schema: Schema,
  page: ProseMirrorNode,
): void {
  prosemirrorJSONToYXmlFragment(
    schema,
    page.toJSON(),
    doc.getXmlFragment("default"),
  );
}

/** The Markdown the live copy holds, stored beside it as its text snapshot. */
export function liveCopyMarkdown(
  doc: Y.Doc,
  schema: Schema,
  stored: { content: string; document: ProseMirrorNode },
): string {
  const live = readLiveCopy(doc.getXmlFragment("default"), schema);
  return !live || live.eq(stored.document)
    ? stored.content
    : docToNfm(live.toJSON() as PMNode);
}
