import type {
  CanvasFrameGeometry,
  CanvasFrameGeometryById,
} from "@shared/canvas-frames";

export const MAX_DESIGN_UNDO_STACK = 50;

export interface GeometryHistorySelection {
  overviewSelectedScreenIds: string[];
  selectedLayerIds: string[];
  activeFileId: string | null;
}

export interface GeometryHistoryEntry {
  before: CanvasFrameGeometryById;
  after: CanvasFrameGeometryById;
  selectionBefore?: GeometryHistorySelection;
  selectionAfter?: GeometryHistorySelection;
}

export interface FileCreationHistoryEntry {
  filename: string;
  content: string;
  fileType: string;
  geometry?: CanvasFrameGeometry;
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
): GeometryHistoryEntry | null {
  if (!geometryHistoryEntryTouchesFrameIds(entry, deletedFileIds)) {
    return entry;
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
  if (!hasRemainingChange) return null;
  return {
    before,
    after,
    ...(entry.selectionBefore
      ? { selectionBefore: entry.selectionBefore }
      : {}),
    ...(entry.selectionAfter ? { selectionAfter: entry.selectionAfter } : {}),
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
}

export interface ContentHistoryGroup {
  changes: ContentHistoryChange[];
}

export type ContentHistoryEntry = ContentHistoryChange | ContentHistoryGroup;

export function getContentHistoryChanges(
  entry: ContentHistoryEntry,
): ContentHistoryChange[] {
  return "changes" in entry ? entry.changes : [entry];
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

export function mergeLocalContentHistoryFallback(
  stack: ContentHistoryChange[],
  change: ContentHistoryChange,
): ContentHistoryChange[] {
  if (change.before === change.after) return stack;
  const last = stack[stack.length - 1];
  if (last && last.fileId === change.fileId && last.after === change.before) {
    return [...stack.slice(0, -1), { ...last, after: change.after }];
  }
  return [...stack.slice(-(MAX_DESIGN_UNDO_STACK - 1)), change];
}
