import { collabUpdateFits } from "@agent-native/core/client/collab";
import type { CommandProps } from "@tiptap/core";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  DocAttrStep,
  Mapping,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceStep,
  type Step,
} from "@tiptap/pm/transform";
import {
  redo,
  undo,
  updateYFragment,
  yUndoPluginKey,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import * as Y from "yjs";

// Below this many bytes a change cannot come near the update limit, so
// typing never pays for reading the doc's size.
const MEASURED_CHANGE_BYTES = 64 * 1024;

// The most Yjs writes around one struct's content: its info, two ids and the
// lengths of its strings.
const STRUCT_BYTES = 48;

// One deleted struct in an update's delete set.
const DELETED_STRUCT_BYTES = 32;

const encoder = new TextEncoder();

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

export interface ChangeSizeGuardOptions {
  doc: () => Y.Doc | null;
  refused: () => void;
}

interface Range {
  from: number;
  to: number;
}

// Text written in place of text within one textblock.
function replacesText(
  step: Step | undefined,
  before: ProseMirrorNode,
): step is ReplaceStep {
  if (!(step instanceof ReplaceStep)) return false;
  const { slice } = step;
  let onlyText = slice.openStart === 0 && slice.openEnd === 0;
  slice.content.forEach((node) => {
    onlyText &&= node.isText;
  });
  const $from = before.resolve(step.from);
  const $to = before.resolve(step.to);
  if (!onlyText || !$from.sameParent($to) || !$from.parent.isTextblock) {
    return false;
  }
  $from.parent.nodesBetween($from.parentOffset, $to.parentOffset, (node) => {
    onlyText &&= node.isText;
  });
  return onlyText;
}

// A mark as the binding writes it on one run of text: where the run starts
// and, for a mark the run replaces, where it ends. The binding keys a mark
// that can overlap itself by its name and a hash.
function markBytes(mark: Mark): number {
  const key =
    jsonBytes(mark.type.name) + (mark.type.excludes(mark.type) ? 0 : 10);
  return 2 * (STRUCT_BYTES + key) + jsonBytes(mark.attrs);
}

// What the binding can write formatting the text `written` covers in
// `after`, whose formatting before came from the text `replaced` covers in
// `before`. Yjs formats each run of text on its own: it writes the run's
// marks, and any mark the text had before to restore after the run, so a
// link over alternating italics writes its href once per run. It deletes the
// text and the marks it replaces.
function formattingBound(
  after: ProseMirrorNode,
  written: Range[],
  before: ProseMirrorNode,
  replaced: Range[],
): number {
  const previous: Mark[] = [];
  let bytes = 0;
  for (const { from, to } of replaced) {
    before.nodesBetween(from, to, (node) => {
      if (!node.isText) return;
      bytes += DELETED_STRUCT_BYTES * (1 + 2 * node.marks.length);
      for (const mark of node.marks) {
        if (!previous.some((seen) => seen.eq(mark))) previous.push(mark);
      }
    });
  }
  let previousBytes = 0;
  for (const mark of previous) previousBytes += markBytes(mark);
  let end = -1;
  for (const range of [...written].sort((a, b) => a.from - b.from)) {
    const from = Math.max(range.from, end);
    end = Math.max(end, range.to);
    if (from >= range.to) continue;
    after.nodesBetween(from, range.to, (node) => {
      if (!node.isText) return;
      bytes += previousBytes;
      for (const mark of node.marks) bytes += markBytes(mark);
    });
  }
  return bytes;
}

// How far from `from` the two docs' text reads the same, up to `to`.
function sharedTextLength(
  a: ProseMirrorNode,
  b: ProseMirrorNode,
  from: number,
  to: number,
): number {
  let shared = from;
  for (let size = 64; shared < to; size *= 2) {
    const end = Math.min(to, shared + size);
    const left = a.textBetween(shared, end, undefined, "\ufffc");
    const right = b.textBetween(shared, end, undefined, "\ufffc");
    // An inline node with content spans positions that read as no text.
    if (left.length !== end - shared || right.length !== end - shared) {
      return to - from;
    }
    let index = 0;
    while (index < left.length && left[index] === right[index]) index++;
    shared += index;
    if (index < left.length) break;
  }
  return shared - from;
}

// The binding diffs a textblock's text from both ends, so where the text
// after a change repeats it, Yjs keeps text from further along than the
// change and formats all of it again.
function textChangeBound(
  step: ReplaceStep,
  before: ProseMirrorNode,
  after: ProseMirrorNode,
): number {
  const $from = before.resolve(step.from);
  let marked = false;
  $from.parent.forEach((node) => {
    marked ||= node.marks.length > 0;
  });
  step.slice.content.forEach((node) => {
    marked ||= node.marks.length > 0;
  });
  if (!marked) return 0;
  const start = Math.max($from.start(), step.from - 1);
  const inserted = step.slice.size;
  const removed = step.to - step.from;
  const end = $from.end();
  const afterEnd = end + inserted - removed;
  const shift = sharedTextLength(
    before,
    after,
    step.from,
    Math.min(end, afterEnd),
  );
  const reach = (size: number, other: number) =>
    step.from + Math.max(size, shift + Math.max(0, size - other)) + 1;
  return formattingBound(
    after,
    [{ from: start, to: Math.min(afterEnd, reach(inserted, removed)) }],
    before,
    [{ from: start, to: Math.min(end, reach(removed, inserted)) }],
  );
}

// What a change can make the Yjs binding write, as JSON, which measures at
// or above the update: each step, the blocks around any step that changes
// structure, and the formatting of the text it touches. The binding writes
// those blocks again when it cannot match them, so wrapping a long selection
// costs the selection though its step names only the wrapper.
function changeBound(tr: Transaction): number {
  let bytes = 0;
  for (const step of tr.steps) bytes += jsonBytes(step.toJSON());
  const [only] = tr.steps;
  if (tr.steps.length === 1 && replacesText(only, tr.before)) {
    return bytes + textChangeBound(only, tr.before, tr.doc);
  }
  const written: Range[] = [];
  const replaced: Range[] = [];
  tr.steps.forEach((step, index) => {
    // The binding writes an attribute as the step does, and no node marks.
    if (
      step instanceof AttrStep ||
      step instanceof DocAttrStep ||
      step instanceof AddNodeMarkStep ||
      step instanceof RemoveNodeMarkStep
    ) {
      return;
    }
    const toDoc = tr.mapping.slice(index + 1);
    // Inverting a slice of a mapping inverts all of it.
    const toBefore = new Mapping(tr.mapping.maps.slice(0, index)).invert();
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      written.push({ from: toDoc.map(step.from, -1), to: toDoc.map(step.to) });
      replaced.push({
        from: toBefore.map(step.from, -1),
        to: toBefore.map(step.to),
      });
      return;
    }
    const after = tr.docs[index + 1] ?? tr.doc;
    let start = Infinity;
    let end = -Infinity;
    let oldStart = Infinity;
    let oldEnd = -Infinity;
    step.getMap().forEach((stepOldStart, stepOldEnd, newStart, newEnd) => {
      start = Math.min(start, newStart);
      end = Math.max(end, newEnd);
      oldStart = Math.min(oldStart, stepOldStart);
      oldEnd = Math.max(oldEnd, stepOldEnd);
    });
    if (start > end) {
      bytes = Infinity;
      return;
    }
    const $start = after.resolve(start);
    // Removing whole nodes leaves every node around them as it was.
    if (start === end && !$start.parent.inlineContent) return;
    const range = $start.blockRange(after.resolve(end));
    if (!range) return;
    for (let child = range.startIndex; child < range.endIndex; child++) {
      bytes += jsonBytes(range.parent.child(child).toJSON());
    }
    written.push({
      from: toDoc.map(range.start, -1),
      to: toDoc.map(range.end),
    });
    const $oldStart = tr.before.resolve(toBefore.map(oldStart, -1));
    const $oldEnd = tr.before.resolve(toBefore.map(oldEnd));
    const oldRange = $oldStart.blockRange($oldEnd);
    replaced.push(
      oldRange
        ? { from: oldRange.start, to: oldRange.end }
        : { from: $oldStart.pos, to: $oldEnd.pos },
    );
  });
  return bytes + formattingBound(tr.doc, written, tr.before, replaced);
}

function changeFits(
  doc: Y.Doc,
  bound: number,
  measure: () => { updateBytes: number; stateBytes: number },
): boolean {
  if (bound < MEASURED_CHANGE_BYTES) return true;
  // Twice the bound covers what it leaves out, such as deletions.
  const headroom = 2 * bound;
  if (
    collabUpdateFits(headroom, Y.encodeStateAsUpdate(doc).length + headroom)
  ) {
    return true;
  }
  const measured = measure();
  return collabUpdateFits(measured.updateBytes, measured.stateBytes);
}

/**
 * The Yjs update that writing `body` onto `doc` makes, and the size of the
 * document it leaves, measured on a copy.
 */
export function measureBodyUpdate(
  doc: Y.Doc,
  body: ProseMirrorNode,
): { updateBytes: number; stateBytes: number } {
  const copy = new Y.Doc();
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const vector = Y.encodeStateVector(copy);
    updateYFragment(copy, copy.getXmlFragment("default"), body, {
      mapping: new Map(),
      isOMark: new Map(),
    });
    return {
      updateBytes: Y.encodeStateAsUpdate(copy, vector).length,
      stateBytes: Y.encodeStateAsUpdate(copy).length,
    };
  } finally {
    copy.destroy();
  }
}

/**
 * Refuses a change the user makes that the collab server would refuse as
 * one update onto `doc()`, calling `refused()` instead of applying it. Once
 * the server refuses an update, every later one from the tab is refused too.
 * Collaborators' changes and the editor's own writes, which skip history,
 * always apply.
 */
export function createChangeSizeGuardPlugin(options: ChangeSizeGuardOptions) {
  return new Plugin({
    key: new PluginKey("contentChangeSizeGuard"),
    filterTransaction(tr) {
      if (
        !tr.docChanged ||
        tr.getMeta(ySyncPluginKey) ||
        tr.getMeta("addToHistory") === false
      ) {
        return true;
      }
      const doc = options.doc();
      if (
        !doc ||
        changeFits(doc, changeBound(tr), () => measureBodyUpdate(doc, tr.doc))
      ) {
        return true;
      }
      options.refused();
      return false;
    },
  });
}

type HistoryItem = Y.UndoManager["undoStack"][number];

// Visits each struct `ranges` covers, with the part it covers, splitting
// none.
function forEachStruct(
  store: Y.Doc["store"],
  ranges: HistoryItem["insertions"],
  visit: (struct: Y.Item, start: number, end: number) => void,
) {
  ranges.clients.forEach((deleted, client) => {
    const structs = store.clients.get(client);
    if (!structs) return;
    for (const { clock, len } of deleted) {
      if (len === 0) continue;
      const end = clock + len;
      for (
        let index = Y.findIndexSS(structs, clock);
        index < structs.length && structs[index]!.id.clock < end;
        index++
      ) {
        const struct = structs[index]!;
        if (struct instanceof Y.Item) {
          visit(
            struct,
            Math.max(clock, struct.id.clock),
            Math.min(end, struct.id.clock + struct.length),
          );
        }
      }
    }
  });
}

// Where Yjs's undo finds a struct it inserted, which redo may have replaced.
function followRedone(store: Y.Doc["store"], id: Y.ID): Y.Item | Y.GC {
  let struct: Y.Item | Y.GC = Y.getItem(store, id);
  let diff = id.clock - struct.id.clock;
  while (struct instanceof Y.Item && struct.redone !== null) {
    const next = Y.createID(struct.redone.client, struct.redone.clock + diff);
    struct = Y.getItem(store, next);
    diff = next.clock - struct.id.clock;
  }
  return struct;
}

function liveStructs(type: Y.AbstractType<unknown>): number {
  let count = 0;
  const visit = (item: Y.Item) => {
    if (item.deleted) return;
    count += 1;
    if (item.content instanceof Y.ContentType) {
      count += liveStructs(item.content.type);
    }
  };
  for (let item = type._start; item !== null; item = item.right) visit(item);
  type._map.forEach(visit);
  return count;
}

// What popping `item` can write, and whether it changes the doc for certain.
// Yjs deletes what the item inserted and copies each struct it deleted.
function historyItemBound(
  undoManager: Y.UndoManager,
  item: HistoryItem,
  contents: Y.UpdateEncoderV1,
): { bytes: number; certain: boolean } {
  const { doc, scope } = undoManager;
  const inScope = (struct: Y.Item) =>
    scope.some(
      (type) =>
        type === doc || Y.isParentOf(type as Y.AbstractType<unknown>, struct),
    );
  let bytes = 0;
  let certain = false;
  // Structs deleted one after another in a client's clock take one range.
  let deletedClient = -1;
  let deletedEnd = -1;
  forEachStruct(doc.store, item.insertions, (struct, start, end) => {
    const inserted =
      struct.redone === null
        ? struct
        : followRedone(doc.store, Y.createID(struct.id.client, start));
    if (inserted.deleted || !(inserted instanceof Y.Item)) return;
    if (!inScope(inserted)) return;
    if (
      inserted !== struct ||
      struct.id.client !== deletedClient ||
      start !== deletedEnd
    ) {
      bytes += DELETED_STRUCT_BYTES;
    }
    deletedClient = struct.id.client;
    deletedEnd = end;
    if (inserted.content instanceof Y.ContentType) {
      bytes += DELETED_STRUCT_BYTES * liveStructs(inserted.content.type);
    }
    certain ||= undoManager.deleteFilter(inserted);
  });
  forEachStruct(doc.store, item.deletions, (struct, start, end) => {
    if (
      !inScope(struct) ||
      Y.isDeleted(item.insertions, Y.createID(struct.id.client, start))
    ) {
      return;
    }
    if (struct.redone !== null) {
      certain = true;
      return;
    }
    const parent = (struct.parent as Y.AbstractType<unknown>)._item;
    certain ||=
      struct.parentSub === null &&
      (parent === null || !parent.deleted || parent.redone !== null);
    bytes += STRUCT_BYTES;
    if (struct.parentSub !== null) bytes += jsonBytes(struct.parentSub);
    if (struct.content instanceof Y.ContentString) {
      bytes += 3 * (end - start);
    } else {
      struct.content.write(contents, 0);
    }
  });
  return { bytes, certain };
}

// What one undo or redo can write. Yjs pops the next item in the same update
// when one changes nothing.
function historyBound(
  undoManager: Y.UndoManager,
  stack: HistoryItem[],
): number {
  const contents = new Y.UpdateEncoderV1();
  let bytes = 0;
  for (let index = stack.length - 1; index >= 0; index--) {
    const item = historyItemBound(undoManager, stack[index]!, contents);
    bytes += item.bytes;
    if (item.certain) break;
  }
  return bytes + contents.toUint8Array().length;
}

// The copy's struct that matches `struct`, split where the original is.
function matchStruct(
  transaction: Y.Transaction,
  copy: Y.Doc,
  struct: Y.Item,
): Y.Item {
  const twin = Y.getItemCleanStart(transaction, struct.id);
  if (twin.length > struct.length) {
    Y.getItemCleanEnd(transaction, copy.store, struct.lastId);
  }
  return twin;
}

/**
 * The Yjs update that `undoManager`'s next undo, or redo, makes, and the
 * size of the document it leaves, measured by replaying it on a copy.
 */
export function measureHistoryUpdate(
  undoManager: Y.UndoManager,
  redoing: boolean,
): { updateBytes: number; stateBytes: number } {
  const { doc } = undoManager;
  const copy = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    // Yjs gives a doc another id when an update brings structs under its id.
    copy.clientID = doc.clientID;
    const replay = new Y.UndoManager(
      undoManager.scope.map((type) => {
        if (type === doc) return copy;
        const { _item: item } = type as Y.AbstractType<unknown>;
        return item === null
          ? copy.get(
              Y.findRootTypeKey(type as Y.AbstractType<unknown>),
              type.constructor as typeof Y.AbstractType<unknown>,
            )
          : (Y.getItem(copy.store, item.id).content as Y.ContentType).type;
      }) as Y.AbstractType<unknown>[],
      {
        captureTransaction: () => false,
        deleteFilter: undoManager.deleteFilter,
        doc: copy,
        ignoreRemoteMapChanges: undoManager.ignoreRemoteMapChanges,
      },
    );
    const stack = redoing ? undoManager.redoStack : undoManager.undoStack;
    replay.undoStack = [...undoManager.undoStack];
    replay.redoStack = [...undoManager.redoStack];
    let updateBytes = 0;
    copy.on("update", (update: Uint8Array) => {
      updateBytes += update.length;
    });
    copy.transact((transaction) => {
      // Yjs copies each struct as it is split, and follows `redone` links,
      // which updates do not carry.
      for (const item of stack) {
        for (const ranges of [item.insertions, item.deletions]) {
          forEachStruct(doc.store, ranges, (struct) => {
            matchStruct(transaction, copy, struct);
          });
        }
      }
      doc.store.clients.forEach((structs) => {
        for (const struct of structs) {
          if (struct instanceof Y.Item && struct.redone !== null) {
            matchStruct(transaction, copy, struct).redone = struct.redone;
          }
        }
      });
      if (redoing) replay.redo();
      else replay.undo();
    });
    return { updateBytes, stateBytes: Y.encodeStateAsUpdate(copy).length };
  } finally {
    copy.destroy();
  }
}

function historyCommand(options: ChangeSizeGuardOptions, redoing: boolean) {
  return () =>
    ({ tr, state, dispatch }: CommandProps) => {
      tr.setMeta("preventDispatch", true);
      const undoManager: Y.UndoManager =
        yUndoPluginKey.getState(state).undoManager;
      const stack = redoing ? undoManager.redoStack : undoManager.undoStack;
      if (stack.length === 0) return false;
      if (!dispatch) return true;
      if (
        options.doc() &&
        !changeFits(undoManager.doc, historyBound(undoManager, stack), () =>
          measureHistoryUpdate(undoManager, redoing),
        )
      ) {
        options.refused();
        return false;
      }
      return redoing ? redo(state) : undo(state);
    };
}

/**
 * Collaboration's undo and redo, refusing what the plugin would. Yjs
 * applies them to the doc itself, so the plugin sees them only once they
 * have applied.
 */
export function createChangeSizeGuardHistoryCommands(
  options: ChangeSizeGuardOptions,
) {
  return {
    undo: historyCommand(options, false),
    redo: historyCommand(options, true),
  };
}
