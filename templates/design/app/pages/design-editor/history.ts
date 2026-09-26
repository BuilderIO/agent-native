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

export const YJS_UNDO_SELECTION_META_KEY = "design-editor-selection-before";

export interface YjsUndoSelectionSnapshot {
  selectedElement: ElementInfo | null;
  selectedLayerIds: string[];
  sourceContentByFileId?: Record<string, string>;
  sourceFileIdByFileId?: Record<string, string>;
}

export type YjsUndoStackTop = object | undefined;

export function captureYjsUndoStackTop(
  undoManager: Y.UndoManager | null | undefined,
): YjsUndoStackTop {
  const stack = undoManager?.undoStack;
  return stack?.[stack.length - 1];
}

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

export function readYjsUndoSelection(
  stackItem: { meta: Map<unknown, unknown> } | null | undefined,
): YjsUndoSelectionSnapshot | undefined {
  return stackItem?.meta.get(YJS_UNDO_SELECTION_META_KEY) as
    | YjsUndoSelectionSnapshot
    | undefined;
}

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

export function readYjsRedoSelection(
  stackItem: { meta: Map<unknown, unknown> } | null | undefined,
): YjsUndoSelectionSnapshot | undefined {
  return stackItem?.meta.get(YJS_REDO_SELECTION_META_KEY) as
    | YjsUndoSelectionSnapshot
    | undefined;
}

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
  recoveryFileId?: string | null;
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
  isCheckpoint?: boolean;
  selectionBefore?: YjsUndoSelectionSnapshot;
}

export interface ContentHistoryGroup {
  changes: ContentHistoryChange[];
  linkedComponent?: true;
}

export type ContentHistoryEntry = ContentHistoryChange | ContentHistoryGroup;

export type ContentHistorySelectionAfterMap = WeakMap<
  ContentHistoryEntry,
  GeometryHistorySelection
>;

export type ContentUndoStackTop = ContentHistoryEntry | undefined;

export function captureContentUndoStackTop(
  stack: readonly ContentHistoryEntry[],
): ContentUndoStackTop {
  return stack[stack.length - 1];
}

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

export interface PendingTextCreationFinalization {
  isCreationCommit: boolean;
  historyHandled: boolean;
  confirm: () => void;
}

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
