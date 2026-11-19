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
 * into one hunk per block when every block's position is unambiguous. When
 * both sides changed only the same block that holds blocks, such as a toggle,
 * its own blocks are compared the same way, so only the hunks inside it that
 * overlap count. Only the `prefer-live` overlap policy sets hunks aside.
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

// `local` is the live doc's change, `server` the snapshot's. An insertion
// beside the other side's change, rather than inside it, has one place to go:
// next to that change, on the side it was inserted. For a local insertion at
// a server replacement's edge, `mappedLocalIndex` keeps it out of the
// replaced range. Two insertions at the same index have no order, so they
// overlap.
function hunksOverlap(local: TopLevelHunk, server: TopLevelHunk): boolean {
  const localInsert = local.baseFromIndex === local.baseToIndex;
  const serverInsert = server.baseFromIndex === server.baseToIndex;
  if (localInsert && serverInsert) {
    return local.baseFromIndex === server.baseFromIndex;
  }
  if (localInsert) {
    return (
      local.baseFromIndex > server.baseFromIndex &&
      local.baseFromIndex < server.baseToIndex
    );
  }
  if (serverInsert) {
    return (
      server.baseFromIndex > local.baseFromIndex &&
      server.baseFromIndex < local.baseToIndex
    );
  }
  return (
    local.baseFromIndex < server.baseToIndex &&
    server.baseFromIndex < local.baseToIndex
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

interface PlannedReplacement {
  from: number;
  to: number;
  content: Fragment;
}

type ContainerPlan =
  | { status: "planned"; replacements: PlannedReplacement[]; setAside: number }
  | { status: "conflict" }
  | { status: "ambiguous" };

/**
 * The one block both sides changed, when each side replaced only that block
 * and kept its type and attributes, and it holds blocks of its own: a toggle,
 * a list or a quote. Changes to different blocks inside it don't overlap.
 */
function nestedChange(
  baseContainer: ProseMirrorNode,
  liveContainer: ProseMirrorNode,
  serverContainer: ProseMirrorNode,
  local: TopLevelHunk,
  server: TopLevelHunk,
): {
  base: ProseMirrorNode;
  live: ProseMirrorNode;
  server: ProseMirrorNode;
} | null {
  if (
    local.baseFromIndex !== server.baseFromIndex ||
    local.baseToIndex - local.baseFromIndex !== 1 ||
    server.baseToIndex - server.baseFromIndex !== 1 ||
    local.changedToIndex - local.changedFromIndex !== 1 ||
    server.changedToIndex - server.changedFromIndex !== 1
  ) {
    return null;
  }
  const base = baseContainer.child(server.baseFromIndex);
  const live = liveContainer.child(local.changedFromIndex);
  const changed = serverContainer.child(server.changedFromIndex);
  if (
    base.isLeaf ||
    base.inlineContent ||
    !base.sameMarkup(live) ||
    !base.sameMarkup(changed)
  ) {
    return null;
  }
  return { base, live, server: changed };
}

/**
 * Plans the server's changes to one container's blocks, the doc's or a
 * block's that holds blocks, as replacements in the live doc. `liveStart` is
 * where the live container's content starts.
 */
function planContainer(
  liveContainer: ProseMirrorNode,
  baseContainer: ProseMirrorNode,
  serverContainer: ProseMirrorNode,
  liveStart: number,
  overlapPolicy: BaseAwareReconcileOptions["overlapPolicy"],
): ContainerPlan {
  const localDiff = diffTopLevelHunks(baseContainer, liveContainer);
  const serverDiff = diffTopLevelHunks(baseContainer, serverContainer);
  if (!localDiff || !serverDiff) return { status: "ambiguous" };
  let localHunks = localDiff;
  let serverHunks = serverDiff;
  if (serverHunks.length === 0) {
    return { status: "planned", replacements: [], setAside: 0 };
  }
  if (
    hasUnambiguousReplacementPositions(baseContainer, liveContainer) &&
    hasUnambiguousReplacementPositions(baseContainer, serverContainer)
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
          liveContainer.content
            .cut(
              positionOfChild(liveContainer, local.changedFromIndex),
              positionOfChild(liveContainer, local.changedToIndex),
            )
            .eq(
              serverContainer.content.cut(
                positionOfChild(serverContainer, server.changedFromIndex),
                positionOfChild(serverContainer, server.changedToIndex),
              ),
            ),
      ),
  );
  const replacements: PlannedReplacement[] = [];
  let setAside = 0;
  for (const server of serverHunks) {
    const overlapping = localHunks.filter((local) =>
      hunksOverlap(local, server),
    );
    if (overlapping.length === 0) {
      replacements.push({
        from:
          liveStart +
          positionOfChild(
            liveContainer,
            mappedLocalIndex(server.baseFromIndex, localHunks),
          ),
        to:
          liveStart +
          positionOfChild(
            liveContainer,
            mappedLocalIndex(server.baseToIndex, localHunks, "end"),
          ),
        content: serverContainer.content.cut(
          positionOfChild(serverContainer, server.changedFromIndex),
          positionOfChild(serverContainer, server.changedToIndex),
        ),
      });
      continue;
    }
    // Typing in one paragraph of a toggle and another writer's edit to the
    // next paragraph both change the toggle; inside it they don't overlap.
    const local = overlapping.length === 1 ? overlapping[0] : undefined;
    const nested = local
      ? nestedChange(
          baseContainer,
          liveContainer,
          serverContainer,
          local,
          server,
        )
      : null;
    const nestedPlan =
      nested && local
        ? planContainer(
            nested.live,
            nested.base,
            nested.server,
            liveStart +
              positionOfChild(liveContainer, local.changedFromIndex) +
              1,
            overlapPolicy,
          )
        : null;
    if (nestedPlan?.status === "planned") {
      replacements.push(...nestedPlan.replacements);
      setAside += nestedPlan.setAside;
      continue;
    }
    if (overlapPolicy !== "prefer-live") return { status: "conflict" };
    setAside += 1;
  }
  return { status: "planned", replacements, setAside };
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
  const plan = planContainer(
    comparedLive,
    baseDoc,
    serverDoc,
    0,
    options.overlapPolicy,
  );
  if (plan.status === "ambiguous") {
    return { status: "failed", reason: "ambiguous" };
  }
  if (plan.status === "conflict") {
    return { status: "conflict", localDraft: liveDoc };
  }
  const { replacements, setAside } = plan;
  if (replacements.length === 0) return { status: "noop", setAside };

  try {
    // Replacements index the compared doc, which matches the live doc up to
    // the filler, so a change at the base's end lands before the filler. They
    // don't overlap, so applying the last first keeps the others' positions.
    const tr = new Transform(liveDoc);
    for (const replacement of [...replacements].sort(
      (left, right) => right.from - left.from || right.to - left.to,
    )) {
      tr.replaceWith(replacement.from, replacement.to, replacement.content);
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
