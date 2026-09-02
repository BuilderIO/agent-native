/**
 * Surgical reconcile — apply an authoritative external document into the live
 * editor by replacing only the changed top-level node run, instead of a
 * whole-document `setContent`.
 *
 * Why: under the Collaboration extension, `setContent` routes through
 * y-prosemirror and rewrites the ENTIRE `Y.XmlFragment`. Every block-level
 * NodeView is torn down and recreated (each `ReactRenderer` constructor calls
 * `flushSync`, firing inside a React lifecycle), remote carets jump, and the
 * CRDT sees a delete-all + insert-all instead of a small edit. Diffing the
 * top-level children and dispatching one `tr.replaceWith(from, to, changed)`
 * leaves unchanged NodeViews untouched and produces minimal Yjs ops.
 *
 * This is the core mechanism behind re-enabling single-doc collab in the plan
 * editor (see templates/plan/shared/plan-doc.collab-stability.spec.ts, "Option
 * B") and removing agent-edit NodeView churn in content.
 */

import { createNodeFromContent } from "@tiptap/core";
import type { Fragment, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

/**
 * Transaction meta marking programmatic (non-user) rich-markdown transactions.
 * Declared here (not in useCollabReconcile) so the module dependency stays
 * one-directional; useCollabReconcile re-exports it for consumers.
 */
export const RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION =
  "an-rich-md-programmatic-transaction";

export interface TopLevelDiff {
  /** Index of the first differing top-level child. */
  fromIndex: number;
  /** Exclusive end index of the differing run in the OLD doc. */
  oldToIndex: number;
  /** Exclusive end index of the differing run in the NEW doc. */
  newToIndex: number;
  /** Document position where the differing run starts. */
  fromPos: number;
  /** Document position where the differing run ends in the OLD doc. */
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

function nodesEqual(left: ProseMirrorNode, right: ProseMirrorNode): boolean {
  return left.eq(right);
}

/**
 * Return every changed top-level run in base coordinates. The bounded LCS is
 * intentionally conservative: large or duplicate-heavy ambiguous documents
 * fail closed instead of guessing which identical block an edit targeted.
 */
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
      // A plain substitution leaves the same suffix LCS after advancing both
      // sides. Treat that as one changed run; only competing cross-matches are
      // ambiguous enough to fail closed.
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

/** Apply authoritative server changes onto a locally edited document. */
export function reconcileDocAgainstBase(
  editor: Editor,
  baseDoc: ProseMirrorNode,
  serverDoc: ProseMirrorNode,
): BaseAwareReconcileResult {
  const liveDoc = editor.state.doc;
  if (
    baseDoc.type.schema !== editor.schema ||
    serverDoc.type.schema !== editor.schema ||
    baseDoc.type !== liveDoc.type ||
    serverDoc.type !== liveDoc.type
  ) {
    return { status: "failed", reason: "schema" };
  }
  const localHunks = diffTopLevelHunks(baseDoc, liveDoc);
  const serverHunks = diffTopLevelHunks(baseDoc, serverDoc);
  if (!localHunks || !serverHunks) {
    return { status: "failed", reason: "ambiguous" };
  }
  if (serverHunks.length === 0) return { status: "noop" };
  if (
    localHunks.some((local) =>
      serverHunks.some((server) => hunksOverlap(local, server)),
    )
  ) {
    return { status: "conflict", localDraft: liveDoc };
  }

  try {
    const tr = editor.state.tr;
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
    tr.setMeta("addToHistory", false);
    tr.setMeta(RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION, true);
    editor.view.dispatch(tr);
    return { status: "applied", mergedDoc: editor.state.doc };
  } catch {
    return { status: "failed", reason: "transaction" };
  }
}

/**
 * Diff two documents at top-level-node granularity: trim the common prefix and
 * suffix (node equality via ProseMirror's `Node.eq`, which is deep) and return
 * the remaining changed run. Returns null when the documents are equal.
 */
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

  if (prefix === oldCount && prefix === newCount) return null; // identical

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

  // Positions: sum nodeSize of the preserved prefix, then of the changed run.
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
 * Markdown can't represent a trailing empty paragraph (the cursor line users
 * keep below a list/code block), so a parsed authoritative value never has
 * one — but the live doc often does, and the legacy `setContent` path
 * preserves it. Without this, every surgical reconcile whose old doc ends
 * with an empty paragraph would DELETE the user's trailing cursor line.
 */
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

/**
 * Replace only the changed top-level run of the live document with the
 * corresponding run from `newDoc`, in one programmatic, history-free
 * transaction. Returns:
 *  - "applied"   — a targeted replacement was dispatched
 *  - "noop"      — the documents were already equal (nothing dispatched)
 *  - "failed"    — the diff/transaction could not be applied (schema mismatch,
 *                  invalid content, …); caller should fall back to setContent.
 */
export function applyDocSurgically(
  editor: Editor,
  newDoc: ProseMirrorNode,
): "applied" | "noop" | "failed" {
  try {
    const oldDoc = editor.state.doc;
    // The parsed doc MUST come from this editor's schema — NodeType identity
    // is per-Schema-instance, so a foreign-schema doc can never diff or apply.
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

/**
 * Best-effort default parser for the surgical path: use the tiptap-markdown
 * storage parser (present when the shared editor's `features.markdown` is on)
 * to turn the authoritative markdown into a ProseMirror document. Returns null
 * when unavailable or when parsing fails — the caller falls back to the full
 * `setContent` path.
 *
 * Apps with their own serializers (Content's NFM, Plan's blocks[] doc) should
 * pass an explicit `parseValue` producing the exact doc their `setContent`
 * would have written.
 */
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
    // createNodeFromContent with slice:false returns a Node (the doc).
    return (node as ProseMirrorNode) ?? null;
  } catch {
    return null;
  }
}
