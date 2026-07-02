import type { PlanBlock } from "@shared/plan-content";
import { useRef, type MutableRefObject } from "react";

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

export interface CreatePlanUndoStackOptions {
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
 * Ordered `depth:id:type` signature over the WHOLE tree (containers included).
 * Any add / remove / reorder / type-change / nesting-change makes the signature
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

/** Map every LEAF block (everything except columns/tabs containers) → serialized data + type. */
function leafDataById(
  blocks: PlanBlock[],
): Map<string, { type: string; data: string }> {
  const out = new Map<string, { type: string; data: string }>();
  const walk = (list: PlanBlock[]) => {
    for (const block of list) {
      if (block.type === "columns") {
        for (const column of block.data.columns) walk(column.blocks);
      } else if (block.type === "tabs") {
        for (const tab of block.data.tabs) walk(tab.blocks);
      } else {
        out.set(block.id, {
          type: block.type,
          data: JSON.stringify((block as { data?: unknown }).data ?? null),
        });
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
  for (const [id, entry] of nextLeaves) {
    if (prevLeaves.get(id)?.data !== entry.data) changed.push(id);
  }
  if (changed.length === 1) {
    const id = changed[0];
    if (nextLeaves.get(id)?.type === "rich-text") {
      return { kind: "text", changedBlockId: id };
    }
  }
  return { kind: "data", changedBlockId: null };
}

/**
 * The pure undo/redo engine over blocks[] snapshots. Framework-free so it can be
 * unit-tested headlessly; {@link usePlanUndoStack} wraps it with refs for stable
 * React identity. `restore`/`getCurrentBlocks`/`now` are called live each op.
 */
export function createPlanUndoStack({
  restore,
  getCurrentBlocks,
  coalesceMs = DEFAULT_COALESCE_MS,
  limit = DEFAULT_LIMIT,
  now = Date.now,
}: CreatePlanUndoStackOptions): PlanUndoStack {
  const past: Snapshot[] = [];
  const future: Snapshot[] = [];

  const record = (prev: PlanBlock[], next: PlanBlock[]) => {
    // No-op edits (e.g. an idempotent reconcile that reached commit) never
    // create an undo entry.
    if (JSON.stringify(prev) === JSON.stringify(next)) return;

    const { kind, changedBlockId } = classify(prev, next);
    const ts = now();
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
    future.length = 0;
  };

  const undo = () => {
    if (past.length === 0) return false;
    const entry = past.pop() as Snapshot;
    future.push({
      blocks: clone(getCurrentBlocks()),
      kind: entry.kind,
      changedBlockId: entry.changedBlockId,
      t: now(),
    });
    restore(entry.blocks);
    return true;
  };

  const redo = () => {
    if (future.length === 0) return false;
    const entry = future.pop() as Snapshot;
    past.push({
      blocks: clone(getCurrentBlocks()),
      kind: entry.kind,
      changedBlockId: entry.changedBlockId,
      t: now(),
    });
    restore(entry.blocks);
    return true;
  };

  const reset = () => {
    past.length = 0;
    future.length = 0;
  };

  return {
    record,
    undo,
    redo,
    reset,
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}

/**
 * React binding for {@link createPlanUndoStack}. Creates the engine ONCE and
 * feeds it the latest `restore`/`getCurrentBlocks`/`now` through refs, so the
 * returned stack keeps a stable identity while never going stale even though
 * the host re-creates those callbacks on every render.
 */
export function usePlanUndoStack(
  options: CreatePlanUndoStackOptions,
): PlanUndoStack {
  const restoreRef = useRef(options.restore);
  restoreRef.current = options.restore;
  const getCurrentRef = useRef(options.getCurrentBlocks);
  getCurrentRef.current = options.getCurrentBlocks;
  const nowRef = useRef(options.now ?? Date.now);
  nowRef.current = options.now ?? Date.now;

  const stackRef = useRef<PlanUndoStack | null>(null);
  if (!stackRef.current) {
    stackRef.current = createPlanUndoStack({
      restore: (blocks) => restoreRef.current(blocks),
      getCurrentBlocks: () => getCurrentRef.current(),
      now: () => nowRef.current(),
      coalesceMs: options.coalesceMs,
      limit: options.limit,
    });
  }
  return stackRef.current;
}

/** Exposed for host code / tests that need a typed ref to the stack. */
export type PlanUndoStackRef = MutableRefObject<PlanUndoStack | null>;
