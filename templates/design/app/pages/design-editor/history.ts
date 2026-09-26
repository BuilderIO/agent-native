import type {
  CanvasFrameGeometry,
  CanvasFrameGeometryById,
} from "@shared/canvas-frames";
import type { RefObject } from "react";
import type * as Y from "yjs";

import type { ElementInfo } from "@/components/design/types";

import type { DesignDataOperation } from "./data-operations";
import { captureHistorySelectionSources } from "./history-identity";
import { selectionHistorySnapshotsEqual } from "./selection-state";

export const MAX_DESIGN_UNDO_STACK = 50;

/**
 * Figma-parity undo selection restore for Yjs-tracked single-screen content
 * edits. The overview canvas's own undo stacks pair each entry with a
 * `GeometryHistorySelection` (`contentUndoSelectionStackRef`,
 * `GeometryHistoryEntry.selectionBefore`); single-screen content edits are
 * tracked by `Y.UndoManager` instead, which has no such parallel array — but
 * Yjs documents `StackItem.meta` for exactly this ("save and restore
 * metadata like selection range"). A discrete gesture stamps the selection it
 * started with onto the undo-stack item its own content edit just created;
 * undo reads it back off the popped `StackItem` instead of guessing from
 * whatever the gesture left selected (which, for a delete or an alt-drag
 * duplicate, is either null or the very node undo is about to remove).
 */
export const YJS_UNDO_SELECTION_META_KEY = "design-editor-selection-before";

export interface YjsUndoSelectionSnapshot {
  selectedElement: ElementInfo | null;
  selectedLayerIds: string[];
  sourceContentByFileId?: Record<string, string>;
  sourceFileIdByFileId?: Record<string, string>;
}

/** Opaque handle on "whichever stack item was on top before a gesture's
 * write" — capture with `captureYjsUndoStackTop` immediately before the
 * write, then pass the result to `stampYjsUndoSelection` after it. Yjs's own
 * `captureTimeout` coalescing (or a write that turned out to be a no-op) can
 * leave the SAME item on top rather than pushing a new one; identity here is
 * what tells the two apart. */
export type YjsUndoStackTop = object | undefined;

export function captureYjsUndoStackTop(
  undoManager: Y.UndoManager | null | undefined,
): YjsUndoStackTop {
  const stack = undoManager?.undoStack;
  return stack?.[stack.length - 1];
}

/** Call right after a gesture's own Yjs-tracked content write, passing the
 * `captureYjsUndoStackTop` result from immediately BEFORE that write. Stamps
 * only when the top item is a new object — a different reference from
 * `previousTop` — never touching an existing item's own stamp when the write
 * coalesced into it or created nothing. Also a no-op when Yjs isn't tracking
 * (overview mode, unsynced doc). */
export function stampYjsUndoSelection(
  undoManager: Y.UndoManager | null | undefined,
  previousTop: YjsUndoStackTop,
  snapshot: YjsUndoSelectionSnapshot,
): void {
  const stack = undoManager?.undoStack;
  const top = stack?.[stack.length - 1];
  if (!top || top === previousTop) return;
  top.meta.set(YJS_UNDO_SELECTION_META_KEY, snapshot);
}

/** Read back a snapshot stamped by `stampYjsUndoSelection`, from the
 * `StackItem` `Y.UndoManager#undo()`/`#redo()` returns (yjs's own
 * `StackItem` class isn't part of its public type exports, hence the
 * structural type here instead of naming it). `undefined` for a stack item
 * no gesture stamped (e.g. a style/text edit, or an edit predating this). */
export function readYjsUndoSelection(
  stackItem: { meta: Map<unknown, unknown> } | null | undefined,
): YjsUndoSelectionSnapshot | undefined {
  return stackItem?.meta.get(YJS_UNDO_SELECTION_META_KEY) as
    | YjsUndoSelectionSnapshot
    | undefined;
}

/**
 * Figma parity: redo must land on the RESULT of the original gesture (the
 * new group, the pasted copy, the duplicate), not the selection that gesture
 * started from — `stampYjsUndoSelection`'s "before" snapshot is for undo
 * only. Stamped on the exact same stack item as "before" (same
 * `previousTop` capture), under a separate meta key, so one item carries
 * both directions.
 */
export const YJS_REDO_SELECTION_META_KEY = "design-editor-selection-after";

export function stampYjsUndoSelectionAfter(
  undoManager: Y.UndoManager | null | undefined,
  previousTop: YjsUndoStackTop,
  snapshot: YjsUndoSelectionSnapshot,
): void {
  const stack = undoManager?.undoStack;
  const top = stack?.[stack.length - 1];
  if (!top || top === previousTop) return;
  top.meta.set(YJS_REDO_SELECTION_META_KEY, snapshot);
}

/** Read back a snapshot stamped by `stampYjsUndoSelectionAfter`. See
 * `readYjsUndoSelection`'s doc comment for the structural-type rationale. */
export function readYjsRedoSelection(
  stackItem: { meta: Map<unknown, unknown> } | null | undefined,
): YjsUndoSelectionSnapshot | undefined {
  return stackItem?.meta.get(YJS_REDO_SELECTION_META_KEY) as
    | YjsUndoSelectionSnapshot
    | undefined;
}

/**
 * Yjs's own undo/redo NEVER reuses a `StackItem` across a round trip: undoing
 * an item pops it off `undoStack` and (per `editor-chrome.bridge.ts`'s
 * upstream, `yjs`'s `UndoManager`) pushes a freshly-constructed item onto
 * `redoStack` for the transaction's inverse — the popped item's `meta` is
 * discarded, not carried over. Without forwarding it by hand here, a
 * selection stamped once would work for exactly one undo and vanish on the
 * matching redo (and on every undo/redo after that). Call this from a
 * `stack-item-popped` listener: `stackItem` is the item just popped,
 * `newTopItem` is the fresh item the same transaction just pushed onto the
 * OPPOSITE stack (`redoStack` when undoing, `undoStack` when redoing).
 */
export function forwardYjsUndoStackItemMeta(
  stackItem: { meta: Map<unknown, unknown> } | null | undefined,
  newTopItem: { meta: Map<unknown, unknown> } | null | undefined,
): void {
  if (!stackItem || !newTopItem || stackItem === newTopItem) return;
  for (const [key, value] of stackItem.meta) {
    newTopItem.meta.set(key, value);
  }
}

export interface GeometryHistorySelection {
  overviewSelectedScreenIds: string[];
  selectedLayerIds: string[];
  sourceContentByFileId?: Record<string, string>;
  sourceFileIdByFileId?: Record<string, string>;
  activeFileId: string | null;
}

export interface GeometryHistoryEntry {
  before: CanvasFrameGeometryById;
  after: CanvasFrameGeometryById;
  selectionBefore?: GeometryHistorySelection;
  selectionAfter?: GeometryHistorySelection;
  linkedContentChanges?: ContentHistoryChange[];
}

/**
 * Figma parity (figma-ground-truth.md Round 4): a plain selection change with
 * no document edit is its own undo-stack entry — click A, click B, click C,
 * then Cmd+Z re-selects B, Cmd+Z re-selects A. Recorded only at the five
 * pure-selection command entry points (layers-panel click, canvas click,
 * marquee, Escape-to-deselect, select-all) via `recordSelectionHistoryAroundChange`
 * in DesignEditor.tsx — an edit command's own post-write reselect (group,
 * duplicate, paste, delete) is never routed through those, so it stays
 * captured only by that edit's own `selectionBefore`/`selectionAfter`
 * instead of being double-recorded here.
 */
export interface SelectionHistoryEntry {
  before: GeometryHistorySelection;
  after: GeometryHistorySelection;
}

export interface FileCreationHistoryEntry {
  filename: string;
  content: string;
  fileType: string;
  geometry?: CanvasFrameGeometry;
  preserveCamera?: boolean;
  screenMetadata?: Record<string, unknown>;
  localhostScreen?: Record<string, unknown>;
  historyBatchId?: string;
  duplicateStack?: {
    before: Record<string, CanvasFrameGeometry | null>;
    after: CanvasFrameGeometryById;
  };
  /** Existing row to reuse when create-file succeeded but cleanup did not. */
  recoveryFileId?: string | null;
  /** IDs present before a create attempt that returned no id. */
  recoveryKnownFileIds?: string[];
}

export interface FileDeletionHistorySnapshot {
  id: string;
  filename: string;
  content: string;
  fileType: string;
  createdAt: string;
  updatedAt: string;
  geometry?: CanvasFrameGeometry;
  screenMetadata?: Record<string, unknown>;
  localhostScreen?: Record<string, unknown>;
  variantMemberships?: FileDeletionVariantMembershipSnapshot[];
}

export interface FileDeletionVariantMembershipSnapshot {
  setId: string;
  set: Record<string, unknown>;
  screen: unknown;
  index: number;
  originalScreenIds: string[];
}

export interface FileDeletionHistoryEntry {
  files: FileDeletionHistorySnapshot[];
  // Failed cleanup left these files alive. Retain their created bytes and metadata
  // until restoration completes, without creating them again.
  restoredFiles?: FileDeletionHistorySnapshot[];
}

export function filterFileDeletionHistoryEntry(
  entry: FileDeletionHistoryEntry,
  fileIds: ReadonlySet<string>,
): FileDeletionHistoryEntry {
  return {
    ...entry,
    files: entry.files.filter((file) => fileIds.has(file.id)),
  };
}

export function remapFileDeletionHistoryEntryIds(
  entry: FileDeletionHistoryEntry,
  fileIds: readonly string[],
  referencedFileIds: ReadonlyMap<string, string> = new Map(),
): FileDeletionHistoryEntry {
  const idByOldId = new Map([
    ...referencedFileIds,
    ...entry.files.flatMap((file, index) => {
      const id = fileIds[index];
      return id ? [[file.id, id] as const] : [];
    }),
  ]);
  const remapFile = (file: FileDeletionHistorySnapshot, id: string) => {
    const remapScreen = (screen: unknown) => {
      const oldId =
        typeof screen === "string"
          ? screen
          : screen && typeof screen === "object" && !Array.isArray(screen)
            ? (screen as Record<string, unknown>).id
            : undefined;
      const newId =
        typeof oldId === "string" ? idByOldId.get(oldId) : undefined;
      if (!newId) return screen;
      return typeof screen === "string"
        ? newId
        : { ...(screen as Record<string, unknown>), id: newId };
    };
    return {
      ...file,
      id,
      ...(file.variantMemberships
        ? {
            variantMemberships: file.variantMemberships.map((membership) => ({
              ...membership,
              set: {
                ...membership.set,
                ...(Array.isArray(membership.set.screens)
                  ? {
                      screens: membership.set.screens.map(remapScreen),
                    }
                  : {}),
              },
              originalScreenIds: membership.originalScreenIds.map(
                (screenId) => idByOldId.get(screenId) ?? screenId,
              ),
              screen: remapScreen(membership.screen),
            })),
          }
        : {}),
    };
  };
  return {
    files: entry.files.flatMap((file, index) => {
      const id = fileIds[index];
      return id ? [remapFile(file, id)] : [];
    }),
    ...(entry.restoredFiles
      ? {
          restoredFiles: entry.restoredFiles.map((file) =>
            remapFile(file, idByOldId.get(file.id) ?? file.id),
          ),
        }
      : {}),
  };
}

/** Undoing a file deletion recreates each screen under a brand-new database
 * id (see `remapFileDeletionHistoryEntryIds`) — apply the same old-id ->
 * new-id remap to every screen id a `SelectionHistoryEntry` snapshot carries,
 * so a stale pure-selection undo/redo entry restores the recreated screen
 * instead of one that no longer exists. `selectedLayerIds` is included
 * because the overview canvas's own multi-screen selection reuses it to
 * store screen ids too (see `undoFileDeletion`'s post-recreate selection). */
export function remapSelectionHistoryStackIds(
  stack: readonly SelectionHistoryEntry[],
  idMap: ReadonlyMap<string, string>,
): SelectionHistoryEntry[] {
  if (idMap.size === 0) return [...stack];
  const remapSelection = (
    selection: GeometryHistorySelection,
  ): GeometryHistorySelection => {
    const remapId = (fileId: string) => idMap.get(fileId) ?? fileId;
    return {
      overviewSelectedScreenIds:
        selection.overviewSelectedScreenIds.map(remapId),
      selectedLayerIds: selection.selectedLayerIds.map(remapId),
      activeFileId: selection.activeFileId
        ? remapId(selection.activeFileId)
        : selection.activeFileId,
    };
  };
  return stack.map((entry) => ({
    before: remapSelection(entry.before),
    after: remapSelection(entry.after),
  }));
}

/** Redoing a file deletion re-deletes the same screens under their ORIGINAL
 * ids (unlike undo, there is no new id to remap to — see
 * `remapSelectionHistoryStackIds`), so a stale pure-selection entry must drop
 * those ids instead. Mirrors `pruneGeometryHistoryEntryForDeletedFiles`'s own
 * selection pruning: layer ids are scoped to the active file, so once that
 * file is deleted the ids are meaningless and are cleared rather than
 * filtered individually. */
export function pruneSelectionHistoryStackIds(
  stack: readonly SelectionHistoryEntry[],
  deletedIds: ReadonlySet<string>,
): SelectionHistoryEntry[] {
  if (deletedIds.size === 0) return [...stack];
  const pruneSelection = (
    selection: GeometryHistorySelection,
  ): GeometryHistorySelection => {
    const activeFileDeleted =
      !!selection.activeFileId && deletedIds.has(selection.activeFileId);
    return {
      overviewSelectedScreenIds: selection.overviewSelectedScreenIds.filter(
        (fileId) => !deletedIds.has(fileId),
      ),
      selectedLayerIds: activeFileDeleted
        ? []
        : selection.selectedLayerIds.filter((id) => !deletedIds.has(id)),
      activeFileId: activeFileDeleted ? null : selection.activeFileId,
    };
  };
  return stack.flatMap((entry) => {
    const before = pruneSelection(entry.before);
    const after = pruneSelection(entry.after);
    // Mirrors pushSelectionHistoryEntry's own no-op skip: once deletion
    // prunes both sides down to the same selection, the entry no longer
    // records a change and would just be a silent no-op undo/redo step.
    return selectionHistorySnapshotsEqual(before, after)
      ? []
      : [{ before, after }];
  });
}

export function pruneFileCreationHistoryStack(
  stack: FileCreationHistoryEntry[],
  deletedFilenames: Set<string>,
  options?: { skip?: boolean },
): { stack: FileCreationHistoryEntry[]; removed: number } {
  if (options?.skip) return { stack, removed: 0 };
  const next = stack.filter((entry) => !deletedFilenames.has(entry.filename));
  return { stack: next, removed: stack.length - next.length };
}

export function geometryHistoryEntryTouchesFrameIds(
  entry: GeometryHistoryEntry,
  frameIds: Set<string>,
) {
  for (const frameId of frameIds) {
    if (entry.before[frameId] || entry.after[frameId]) return true;
  }
  return false;
}

export function pruneGeometryHistoryEntryForDeletedFiles(
  entry: GeometryHistoryEntry,
  deletedFileIds: Set<string>,
  deletedLayerIds: ReadonlySet<string> = new Set(),
): GeometryHistoryEntry | null {
  const linkedContentChanges = (entry.linkedContentChanges ?? []).filter(
    (change) => !deletedFileIds.has(change.fileId),
  );
  const touchesDeletedGeometry = geometryHistoryEntryTouchesFrameIds(
    entry,
    deletedFileIds,
  );
  const deletedSelectionIds = new Set([...deletedFileIds, ...deletedLayerIds]);
  const pruneSelection = (
    selection: GeometryHistorySelection | undefined,
  ): GeometryHistorySelection | undefined => {
    if (!selection) return undefined;
    const activeFileDeleted =
      !!selection.activeFileId && deletedFileIds.has(selection.activeFileId);
    const selectedLayerIds = activeFileDeleted
      ? []
      : selection.selectedLayerIds.filter((id) => !deletedSelectionIds.has(id));
    const overviewSelectedScreenIds =
      selection.overviewSelectedScreenIds.filter(
        (fileId) => !deletedFileIds.has(fileId),
      );
    const unchanged =
      selectedLayerIds.length === selection.selectedLayerIds.length &&
      overviewSelectedScreenIds.length ===
        selection.overviewSelectedScreenIds.length &&
      activeFileDeleted === false;
    if (unchanged) return selection;
    return {
      overviewSelectedScreenIds,
      selectedLayerIds,
      activeFileId: activeFileDeleted ? null : selection.activeFileId,
    };
  };

  const selectionBefore = pruneSelection(entry.selectionBefore);
  const selectionAfter = pruneSelection(entry.selectionAfter);
  if (
    !touchesDeletedGeometry &&
    linkedContentChanges.length === (entry.linkedContentChanges?.length ?? 0)
  ) {
    if (
      selectionBefore === entry.selectionBefore &&
      selectionAfter === entry.selectionAfter
    ) {
      return entry;
    }
    return {
      ...entry,
      ...(entry.selectionBefore ? { selectionBefore } : {}),
      ...(entry.selectionAfter ? { selectionAfter } : {}),
    };
  }

  const before = { ...entry.before };
  const after = { ...entry.after };
  for (const frameId of deletedFileIds) {
    delete before[frameId];
    delete after[frameId];
  }
  const remainingIds = new Set([...Object.keys(before), ...Object.keys(after)]);
  let hasRemainingChange = false;
  for (const frameId of remainingIds) {
    if (before[frameId] !== after[frameId]) {
      hasRemainingChange = true;
      break;
    }
  }
  if (!hasRemainingChange && linkedContentChanges.length === 0) return null;
  return {
    before,
    after,
    ...(entry.linkedContentChanges ? { linkedContentChanges } : {}),
    ...(entry.selectionBefore ? { selectionBefore } : {}),
    ...(entry.selectionAfter ? { selectionAfter } : {}),
  };
}

export function applyGeometryHistoryDiff(
  currentGeometry: CanvasFrameGeometryById,
  entry: GeometryHistoryEntry,
  direction: "undo" | "redo",
): CanvasFrameGeometryById {
  const from = direction === "undo" ? entry.after : entry.before;
  const to = direction === "undo" ? entry.before : entry.after;
  const touchedIds = new Set([...Object.keys(from), ...Object.keys(to)]);
  const next = { ...currentGeometry };
  for (const frameId of touchedIds) {
    const target = to[frameId];
    if (target) {
      next[frameId] = target;
    } else {
      delete next[frameId];
    }
  }
  return next;
}

export function removeRecentUndoRedoOrderKinds<T extends string>(
  order: T[],
  kind: T,
  count: number,
): T[] {
  if (count <= 0) return order;
  const next = [...order];
  let remaining = count;
  for (let index = next.length - 1; index >= 0 && remaining > 0; index -= 1) {
    if (next[index] !== kind) continue;
    next.splice(index, 1);
    remaining -= 1;
  }
  return next;
}

export interface ContentHistoryChange {
  fileId: string;
  before: string;
  after: string;
  designDataChange?: {
    undo: DesignDataOperation[];
    redo: DesignDataOperation[];
  };
  /** Agent-authored replacement checkpoint. Prevents the next user edit's
   * fallback mirror from coalescing backward through this entry, which would
   * collapse the agent state out of the undo stack and make a single Cmd+Z
   * jump past all AI-generated content to the pre-agent baseline. */
  isCheckpoint?: boolean;
  /** Figma-parity undo selection restore for this stack's non-Yjs fallback
   * path (see YjsUndoSelectionSnapshot's doc comment above — same need, same
   * shape, different stack: this one backs single-screen edits made before
   * the Yjs UndoManager for the file is ready, e.g. `!isSynced` yet). Carried
   * through `mergeLocalContentHistoryFallback` coalescing untouched (kept
   * from the earlier of the two merged changes), exactly like a Yjs
   * StackItem's meta survives a coalesced transaction. */
  selectionBefore?: YjsUndoSelectionSnapshot;
}

export interface ContentHistoryGroup {
  changes: ContentHistoryChange[];
  linkedComponent?: true;
}

export type ContentHistoryEntry = ContentHistoryChange | ContentHistoryGroup;

/** Figma-parity redo selection restore for the OVERVIEW content-history
 * stack (`contentUndoStackRef`/`contentUndoSelectionStackRef`) — the same
 * need `stampYjsUndoSelectionAfter` fills for the single-screen Yjs stack,
 * for a group/frame/duplicate/paste gesture that instead lands on this plain
 * array while `viewMode === "overview"`. `contentUndoSelectionStackRef` is
 * index-aligned with `contentUndoStackRef` and shared with file-deletion
 * pruning (`delete-files.ts`, outside this module's ownership boundary),
 * which rebuilds both by index and — for a multi-file GROUPED entry —
 * allocates a brand-new `{changes}` object even when nothing was actually
 * removed from it. A second index-aligned array here would silently drift
 * out of sync the first time that pruning runs after this stack has any
 * entries in it. Keying by the `ContentHistoryEntry` object itself in a
 * `WeakMap` sidesteps that entirely: pruning that keeps the exact same
 * object keeps its stamp, pruning that reallocates one loses it (falling
 * back to `before`, this feature's pre-existing behavior) instead of
 * silently attaching to the wrong entry, and a fully-removed entry is
 * reclaimed for free. */
export type ContentHistorySelectionAfterMap = WeakMap<
  ContentHistoryEntry,
  GeometryHistorySelection
>;

/** Snapshot of "whichever entry was on top of `contentUndoStackRef` before a
 * gesture's write" — capture immediately before the write, pass the result
 * to `stampContentHistorySelectionAfter` after it. Mirrors
 * `captureYjsUndoStackTop`'s identity-check idiom: coalescing or a no-op
 * write leaves the SAME entry on top rather than pushing a new one. */
export type ContentUndoStackTop = ContentHistoryEntry | undefined;

export function captureContentUndoStackTop(
  stack: readonly ContentHistoryEntry[],
): ContentUndoStackTop {
  return stack[stack.length - 1];
}

/** Call right after a gesture's own write through `applyLocalContentUpdate`/
 * `applyFileContentUpdate` while `viewMode === "overview"`, passing the
 * `captureContentUndoStackTop` result from immediately BEFORE that write.
 * Stamps only when a NEW entry was actually pushed (a different reference
 * from `previousTop`) — never touching an older entry's stamp when the
 * write coalesced or wrote nothing, and a no-op when nothing landed on this
 * stack (e.g. the write went to the Yjs stack instead). */
export function stampContentHistorySelectionAfter(
  stack: readonly ContentHistoryEntry[],
  afterMap: ContentHistorySelectionAfterMap,
  previousTop: ContentUndoStackTop,
  after: GeometryHistorySelection,
): void {
  const top = stack[stack.length - 1];
  if (!top || top === previousTop) return;
  afterMap.set(
    top,
    captureHistorySelectionSources(after, {
      ...after.sourceContentByFileId,
      ...Object.fromEntries(
        getContentHistoryChanges(top).map((change) => [
          change.fileId,
          change.after,
        ]),
      ),
    }),
  );
}

export interface PendingTextCreationHistory {
  fileId: string;
  nodeId: string;
  before: string;
  created: string;
}

/**
 * The two answers a text-creation commit needs, which are NOT the same answer.
 * `isCreationCommit` says this really is the creation's own first commit — the
 * one moment a text layer takes its Figma-style name from what was typed.
 * `historyHandled` says that creation's undo entry absorbed the commit; an
 * unrelated write landing in between (an abandoned sibling's cleanup) makes the
 * stack stale without making this any less the creation's first commit. Folding
 * them into one boolean left the layer named "Text" whenever that happened.
 */
export interface PendingTextCreationFinalization {
  isCreationCommit: boolean;
  historyHandled: boolean;
  /** Consumes the pending creation record and coalesces its undo entry. Run it
   *  only after the content actually published: a refused write that consumed
   *  the record left the typed text in no history and no source. */
  confirm: () => void;
}

/** Finalizes the newest text-creation entry as one atomic undo step. A typed
 * commit replaces the creation entry's `after`; abandoning an empty edit
 * removes the now-no-op entry. It refuses to cross any intervening history. */
export function finalizeTextCreationHistory(
  stack: readonly ContentHistoryEntry[],
  pending: PendingTextCreationHistory,
  finalContent: string,
): {
  stack: ContentHistoryEntry[];
  status: "coalesced" | "rolled-back" | "stale";
} {
  const latest = stack[stack.length - 1];
  if (
    !latest ||
    "changes" in latest ||
    latest.fileId !== pending.fileId ||
    latest.before !== pending.before ||
    latest.after !== pending.created
  ) {
    return { stack: [...stack], status: "stale" };
  }
  if (finalContent === pending.before) {
    return { stack: stack.slice(0, -1), status: "rolled-back" };
  }
  return {
    stack: [...stack.slice(0, -1), { ...latest, after: finalContent }],
    status: "coalesced",
  };
}

export function getContentHistoryChanges(
  entry: ContentHistoryEntry,
): ContentHistoryChange[] {
  return "changes" in entry ? entry.changes : [entry];
}

export function hasContentHistoryChange(change: ContentHistoryChange): boolean {
  return (
    change.before !== change.after ||
    Boolean(
      change.designDataChange?.undo.length ||
      change.designDataChange?.redo.length,
    )
  );
}

export function getAvailableContentHistoryChanges(
  entry: ContentHistoryEntry,
  availableFileIds: Iterable<string>,
  activeFileId?: string | null,
): ContentHistoryChange[] {
  const fileIds = new Set(availableFileIds);
  const activeFileIsAvailable = !!activeFileId && fileIds.has(activeFileId);
  return getContentHistoryChanges(entry).filter(
    (change) =>
      fileIds.has(change.fileId) ||
      (activeFileIsAvailable && change.fileId === activeFileId),
  );
}

export function contentHistoryEntryFromChanges(
  changes: ContentHistoryChange[],
  linkedComponent = false,
): ContentHistoryEntry | null {
  if (changes.length === 0) return null;
  if (linkedComponent) return { changes, linkedComponent: true };
  if (changes.length === 1) return changes[0]!;
  return { changes };
}

/** Split a grouped undo entry so missing screens stay on the stack instead of
 * being dropped when the available side applies. */
export function partitionContentHistoryEntry(
  entry: ContentHistoryEntry,
  availableFileIds: Iterable<string>,
  activeFileId?: string | null,
): {
  available: ContentHistoryChange[];
  remainder: ContentHistoryChange[];
} {
  const available = getAvailableContentHistoryChanges(
    entry,
    availableFileIds,
    activeFileId,
  );
  const availableIds = new Set(available.map((change) => change.fileId));
  const remainder = getContentHistoryChanges(entry).filter(
    (change) => !availableIds.has(change.fileId),
  );
  return { available, remainder };
}

/** Partitioning pops the order token before applying the available side.
 * Put `file-content` back so the remainder is still reachable on the next undo/redo. */
export function restoreFileContentHistoryOrderToken<T extends string>(
  order: T[],
  remainderExists: boolean,
): void {
  if (remainderExists) order.push("file-content" as T);
}

export function findLastContentHistoryChangeIndex(
  stack: ContentHistoryChange[],
  fileId?: string | null,
) {
  if (!fileId) return -1;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index]?.fileId === fileId) return index;
  }
  return -1;
}

export function contentHistoryScopeForViewMode(
  viewMode: "single" | "overview",
): "local" | "global" {
  return viewMode === "overview" ? "global" : "local";
}

export function mergeLocalContentHistoryFallback(
  stack: ContentHistoryChange[],
  change: ContentHistoryChange,
): ContentHistoryChange[] {
  if (change.before === change.after) return stack;
  const last = stack[stack.length - 1];
  if (
    last &&
    last.fileId === change.fileId &&
    last.after === change.before &&
    // An incoming checkpoint must stay its own undo boundary, or one Cmd+Z
    // reverts an agent edit together with the preceding user edit.
    !last.isCheckpoint &&
    !change.isCheckpoint
  ) {
    return [...stack.slice(0, -1), { ...last, after: change.after }];
  }
  return [...stack.slice(-(MAX_DESIGN_UNDO_STACK - 1)), change];
}

export interface ContentHistoryReservation {
  commit: (
    changes: ContentHistoryChange[],
    selectionAfter?: GeometryHistorySelection,
  ) => void;
  cancel: () => void;
}

/** Reserve the gesture's actual stack position before its source action awaits I/O. */
export function reserveLinkedComponentContentHistory<T extends string>(args: {
  stack: RefObject<ContentHistoryEntry[]>;
  selections: RefObject<(GeometryHistorySelection | undefined)[]>;
  order: RefObject<T[]>;
  selection: GeometryHistorySelection;
  after?: RefObject<ContentHistorySelectionAfterMap>;
  clearRedoStacks?: () => void;
}): ContentHistoryReservation {
  const entry: ContentHistoryGroup = { changes: [], linkedComponent: true };
  args.stack.current = [
    ...args.stack.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
    entry,
  ];
  args.selections.current = [
    ...args.selections.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
    args.selection,
  ];
  args.order.current = [
    ...args.order.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
    "file-content" as T,
  ];
  const cancel = () => {
    const index = args.stack.current.indexOf(entry);
    if (index < 0) return;
    // Order tokens are kinds, so locate the entry's token from the aligned content stack.
    let remaining = args.stack.current.length - index;
    for (
      let position = args.order.current.length - 1;
      position >= 0;
      position--
    ) {
      if (
        args.order.current[position] === "file-content" &&
        --remaining === 0
      ) {
        args.order.current.splice(position, 1);
        break;
      }
    }
    args.stack.current.splice(index, 1);
    args.selections.current.splice(index, 1);
  };
  return {
    cancel,
    commit: (changes, selectionAfter) => {
      const persistedChanges = changes.filter(hasContentHistoryChange);
      if (persistedChanges.length === 0) {
        cancel();
        return;
      }
      args.clearRedoStacks?.();
      const index = args.stack.current.indexOf(entry);
      if (index < 0) return;
      entry.changes = persistedChanges;
      args.selections.current[index] = captureHistorySelectionSources(
        args.selection,
        {
          ...args.selection.sourceContentByFileId,
          ...Object.fromEntries(
            changes.map(({ fileId, before }) => [fileId, before]),
          ),
        },
      );
      args.after?.current.set(
        entry,
        captureHistorySelectionSources(selectionAfter ?? args.selection, {
          ...(selectionAfter ?? args.selection).sourceContentByFileId,
          ...Object.fromEntries(
            changes.map(({ fileId, after }) => [fileId, after]),
          ),
        }),
      );
    },
  };
}
