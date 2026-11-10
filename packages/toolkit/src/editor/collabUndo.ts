import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import { AllSelection, NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Plugin, Selection, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  getRelativeSelection,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
  yUndoPluginKey,
} from "@tiptap/y-tiptap";
import * as Y from "yjs";

type StackItem = Y.UndoManager["undoStack"][number];

interface SyncBinding {
  doc: Y.Doc;
  type: Y.XmlFragment;
  mapping: Map<unknown, unknown>;
  beforeTransactionSelection: unknown;
  mux: (write: () => void) => void;
  _prosemirrorChanged: (doc: ProseMirrorNode) => void;
}

interface SavedSelection {
  type?: string;
  anchor: Y.RelativePosition | null;
  head: Y.RelativePosition | null;
}

const repairedManagers = new WeakSet<Y.UndoManager>();
const unwrittenFollowUps = new WeakSet<SyncBinding>();

function idKey(client: number, clock: number) {
  return `${client}:${clock}`;
}

function followRestoredCopy(store: Y.Doc["store"], id: Y.ID) {
  let next: Y.ID | null = id;
  let diff = 0;
  let struct: Y.Item | Y.AbstractStruct;
  do {
    if (diff > 0) next = Y.createID(next.client, next.clock + diff);
    struct = Y.getItem(store, next);
    diff = next.clock - struct.id.clock;
    next = struct instanceof Y.Item ? struct.redone : null;
  } while (next !== null);
  return { struct, diff };
}

/**
 * Where Yjs should stop deleting each restored copy of the insertions an undo
 * or redo reverts, keyed by the copy's first id.
 */
function restoredInsertionEnds(doc: Y.Doc, stackItem: StackItem) {
  const ends = new Map<string, number>();
  for (const [client, ranges] of stackItem.insertions.clients) {
    for (const { clock, len } of ranges) {
      let position = clock;
      while (position < clock + len) {
        const original = Y.getItem(doc.store, Y.createID(client, position));
        const end = Math.min(original.id.clock + original.length, clock + len);
        if (original instanceof Y.Item && original.redone !== null) {
          const { struct, diff } = followRestoredCopy(
            doc.store,
            Y.createID(client, position),
          );
          const start = struct.id.clock + diff;
          ends.set(idKey(struct.id.client, start), start + end - position);
        }
        position = end;
      }
    }
  }
  return ends;
}

function isInsideRemovedType(type: Y.AbstractType<unknown> | null) {
  let item = type?._item ?? null;
  while (item) {
    if (item.deleted) return true;
    item = (item.parent as Y.AbstractType<unknown> | null)?._item ?? null;
  }
  return false;
}

function relativePositionIsRemoved(
  doc: Y.Doc,
  position: Y.RelativePosition | null,
  followRestored: boolean,
) {
  if (!position) return true;
  const absolute = Y.createAbsolutePositionFromRelativePosition(
    position,
    doc,
    followRestored,
  );
  return !absolute || isInsideRemovedType(absolute.type);
}

function savedSelection(
  view: EditorView,
  binding: SyncBinding,
  saved: SavedSelection,
): Selection | null {
  if (!saved.anchor || !saved.head) return null;
  const resolve = (position: Y.RelativePosition) => {
    const absolute = Y.createAbsolutePositionFromRelativePosition(
      position,
      binding.doc,
    );
    if (!absolute) return null;
    // y-tiptap rejects a text position anchored to an item when it resolves
    // to the start of the document; anchored to its type, it's taken as is.
    return relativePositionToAbsolutePosition(
      binding.doc,
      binding.type,
      Y.createRelativePositionFromTypeIndex(absolute.type, absolute.index, -1),
      binding.mapping as never,
    );
  };
  const anchor = resolve(saved.anchor);
  const head = resolve(saved.head);
  const { doc } = view.state;
  if (
    anchor === null ||
    head === null ||
    anchor > doc.content.size ||
    head > doc.content.size
  ) {
    return null;
  }
  if (saved.type === "all") return new AllSelection(doc);
  if (saved.type === "node") {
    const $anchor = doc.resolve(anchor);
    return $anchor.nodeAfter
      ? NodeSelection.create(doc, anchor)
      : TextSelection.near($anchor);
  }
  if (saved.type !== "text") return null;
  return TextSelection.between(doc.resolve(anchor), doc.resolve(head));
}

interface TextPlace {
  path: number[];
  offset: number;
}

interface CaretPlace {
  selection: SavedSelection;
  anchor: TextPlace | null;
  head: TextPlace | null;
}

function textPlace($pos: ResolvedPos): TextPlace | null {
  if (!$pos.parent.isTextblock) return null;
  return {
    path: Array.from({ length: $pos.depth }, (_, depth) => $pos.index(depth)),
    offset: $pos.parentOffset,
  };
}

function caretPlace(view: EditorView, binding: SyncBinding): CaretPlace {
  const { $anchor, $head } = view.state.selection;
  return {
    selection: getRelativeSelection(binding as never, view.state),
    anchor: textPlace($anchor),
    head: textPlace($head),
  };
}

function positionAtSamePlace(doc: ProseMirrorNode, place: TextPlace) {
  let node = doc;
  let start = 0;
  for (const index of place.path) {
    if (index >= node.childCount) return null;
    for (let child = 0; child < index; child += 1) {
      start += node.child(child).nodeSize;
    }
    node = node.child(index);
    start += 1;
  }
  if (!node.isTextblock) return null;
  return start + Math.min(place.offset, node.content.size);
}

function caretAtSamePlace(doc: ProseMirrorNode, place: CaretPlace) {
  const head = place.head && positionAtSamePlace(doc, place.head);
  if (head === null) return null;
  const anchor = place.anchor && positionAtSamePlace(doc, place.anchor);
  return TextSelection.create(doc, anchor ?? head, head);
}

/**
 * y-sync and y-undo read every transaction as a change of its own. y-sync
 * takes whether a change enters undo history from the batch's last
 * transaction, but a transaction a plugin appends belongs to the change it
 * answers: the trailing paragraph added after an undo or a collaborator's edit
 * became an undoable edit, and undoing it brought it straight back as a new
 * edit, which cleared the redo stack. y-undo saves the selection from before
 * the latest transaction as the one an undo restores, so a plugin that
 * answered an undo or redo with a selection-only transaction saved the caret
 * y-tiptap had guessed after it instead.
 */
export function foldFollowUpTransactions(plugin: Plugin): void {
  const field = plugin.spec.state;
  const key = plugin.spec.key;
  if (!field || (key !== ySyncPluginKey && key !== yUndoPluginKey)) return;
  const apply = field.apply;
  plugin.spec.state = {
    ...field,
    apply(tr, value, oldState, newState) {
      const next = apply.call(this, tr, value, oldState, newState);
      if (key === yUndoPluginKey) {
        return tr.docChanged ? next : { ...next, prevSel: value.prevSel };
      }
      const change = tr.getMeta("appendedTransaction") as
        | Transaction
        | undefined;
      if (
        change?.getMeta("addToHistory") === false &&
        tr.getMeta("addToHistory") === undefined
      ) {
        next.addToHistory = false;
        if (tr.docChanged) unwrittenFollowUps.add(next.binding);
      }
      return next;
    },
  };
}

/**
 * Writes to Yjs, outside undo history, what plugins appended to a change that
 * came from Yjs, such as the first render or an undo. y-sync holds a lock
 * while it applies such a change, so it cannot write them then, and its next
 * update would write them as part of whatever transaction comes next, usually
 * the user's first click or edit.
 */
export function writeFollowUps(view: EditorView, later = false): void {
  const binding = ySyncPluginKey.getState(view.state)?.binding as
    | SyncBinding
    | undefined;
  if (!binding || !unwrittenFollowUps.has(binding)) return;
  const write = () => {
    if (!unwrittenFollowUps.delete(binding) || view.isDestroyed) return;
    binding.mux(() => {
      binding.doc.transact((transaction) => {
        transaction.meta.set("addToHistory", false);
        binding._prosemirrorChanged(view.state.doc);
      }, ySyncPluginKey);
    });
  };
  if (later) queueMicrotask(write);
  else write();
}

/**
 * Repairs collaborative undo and redo around a block whose type changes.
 * Yjs replaces the block's element, so undoing the change restores copies of
 * its text, and restored copies merge into one item. Undoing an older
 * insertion into that text then deletes the copy from the insertion's start
 * to the end of the merged item, taking the rest of the block with it; the
 * delete filter splits each copy at the insertion's end first.
 *
 * y-tiptap also second-guesses where the caret lands, matching blocks against
 * the document from before the undo, and moves it to another block when the
 * caret's block was replaced or the caret ends at the start of the document.
 * A Yjs relative position is exact while its block survives, so the caret
 * stays there; when its block was replaced, an undo puts it back where it was
 * before the undone change and a redo keeps the selection's offsets in the
 * new block.
 */
export function repairCollabUndo(view: EditorView): () => void {
  const undoManager = yUndoPluginKey.getState(view.state)?.undoManager as
    | Y.UndoManager
    | undefined;
  if (!undoManager) return () => {};
  const doc = undoManager.doc;

  if (!repairedManagers.has(undoManager)) {
    repairedManagers.add(undoManager);
    // Yjs passes over entries that change nothing, such as an edit to a
    // block a collaborator has since removed, so the entry being reverted is
    // the one just past the end of the stack as it now stands.
    let popping: { stack: StackItem[]; before: StackItem[] } | null = null;
    let reverting: { entry: StackItem; ends: Map<string, number> } | null =
      null;
    const deleteFilter = undoManager.deleteFilter;
    undoManager.deleteFilter = (item) => {
      const entry = popping?.before[popping.stack.length];
      if (entry && reverting?.entry !== entry) {
        reverting = { entry, ends: restoredInsertionEnds(doc, entry) };
      }
      const end = reverting?.ends.get(idKey(item.id.client, item.id.clock));
      if (end !== undefined && item.id.clock + item.length > end) {
        Y.transact(doc, (transaction) => {
          Y.getItemCleanEnd(
            transaction,
            doc.store,
            Y.createID(item.id.client, end - 1),
          );
        });
      }
      return deleteFilter(item);
    };
    const clamped =
      (stack: () => StackItem[], run: () => StackItem | null) => () => {
        popping = { stack: stack(), before: stack().slice() };
        try {
          return run();
        } finally {
          popping = null;
          reverting = null;
        }
      };
    const undo = undoManager.undo.bind(undoManager);
    const redo = undoManager.redo.bind(undoManager);
    undoManager.undo = clamped(() => undoManager.undoStack, undo);
    undoManager.redo = clamped(() => undoManager.redoStack, redo);
  }

  const currentBinding = () =>
    ySyncPluginKey.getState(view.state)?.binding as SyncBinding | undefined;
  let caretBefore: CaretPlace | null = null;
  const onBeforeTransaction = (transaction: Y.Transaction) => {
    if (transaction.origin !== undoManager || view.isDestroyed) return;
    const binding = currentBinding();
    caretBefore = binding ? caretPlace(view, binding) : null;
  };
  const onPopped = ({
    stackItem,
    type,
  }: {
    stackItem: StackItem;
    type: "undo" | "redo";
  }) => {
    const caret = caretBefore;
    caretBefore = null;
    if (view.isDestroyed || doc._transaction !== null) return;
    const binding = currentBinding();
    if (!binding) return;
    // y-tiptap stores this for the undo's own transaction, but Yjs announces
    // the pop after that transaction ends, so the selection would otherwise
    // apply to whatever transaction comes next, such as a collaborator's edit.
    binding.beforeTransactionSelection = null;
    if (!caret) return;
    let selection: Selection | null;
    if (!relativePositionIsRemoved(doc, caret.selection.head, false)) {
      selection = savedSelection(view, binding, caret.selection);
    } else {
      const saved =
        type === "undo"
          ? (stackItem.meta.get(binding) as SavedSelection | undefined)
          : undefined;
      selection =
        (saved && !relativePositionIsRemoved(doc, saved.head, true)
          ? savedSelection(view, binding, saved)
          : null) ?? caretAtSamePlace(view.state.doc, caret);
    }
    if (!selection || selection.eq(view.state.selection)) return;
    view.dispatch(
      view.state.tr
        .setSelection(selection)
        .setMeta("addToHistory", false)
        .scrollIntoView(),
    );
  };
  doc.on("beforeTransaction", onBeforeTransaction);
  undoManager.on("stack-item-popped", onPopped);
  return () => {
    doc.off("beforeTransaction", onBeforeTransaction);
    undoManager.off("stack-item-popped", onPopped);
  };
}
