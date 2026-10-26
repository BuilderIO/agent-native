import { createNodeFromContent } from "@tiptap/core";
import type { Fragment, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Transform, type Step } from "@tiptap/pm/transform";
import type { Editor } from "@tiptap/react";

export const RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION =
  "an-rich-md-programmatic-transaction";

export interface TopLevelDiff {
  fromIndex: number;
  oldToIndex: number;
  newToIndex: number;
  fromPos: number;
  toPos: number;
}

export interface TopLevelHunk {
  baseFromIndex: number;
  baseToIndex: number;
  changedFromIndex: number;
  changedToIndex: number;
}

/**
 * `setAside` counts the server's hunks left out because they overlapped a
 * local edit. A hunk is one run of adjacent top-level blocks the server
 * changed, except that a run replacing as many blocks as it removes is split
 * into one hunk per block when every block's position is unambiguous. Only
 * the `prefer-live` overlap policy sets hunks aside.
 */
export type BaseAwareReconcileResult =
  | { status: "noop"; setAside: number }
  | { status: "applied"; mergedDoc: ProseMirrorNode; setAside: number }
  | { status: "conflict"; localDraft: ProseMirrorNode }
  | { status: "failed"; reason: "schema" | "ambiguous" | "transaction" };

export type BaseAwareReconcilePlan =
  | Exclude<BaseAwareReconcileResult, { status: "applied" }>
  | {
      status: "applied";
      mergedDoc: ProseMirrorNode;
      steps: readonly Step[];
      setAside: number;
    };

export interface BaseAwareReconcileOptions {
  overlapPolicy?: "conflict" | "prefer-live";
  /**
   * The live editor's selection while it has focus. A filler line holding the
   * cursor, or the end of a selection, stays, so the next keystroke lands
   * where the cursor was.
   */
  liveSelection?: { from: number; to: number };
}

function nodesEqual(left: ProseMirrorNode, right: ProseMirrorNode): boolean {
  return left.eq(right);
}

export function diffTopLevelHunks(
  baseDoc: ProseMirrorNode,
  changedDoc: ProseMirrorNode,
): TopLevelHunk[] | null {
  const base = Array.from({ length: baseDoc.childCount }, (_, i) =>
    baseDoc.child(i),
  );
  const changed = Array.from({ length: changedDoc.childCount }, (_, i) =>
    changedDoc.child(i),
  );
  if (base.length * changed.length > 250_000) return null;

  const width = changed.length + 1;
  const lcs = new Uint32Array((base.length + 1) * width);
  for (let i = base.length - 1; i >= 0; i--) {
    for (let j = changed.length - 1; j >= 0; j--) {
      lcs[i * width + j] = nodesEqual(base[i], changed[j])
        ? 1 + lcs[(i + 1) * width + j + 1]
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const matches: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < base.length && j < changed.length) {
    if (nodesEqual(base[i], changed[j])) {
      matches.push([i++, j++]);
      continue;
    }
    const skipBase = lcs[(i + 1) * width + j];
    const skipChanged = lcs[i * width + j + 1];
    if (skipBase === skipChanged) {
      const insertion =
        j + 1 < changed.length && nodesEqual(base[i], changed[j + 1]);
      const deletion =
        i + 1 < base.length && nodesEqual(base[i + 1], changed[j]);
      if (insertion !== deletion) {
        if (insertion) j++;
        else i++;
        continue;
      }
      const skipBoth = lcs[(i + 1) * width + j + 1];
      if (skipBoth === skipBase) {
        i++;
        j++;
        continue;
      }
      return null;
    }
    if (skipBase > skipChanged) i++;
    else j++;
  }

  const hunks: TopLevelHunk[] = [];
  let baseCursor = 0;
  let changedCursor = 0;
  for (const [baseMatch, changedMatch] of [
    ...matches,
    [base.length, changed.length] as [number, number],
  ]) {
    if (baseCursor !== baseMatch || changedCursor !== changedMatch) {
      hunks.push({
        baseFromIndex: baseCursor,
        baseToIndex: baseMatch,
        changedFromIndex: changedCursor,
        changedToIndex: changedMatch,
      });
    }
    baseCursor = baseMatch + 1;
    changedCursor = changedMatch + 1;
  }
  return hunks;
}

// An insertion beside a replaced range, rather than inside it, has one place
// to go: next to the replacement, on the side it was inserted. Two insertions
// at the same index have no order, so they overlap.
function hunksOverlap(left: TopLevelHunk, right: TopLevelHunk): boolean {
  const leftInsert = left.baseFromIndex === left.baseToIndex;
  const rightInsert = right.baseFromIndex === right.baseToIndex;
  if (leftInsert && rightInsert) {
    return left.baseFromIndex === right.baseFromIndex;
  }
  if (leftInsert) {
    return (
      left.baseFromIndex > right.baseFromIndex &&
      left.baseFromIndex < right.baseToIndex
    );
  }
  if (rightInsert) {
    return (
      right.baseFromIndex > left.baseFromIndex &&
      right.baseFromIndex < left.baseToIndex
    );
  }
  return (
    left.baseFromIndex < right.baseToIndex &&
    right.baseFromIndex < left.baseToIndex
  );
}

/**
 * Where a base index falls in the live doc. A local insertion exactly at the
 * index stays before a `"start"` and after an `"end"`, so a server replacement
 * that starts or ends there doesn't take the inserted blocks with it.
 */
function mappedLocalIndex(
  baseIndex: number,
  localHunks: readonly TopLevelHunk[],
  side: "start" | "end" = "start",
): number {
  let mapped = baseIndex;
  for (const hunk of localHunks) {
    if (hunk.baseToIndex > baseIndex) break;
    if (side === "end" && hunk.baseFromIndex === baseIndex) break;
    mapped +=
      hunk.changedToIndex -
      hunk.changedFromIndex -
      (hunk.baseToIndex - hunk.baseFromIndex);
  }
  return mapped;
}

function hasUnambiguousReplacementPositions(
  baseDoc: ProseMirrorNode,
  changedDoc: ProseMirrorNode,
): boolean {
  if (baseDoc.childCount !== changedDoc.childCount) return false;
  for (let i = 0; i < baseDoc.childCount; i++) {
    for (let j = 0; j < baseDoc.childCount; j++) {
      if (i === j) continue;
      if (
        baseDoc.child(i).eq(baseDoc.child(j)) ||
        changedDoc.child(i).eq(changedDoc.child(j)) ||
        baseDoc.child(i).eq(changedDoc.child(j))
      ) {
        return false;
      }
    }
  }
  return true;
}

function splitReplacementHunks(hunks: TopLevelHunk[]): TopLevelHunk[] {
  return hunks.flatMap((hunk) => {
    const count = hunk.baseToIndex - hunk.baseFromIndex;
    if (count === 0 || count !== hunk.changedToIndex - hunk.changedFromIndex) {
      return [hunk];
    }
    return Array.from({ length: count }, (_, offset) => ({
      baseFromIndex: hunk.baseFromIndex + offset,
      baseToIndex: hunk.baseFromIndex + offset + 1,
      changedFromIndex: hunk.changedFromIndex + offset,
      changedToIndex: hunk.changedFromIndex + offset + 1,
    }));
  });
}

export function planDocReconcile(
  liveDoc: ProseMirrorNode,
  baseDoc: ProseMirrorNode,
  serverDoc: ProseMirrorNode,
  options: BaseAwareReconcileOptions = {},
): BaseAwareReconcilePlan {
  if (
    baseDoc.type.schema !== liveDoc.type.schema ||
    serverDoc.type.schema !== liveDoc.type.schema ||
    baseDoc.type !== liveDoc.type ||
    serverDoc.type !== liveDoc.type
  ) {
    return { status: "failed", reason: "schema" };
  }
  // An empty closing line holds nothing to protect: comparing it would make it
  // overlap every server change to the base's last block, or after it. That
  // covers the editor's filler, and a filler kept under the cursor that now
  // follows a paragraph.
  const liveHasBlankEnd =
    endsInBlankLine(liveDoc) && !isEmptyParagraph(baseDoc.lastChild);
  const liveHasFiller = liveHasBlankEnd && endsInEditorFiller(liveDoc);
  const comparedLive = liveHasBlankEnd ? withoutLastChild(liveDoc) : liveDoc;
  const localDiff = diffTopLevelHunks(baseDoc, comparedLive);
  const serverDiff = diffTopLevelHunks(baseDoc, serverDoc);
  if (!localDiff || !serverDiff) {
    return { status: "failed", reason: "ambiguous" };
  }
  let localHunks = localDiff;
  let serverHunks = serverDiff;
  if (serverHunks.length === 0) return { status: "noop", setAside: 0 };
  if (
    hasUnambiguousReplacementPositions(baseDoc, comparedLive) &&
    hasUnambiguousReplacementPositions(baseDoc, serverDoc)
  ) {
    localHunks = splitReplacementHunks(localHunks);
    serverHunks = splitReplacementHunks(serverHunks);
  }
  // A change both sides made is already in the tab. Repeated blocks only stop
  // the split above: the same base range given the same blocks is still the
  // same change.
  serverHunks = serverHunks.filter(
    (server) =>
      !localHunks.some(
        (local) =>
          local.baseFromIndex === server.baseFromIndex &&
          local.baseToIndex === server.baseToIndex &&
          comparedLive.content
            .cut(
              positionOfChild(comparedLive, local.changedFromIndex),
              positionOfChild(comparedLive, local.changedToIndex),
            )
            .eq(
              serverDoc.content.cut(
                positionOfChild(serverDoc, server.changedFromIndex),
                positionOfChild(serverDoc, server.changedToIndex),
              ),
            ),
      ),
  );
  if (serverHunks.length === 0) return { status: "noop", setAside: 0 };
  const overlapsLocal = (server: TopLevelHunk) =>
    localHunks.some((local) => hunksOverlap(local, server));
  if (
    options.overlapPolicy !== "prefer-live" &&
    serverHunks.some(overlapsLocal)
  ) {
    return { status: "conflict", localDraft: liveDoc };
  }
  let setAside = 0;
  if (options.overlapPolicy === "prefer-live") {
    const kept = serverHunks.filter((server) => !overlapsLocal(server));
    setAside = serverHunks.length - kept.length;
    serverHunks = kept;
    if (serverHunks.length === 0) return { status: "noop", setAside };
  }

  try {
    // Hunks index the compared doc, which matches the live doc up to the
    // filler, so a change at the base's end lands before the filler.
    const tr = new Transform(liveDoc);
    for (const hunk of [...serverHunks].reverse()) {
      const fromIndex = mappedLocalIndex(hunk.baseFromIndex, localHunks);
      const toIndex = mappedLocalIndex(hunk.baseToIndex, localHunks, "end");
      tr.replaceWith(
        positionOfChild(tr.doc, fromIndex),
        positionOfChild(tr.doc, toIndex),
        serverDoc.content.cut(
          positionOfChild(serverDoc, hunk.changedFromIndex),
          positionOfChild(serverDoc, hunk.changedToIndex),
        ),
      );
    }
    // Once a paragraph closes the page, the filler is a stray empty line the
    // next save would keep. The editor adds it back when it is needed again.
    // A selection's `to` is its later end, so a range reaching in counts too.
    const liveLast = liveDoc.lastChild;
    const selectionOnFiller =
      !!liveLast &&
      !!options.liveSelection &&
      options.liveSelection.to > liveDoc.content.size - liveLast.nodeSize;
    const mergedLast = tr.doc.lastChild;
    if (
      liveHasFiller &&
      !selectionOnFiller &&
      !endsInEditorFiller(tr.doc) &&
      isEditorFiller(mergedLast)
    ) {
      const end = tr.doc.content.size;
      tr.delete(end - mergedLast.nodeSize, end);
    }
    return { status: "applied", mergedDoc: tr.doc, steps: tr.steps, setAside };
  } catch {
    return { status: "failed", reason: "transaction" };
  }
}

export function reconcileDocAgainstBase(
  editor: Editor,
  baseDoc: ProseMirrorNode,
  serverDoc: ProseMirrorNode,
  options: BaseAwareReconcileOptions = {},
): BaseAwareReconcileResult {
  const plan = planDocReconcile(editor.state.doc, baseDoc, serverDoc, {
    ...options,
    ...(editor.isFocused ? { liveSelection: editor.state.selection } : {}),
  });
  if (plan.status !== "applied") return plan;
  try {
    const tr = editor.state.tr;
    for (const step of plan.steps) tr.step(step);
    tr.setMeta("addToHistory", false);
    tr.setMeta(RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION, true);
    editor.view.dispatch(tr);
    return {
      status: "applied",
      mergedDoc: editor.state.doc,
      setAside: plan.setAside,
    };
  } catch {
    return { status: "failed", reason: "transaction" };
  }
}

export function diffTopLevel(
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode,
): TopLevelDiff | null {
  const oldCount = oldDoc.childCount;
  const newCount = newDoc.childCount;

  let prefix = 0;
  const maxPrefix = Math.min(oldCount, newCount);
  while (prefix < maxPrefix && oldDoc.child(prefix).eq(newDoc.child(prefix))) {
    prefix++;
  }

  if (prefix === oldCount && prefix === newCount) return null;

  let suffix = 0;
  const maxSuffix = Math.min(oldCount, newCount) - prefix;
  while (
    suffix < maxSuffix &&
    oldDoc.child(oldCount - 1 - suffix).eq(newDoc.child(newCount - 1 - suffix))
  ) {
    suffix++;
  }

  const fromIndex = prefix;
  const oldToIndex = oldCount - suffix;
  const newToIndex = newCount - suffix;

  let fromPos = 0;
  for (let i = 0; i < fromIndex; i++) fromPos += oldDoc.child(i).nodeSize;
  let toPos = fromPos;
  for (let i = fromIndex; i < oldToIndex; i++) {
    toPos += oldDoc.child(i).nodeSize;
  }

  return { fromIndex, oldToIndex, newToIndex, fromPos, toPos };
}

function changedFragment(
  newDoc: ProseMirrorNode,
  diff: TopLevelDiff,
): Fragment {
  return newDoc.content.cut(
    positionOfChild(newDoc, diff.fromIndex),
    positionOfChild(newDoc, diff.newToIndex),
  );
}

function positionOfChild(doc: ProseMirrorNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

function isEmptyParagraph(node: ProseMirrorNode | null): boolean {
  return !!node && node.type.name === "paragraph" && node.content.size === 0;
}

/**
 * Tiptap's TrailingNode keeps an empty paragraph after a last block that is
 * not a paragraph, so there is a line to type on. Saved bodies leave it out.
 * An empty line someone styled, by indenting or coloring it, is content.
 */
function endsInEditorFiller(doc: ProseMirrorNode): boolean {
  return (
    endsInBlankLine(doc) &&
    doc.child(doc.childCount - 2).type.name !== "paragraph"
  );
}

/** An unstyled empty line after the page's last block, filler or typed. */
function endsInBlankLine(doc: ProseMirrorNode): boolean {
  return doc.childCount > 1 && isEditorFiller(doc.lastChild);
}

function isEditorFiller(node: ProseMirrorNode | null): node is ProseMirrorNode {
  return (
    node !== null &&
    isEmptyParagraph(node) &&
    node.sameMarkup(node.type.create())
  );
}

function withoutLastChild(doc: ProseMirrorNode): ProseMirrorNode {
  const last = doc.lastChild;
  if (!last) return doc;
  return doc.copy(doc.content.cut(0, doc.content.size - last.nodeSize));
}

function withPreservedTrailingParagraph(
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode,
): ProseMirrorNode {
  const oldLast =
    oldDoc.childCount > 0 ? oldDoc.child(oldDoc.childCount - 1) : null;
  if (!isEmptyParagraph(oldLast)) return newDoc;
  const newLast =
    newDoc.childCount > 0 ? newDoc.child(newDoc.childCount - 1) : null;
  if (isEmptyParagraph(newLast)) return newDoc;
  return newDoc.copy(newDoc.content.addToEnd(oldLast!.type.create()));
}

/** The doc `applyDocSurgically` would leave, or why it would not change one. */
export function surgicalApplyTarget(
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode,
): ProseMirrorNode | "noop" | "failed" {
  if (
    newDoc.type.schema !== oldDoc.type.schema ||
    newDoc.type !== oldDoc.type
  ) {
    return "failed";
  }
  const target = withPreservedTrailingParagraph(oldDoc, newDoc);
  return diffTopLevel(oldDoc, target) ? target : "noop";
}

export function applyDocSurgically(
  editor: Editor,
  newDoc: ProseMirrorNode,
): "applied" | "noop" | "failed" {
  try {
    const oldDoc = editor.state.doc;
    if (newDoc.type.schema !== editor.schema || newDoc.type !== oldDoc.type) {
      return "failed";
    }

    const target = withPreservedTrailingParagraph(oldDoc, newDoc);
    const diff = diffTopLevel(oldDoc, target);
    if (!diff) return "noop";

    const fragment = changedFragment(target, diff);
    const tr = editor.state.tr;
    tr.replaceWith(diff.fromPos, diff.toPos, fragment);
    tr.setMeta("addToHistory", false);
    tr.setMeta(RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION, true);
    editor.view.dispatch(tr);
    return "applied";
  } catch {
    return "failed";
  }
}

export function defaultParseValue(
  editor: Editor,
  value: string,
): ProseMirrorNode | null {
  try {
    const storage = (editor.storage as Record<string, any>).markdown;
    const parsed = storage?.parser?.parse?.(value, { inline: false });
    if (typeof parsed !== "string" || !parsed) return null;
    const node = createNodeFromContent(parsed, editor.schema, {
      slice: false,
    });
    return (node as ProseMirrorNode) ?? null;
  } catch {
    return null;
  }
}
