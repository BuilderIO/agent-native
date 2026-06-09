import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import type { PlanBlock } from "@shared/plan-content";

/* -------------------------------------------------------------------------- */
/* Unified plan-editor undo/redo over the authoritative blocks[] tree.        */
/*                                                                            */
/* WHY this exists instead of leaning on ProseMirror's history: the plan      */
/* editor has TWO sources of truth — the ProseMirror doc (prose + block       */
/* references) and the `blocks[]` side-map (block DATA). PM history only sees  */
/* the doc, so:                                                               */
/*   • block OPTION/CONFIG edits flow `onBlockDataChange → commit → setBlocks` */
/*     with NO ProseMirror transaction, so PM history never records them;     */
/*   • cross-region/column drag moves are dispatched `addToHistory:false`;    */
/*   • and the autosave→reconcile full-doc `setContent` rebases earlier        */
/*     inline-text history steps into silent no-ops (verified headlessly).     */
/* So cmd+z appeared to "do nothing" for everything except a freshly-typed     */
/* run or an immediate slash-insert.                                          */
/*                                                                            */
/* The fix: `commit()` is the ONE choke point every user edit funnels through */
/* (text, slash-insert, delete, drag-reorder, cross-region move, AND block    */
/* options). Snapshot the authoritative blocks[] there, disable PM history in  */
/* the plan editor (so cmd+z has a single authority), and drive undo/redo from */
/* a capture-phase keydown listener on the editor wrapper. One stack covers    */
/* text, structure, and options identically — they are all just "blocks[] was */
/* X, now it's Y". External/agent updates enter via the content-prop effect    */
/* (setBlocks, NOT commit) so they never enter the user's stack.              */
/* -------------------------------------------------------------------------- */

/** Kind of change a commit represents — drives coalescing boundaries. */
type ChangeKind = "text" | "data" | "structural";

interface Snapshot {
  /** The blocks[] tree to restore when this entry is popped. */
  blocks: PlanBlock[];
  kind: ChangeKind;
  /** For `text` entries: the single rich-text block whose markdown changed. */
  changedBlockId: string | null;
  /** Wall-clock of the most recent edit folded into this entry. */
  t: number;
}

export interface PlanUndoStack {
  /**
   * Record a user edit at the commit choke point. `prev` is the pre-edit tree
   * (what undo restores), `next` the post-edit tree (used only to classify the
   * change). No-op when prev/next are deep-equal. Consecutive same-block text
   * edits within the coalesce window fold into one undo entry (Notion-style).
   */
  record: (prev: PlanBlock[], next: PlanBlock[]) => void;
  /** Restore the previous snapshot. Returns true when something was undone. */
  undo: () => boolean;
  /** Re-apply the next snapshot. Returns true when something was redone. */
  redo: () => boolean;
  /** Drop all history — a genuine external/agent edit changed the baseline. */
  reset: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

interface UsePlanUndoStackOptions {
  /**
   * Apply a prior blocks[] snapshot back into the editor + persist it, WITHOUT
   * re-recording it (the host guards its `commit` with an is-restoring ref).
   */
  restore: (blocks: PlanBlock[]) => void;
  /** Read the live authoritative blocks[] (the host's `blocksRef.current`). */
  getCurrentBlocks: () => PlanBlock[];
  /** Coalesce window for consecutive same-block text edits (ms). */
  coalesceMs?: number;
  /** Max retained undo entries (memory cap for very large plans). */
  limit?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

const DEFAULT_COALESCE_MS = 1000;
const DEFAULT_LIMIT = 200;

function clone(blocks: PlanBlock[]): PlanBlock[] {
  if (typeof structuredClone === "function") {
    return structuredClone(blocks);
  }
  return JSON.parse(JSON.stringify(blocks)) as PlanBlock[];
}

/**
 * Ordered `id:type` signature over the WHOLE tree (containers included). Any
 * add / remove / reorder / type-change / nesting-change makes the signature
 * differ → the edit is `structural` (always a fresh undo boundary).
 */
function structuralSignature(blocks: PlanBlock[]): string {
  const parts: string[] = [];
  const walk = (list: PlanBlock[], depth: number) => {
    for (const block of list) {
      parts.push(`${depth}:${block.id}:${block.type}`);
      if (block.type === "columns") {
        for (const column of block.data.columns) walk(column.blocks, depth + 1);
      } else if (block.type === "tabs") {
        for (const tab of block.data.tabs) walk(tab.blocks, depth + 1);
      }
    }
  };
  walk(blocks, 0);
  return parts.join("|");
}

/** Map every LEAF block (everything except the columns/tabs containers) → its serialized data. */
function leafDataById(blocks: PlanBlock[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (list: PlanBlock[]) => {
    for (const block of list) {
      if (block.type === "columns") {
        for (const column of block.data.columns) walk(column.blocks);
      } else if (block.type === "tabs") {
        for (const tab of block.data.tabs) walk(tab.blocks);
      } else {
        out.set(
          block.id,
          JSON.stringify((block as { data?: unknown }).data ?? null),
        );
      }
    }
  };
  walk(blocks);
  return out;
}

/**
 * Classify a prev→next edit. Same structure + exactly one changed rich-text
 * leaf → `text` (the only coalescing case). Same structure + any other data
 * delta → `data`. Different structure → `structural`.
 */
function classify(
  prev: PlanBlock[],
  next: PlanBlock[],
): { kind: ChangeKind; changedBlockId: string | null } {
  if (structuralSignature(prev) !== structuralSignature(next)) {
    return { kind: "structural", changedBlockId: null };
  }
  const prevLeaves = leafDataById(prev);
  const nextLeaves = leafDataById(next);
  const changed: string[] = [];
  for (const [id, data] of nextLeaves) {
    if (prevLeaves.get(id) !== data) changed.push(id);
  }
  if (changed.length === 1) {
    const id = changed[0];
    const isRichText = next.length
      ? findLeafType(next, id) === "rich-text"
      : false;
    if (isRichText) return { kind: "text", changedBlockId: id };
  }
  return { kind: "data", changedBlockId: null };
}

function findLeafType(blocks: PlanBlock[], id: string): string | null {
  let found: string | null = null;
  const walk = (list: PlanBlock[]) => {
    for (const block of list) {
      if (found) return;
      if (block.type === "columns") {
        for (const column of block.data.columns) walk(column.blocks);
      } else if (block.type === "tabs") {
        for (const tab of block.data.tabs) walk(tab.blocks);
      } else if (block.id === id) {
        found = block.type;
      }
    }
  };
  walk(blocks);
  return found;
}

export function usePlanUndoStack({
  restore,
  getCurrentBlocks,
  coalesceMs = DEFAULT_COALESCE_MS,
  limit = DEFAULT_LIMIT,
  now = Date.now,
}: UsePlanUndoStackOptions): PlanUndoStack {
  const pastRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);

  // Read host callbacks through refs so the stable undo/redo closures never go
  // stale even though the host re-creates `restore`/`getCurrentBlocks` each render.
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const getCurrentRef = useRef(getCurrentBlocks);
  getCurrentRef.current = getCurrentBlocks;
  const nowRef = useRef(now);
  nowRef.current = now;

  const record = useCallback(
    (prev: PlanBlock[], next: PlanBlock[]) => {
      // No-op edits (e.g. an idempotent reconcile that reached commit) never
      // create an undo entry.
      if (JSON.stringify(prev) === JSON.stringify(next)) return;

      const { kind, changedBlockId } = classify(prev, next);
      const ts = nowRef.current();
      const past = pastRef.current;
      const top = past[past.length - 1];

      const coalesce =
        kind === "text" &&
        !!top &&
        top.kind === "text" &&
        top.changedBlockId === changedBlockId &&
        ts - top.t < coalesceMs;

      if (coalesce && top) {
        // Keep `top.blocks` (the state from BEFORE the typing burst began) so a
        // single undo reverts the whole burst; just extend the window.
        top.t = ts;
      } else {
        past.push({ blocks: clone(prev), kind, changedBlockId, t: ts });
        if (past.length > limit) past.shift();
      }
      // Any new user edit invalidates the redo branch.
      futureRef.current.length = 0;
    },
    [coalesceMs, limit],
  );

  const undo = useCallback(() => {
    const past = pastRef.current;
    if (past.length === 0) return false;
    const entry = past.pop() as Snapshot;
    futureRef.current.push({
      blocks: clone(getCurrentRef.current()),
      kind: entry.kind,
      changedBlockId: entry.changedBlockId,
      t: nowRef.current(),
    });
    restoreRef.current(entry.blocks);
    return true;
  }, []);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (future.length === 0) return false;
    const entry = future.pop() as Snapshot;
    pastRef.current.push({
      blocks: clone(getCurrentRef.current()),
      kind: entry.kind,
      changedBlockId: entry.changedBlockId,
      t: nowRef.current(),
    });
    restoreRef.current(entry.blocks);
    return true;
  }, []);

  const reset = useCallback(() => {
    pastRef.current.length = 0;
    futureRef.current.length = 0;
  }, []);

  const canUndo = useCallback(() => pastRef.current.length > 0, []);
  const canRedo = useCallback(() => futureRef.current.length > 0, []);

  return useMemo(
    () => ({ record, undo, redo, reset, canUndo, canRedo }),
    [record, undo, redo, reset, canUndo, canRedo],
  );
}

/** Exposed for tests / host code that need a typed ref to the stack. */
export type PlanUndoStackRef = MutableRefObject<PlanUndoStack | null>;
