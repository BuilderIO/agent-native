import type { SourceEdit } from "./types";

export type CrossSlideEditEntry = {
  type: "edit";
  slideId: string;
  sourceRevision: number;
  sourceHash: string;
  edits: SourceEdit[];
  selection: { line: number; column: number } | null;
};

export type CrossSlideSourceCommitEntry = {
  type: "commit";
  slideId: string;
  beforeSourceTsx: string;
  beforeSourceHash: string;
  afterSourceTsx: string;
  afterSourceHash: string;
  selection: { line: number; column: number } | null;
};

export type CrossSlideHistoryEntry =
  | CrossSlideEditEntry
  | CrossSlideSourceCommitEntry;

export type CrossSlideEditHistory = {
  entries: CrossSlideHistoryEntry[];
  cursor: number;
};

export type CrossSlideSourceRestoreRequest = {
  requestId: string;
  deckId: string;
  direction: "undo" | "redo";
  slideId: string;
  sourceTsx: string;
  expectedSourceHash: string;
  selection: { line: number; column: number } | null;
};

export type CrossSlideHistorySelection = {
  requestId: string;
  slideId: string;
  sourceRevision: number;
  sourceHash: string;
  line: number;
  column: number;
};

export const CROSS_SLIDE_EDIT_HISTORY_LIMIT = 50;

export const EMPTY_CROSS_SLIDE_EDIT_HISTORY: CrossSlideEditHistory = {
  entries: [],
  cursor: 0,
};

export function appendCrossSlideEdit(
  history: CrossSlideEditHistory,
  entry: Omit<CrossSlideEditEntry, "type">,
): CrossSlideEditHistory {
  const entries = [
    ...history.entries.slice(0, history.cursor),
    { ...entry, type: "edit" as const, edits: [...entry.edits] },
  ];
  return boundCrossSlideHistory(entries, entries.length, entry.slideId);
}

export function appendCrossSlideSourceCommit(
  history: CrossSlideEditHistory,
  entry: Omit<CrossSlideSourceCommitEntry, "type">,
): CrossSlideEditHistory {
  const entries = history.entries
    .slice(0, history.cursor)
    .filter(
      (candidate) =>
        candidate.type !== "edit" || candidate.slideId !== entry.slideId,
    );
  const selection =
    [...history.entries.slice(0, history.cursor)]
      .reverse()
      .find(
        (candidate) =>
          candidate.type === "edit" && candidate.slideId === entry.slideId,
      )?.selection ?? entry.selection;
  entries.push({ ...entry, type: "commit", selection });
  return boundCrossSlideHistory(entries, entries.length, entry.slideId);
}

function boundCrossSlideHistory(
  entries: CrossSlideHistoryEntry[],
  initialCursor: number,
  slideId: string,
): CrossSlideEditHistory {
  let cursor = initialCursor;
  const overflow =
    entries.filter((candidate) => candidate.slideId === slideId).length -
    CROSS_SLIDE_EDIT_HISTORY_LIMIT;
  if (overflow <= 0) return { entries, cursor };

  let removed = 0;
  const boundedEntries = entries.filter((candidate, index) => {
    if (candidate.slideId !== slideId || removed >= overflow) return true;
    if (index < cursor) cursor -= 1;
    removed += 1;
    return false;
  });
  return { entries: boundedEntries, cursor };
}

export function moveCrossSlideEditHistory(
  history: CrossSlideEditHistory,
  direction: "undo" | "redo",
): { history: CrossSlideEditHistory; entry: CrossSlideHistoryEntry | null } {
  const entryIndex = direction === "undo" ? history.cursor - 1 : history.cursor;
  const entry = history.entries[entryIndex] ?? null;
  if (!entry) return { history, entry: null };
  return {
    history: {
      entries: history.entries,
      cursor: history.cursor + (direction === "undo" ? -1 : 1),
    },
    entry,
  };
}

export function clearSlideEditHistory(
  history: CrossSlideEditHistory,
  slideId: string,
): CrossSlideEditHistory {
  let cursor = 0;
  const entries = history.entries.filter((entry, index) => {
    const keep = entry.slideId !== slideId;
    if (keep && index < history.cursor) cursor += 1;
    return keep;
  });
  return { entries, cursor };
}

export function projectSlideEditHistory(
  history: CrossSlideEditHistory,
  slideId: string,
): { editBatches: SourceEdit[][]; historyIndex: number } {
  const editBatches: SourceEdit[][] = [];
  let historyIndex = 0;
  history.entries.forEach((entry, index) => {
    if (entry.type !== "edit" || entry.slideId !== slideId) return;
    editBatches.push(entry.edits);
    if (index < history.cursor) historyIndex += 1;
  });
  return { editBatches, historyIndex };
}
