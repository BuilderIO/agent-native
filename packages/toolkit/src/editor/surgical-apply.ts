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

export type BaseAwareReconcileResult =
  | { status: "noop" }
  | { status: "applied"; mergedDoc: ProseMirrorNode }
  | { status: "conflict"; localDraft: ProseMirrorNode }
  | { status: "failed"; reason: "schema" | "ambiguous" | "transaction" };

export type BaseAwareReconcilePlan =
  | Exclude<BaseAwareReconcileResult, { status: "applied" }>
  | { status: "applied"; mergedDoc: ProseMirrorNode; steps: readonly Step[] };

export interface BaseAwareReconcileOptions {
  overlapPolicy?: "conflict" | "prefer-live";
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

function hunksOverlap(left: TopLevelHunk, right: TopLevelHunk): boolean {
  const leftInsert = left.baseFromIndex === left.baseToIndex;
  const rightInsert = right.baseFromIndex === right.baseToIndex;
  if (leftInsert && rightInsert) {
    return left.baseFromIndex === right.baseFromIndex;
  }
  if (leftInsert) {
    return (
      left.baseFromIndex >= right.baseFromIndex &&
      left.baseFromIndex <= right.baseToIndex
    );
  }
  if (rightInsert) {
    return (
      right.baseFromIndex >= left.baseFromIndex &&
      right.baseFromIndex <= left.baseToIndex
    );
  }
  return (
    left.baseFromIndex < right.baseToIndex &&
    right.baseFromIndex < left.baseToIndex
  );
}

function mappedLocalIndex(
  baseIndex: number,
  localHunks: readonly TopLevelHunk[],
): number {
  let mapped = baseIndex;
  for (const hunk of localHunks) {
    if (hunk.baseToIndex > baseIndex) break;
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
  const localDiff = diffTopLevelHunks(baseDoc, liveDoc);
  const serverDiff = diffTopLevelHunks(baseDoc, serverDoc);
  if (!localDiff || !serverDiff) {
    return { status: "failed", reason: "ambiguous" };
  }
  let localHunks = localDiff;
  let serverHunks = serverDiff;
  if (serverHunks.length === 0) return { status: "noop" };
  if (
    hasUnambiguousReplacementPositions(baseDoc, liveDoc) &&
    hasUnambiguousReplacementPositions(baseDoc, serverDoc)
  ) {
    localHunks = splitReplacementHunks(localHunks);
    serverHunks = splitReplacementHunks(serverHunks).filter(
      (server) =>
        !localHunks.some(
          (local) =>
            local.baseFromIndex === server.baseFromIndex &&
            local.baseToIndex === server.baseToIndex &&
            liveDoc.content
              .cut(
                positionOfChild(liveDoc, local.changedFromIndex),
                positionOfChild(liveDoc, local.changedToIndex),
              )
              .eq(
                serverDoc.content.cut(
                  positionOfChild(serverDoc, server.changedFromIndex),
                  positionOfChild(serverDoc, server.changedToIndex),
                ),
              ),
        ),
    );
  }
  if (serverHunks.length === 0) return { status: "noop" };
  const overlapsLocal = (server: TopLevelHunk) =>
    localHunks.some((local) => hunksOverlap(local, server));
  if (
    options.overlapPolicy !== "prefer-live" &&
    serverHunks.some(overlapsLocal)
  ) {
    return { status: "conflict", localDraft: liveDoc };
  }
  if (options.overlapPolicy === "prefer-live") {
    serverHunks = serverHunks.filter((server) => !overlapsLocal(server));
    if (serverHunks.length === 0) return { status: "noop" };
  }

  try {
    const tr = new Transform(liveDoc);
    for (const hunk of [...serverHunks].reverse()) {
      const fromIndex = mappedLocalIndex(hunk.baseFromIndex, localHunks);
      const toIndex = mappedLocalIndex(hunk.baseToIndex, localHunks);
      tr.replaceWith(
        positionOfChild(tr.doc, fromIndex),
        positionOfChild(tr.doc, toIndex),
        serverDoc.content.cut(
          positionOfChild(serverDoc, hunk.changedFromIndex),
          positionOfChild(serverDoc, hunk.changedToIndex),
        ),
      );
    }
    return { status: "applied", mergedDoc: tr.doc, steps: tr.steps };
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
  const plan = planDocReconcile(editor.state.doc, baseDoc, serverDoc, options);
  if (plan.status !== "applied") return plan;
  try {
    const tr = editor.state.tr;
    for (const step of plan.steps) tr.step(step);
    tr.setMeta("addToHistory", false);
    tr.setMeta(RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION, true);
    editor.view.dispatch(tr);
    return { status: "applied", mergedDoc: editor.state.doc };
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
