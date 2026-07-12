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
/*                                                                            */
/* External/agent edits DO NOT wipe the stack. Blowing the whole history away  */
/* on every agent patch was hostile — one agent tweak stranded every unrelated */
/* user edit. Instead each entry stores the tree it was recorded against        */
/* (`fromBlocks`) and is validated at APPLY time:                               */
/*   1. Full match — the live tree still equals the baseline: restore the full  */
/*      snapshot (the pre-external-edit fast path).                             */
/*   2. Scoped match — for single-block `text` entries, an external/agent edit  */
/*      elsewhere must not strand the user's undo (Google-Docs behavior): as    */
/*      long as THAT block is unchanged since the entry was recorded, undo/redo */
/*      swaps just that block's state into the live tree, preserving everyone   */
/*      else's edits.                                                           */
/*   3. Otherwise the entry is dropped and the walk continues — a stale entry   */
/*      can't dead-end undo, and a full-tree restore can never clobber newer    */
/*      concurrent state. `reset()` is kept only for a real doc/plan switch.    */
/* -------------------------------------------------------------------------- */

/** Kind of change a commit represents — drives coalescing boundaries. */
type ChangeKind = "text" | "data" | "structural";

interface Snapshot {
  /** The blocks[] tree to restore when this entry is applied. */
  blocks: PlanBlock[];
  /**
   * The tree this entry expects to be applied AGAINST — the post-edit tree for a
   * past (undo) entry, or the pre-restore tree for a future (redo) entry. Apply
   * time compares the live tree to this: they match when no external/agent edit
   * has intervened, so restoring `blocks` is clean; a mismatch means an external
   * edit changed the baseline and applying the full snapshot would clobber it, so
   * the entry is skipped instead of the old blanket reset of the whole stack.
   */
  fromBlocks: PlanBlock[];
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

/** Find a leaf block by id anywhere in the tree (recursing into columns/tabs). */
function findLeafBlock(blocks: PlanBlock[], id: string): PlanBlock | null {
  for (const block of blocks) {
    if (block.type === "columns") {
      for (const column of block.data.columns) {
        const found = findLeafBlock(column.blocks, id);
        if (found) return found;
      }
    } else if (block.type === "tabs") {
      for (const tab of block.data.tabs) {
        const found = findLeafBlock(tab.blocks, id);
        if (found) return found;
      }
    } else if (block.id === id) {
      return block;
    }
  }
  return null;
}

/**
 * Replace a leaf block by id anywhere in the tree, in place. Returns whether
 * the block was found and replaced.
 */
function replaceLeafBlock(
  blocks: PlanBlock[],
  id: string,
  replacement: PlanBlock,
): boolean {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === "columns") {
      for (const column of block.data.columns) {
        if (replaceLeafBlock(column.blocks, id, replacement)) return true;
      }
    } else if (block.type === "tabs") {
      for (const tab of block.data.tabs) {
        if (replaceLeafBlock(tab.blocks, id, replacement)) return true;
      }
    } else if (block.id === id) {
      blocks[i] = replacement;
      return true;
    }
  }
  return false;
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
      // single undo reverts the whole burst; advance `fromBlocks` to the newest
      // post-edit tree so apply-time matching tracks the current baseline.
      top.fromBlocks = clone(next);
      top.t = ts;
    } else {
      past.push({
        blocks: clone(prev),
        fromBlocks: clone(next),
        kind,
        changedBlockId,
        t: ts,
      });
      if (past.length > limit) past.shift();
    }
    // Any new user edit invalidates the redo branch.
    future.length = 0;
  };

  /**
   * An entry applies cleanly only when the live tree still equals the tree it was
   * recorded against (`fromBlocks`). If they differ, an external/agent edit moved
   * the baseline and restoring the full snapshot would clobber that change — so
   * the entry falls through to the scoped path. Deep structural equality over the
   * normalized JSON.
   */
  const matchesBaseline = (entry: Snapshot, target: PlanBlock[]): boolean =>
    JSON.stringify(entry.fromBlocks) === JSON.stringify(target);

  /**
   * Scoped application for single-block `text` entries whose full-tree baseline
   * no longer matches (an external/agent edit landed elsewhere). If the entry's
   * target block is untouched since the entry was recorded — even if it moved
   * position — swap just that block's recorded state into the live tree. Returns
   * the new tree, or null when the block itself changed/vanished (entry must be
   * dropped).
   */
  const applyScopedText = (
    entry: Snapshot,
    current: PlanBlock[],
  ): PlanBlock[] | null => {
    if (entry.kind !== "text" || !entry.changedBlockId) return null;
    const id = entry.changedBlockId;
    const liveBlock = findLeafBlock(current, id);
    const baselineBlock = findLeafBlock(entry.fromBlocks, id);
    const restoredBlock = findLeafBlock(entry.blocks, id);
    if (!liveBlock || !baselineBlock || !restoredBlock) return null;
    // Someone else edited THIS block since the entry was recorded — applying
    // would clobber their change, so the entry is invalid.
    if (JSON.stringify(liveBlock) !== JSON.stringify(baselineBlock)) {
      return null;
    }
    const next = clone(current);
    return replaceLeafBlock(next, id, clone([restoredBlock])[0]) ? next : null;
  };

  const applyEntry = (
    entry: Snapshot,
    current: PlanBlock[],
  ): PlanBlock[] | null => {
    if (matchesBaseline(entry, current)) return entry.blocks;
    return applyScopedText(entry, current);
  };

  const undo = () => {
    // Walk from the top and apply the first entry that still applies — fully
    // when the baseline matches, scoped to its block for text entries when an
    // external/agent edit landed elsewhere. Entries invalidated entirely are
    // dropped as we pass them, so a stale entry can't dead-end undo — the next
    // still-valid user edit is undone instead. This replaces the old blanket
    // reset that wiped ALL history the moment any external edit landed.
    while (past.length > 0) {
      const entry = past.pop() as Snapshot;
      const current = getCurrentBlocks();
      const restored = applyEntry(entry, current);
      if (!restored) continue;
      future.push({
        blocks: clone(current),
        fromBlocks: clone(restored),
        kind: entry.kind,
        changedBlockId: entry.changedBlockId,
        t: now(),
      });
      restore(restored);
      return true;
    }
    return false;
  };

  const redo = () => {
    while (future.length > 0) {
      const entry = future.pop() as Snapshot;
      const current = getCurrentBlocks();
      const restored = applyEntry(entry, current);
      if (!restored) continue;
      past.push({
        blocks: clone(current),
        fromBlocks: clone(restored),
        kind: entry.kind,
        changedBlockId: entry.changedBlockId,
        t: now(),
      });
      restore(restored);
      return true;
    }
    return false;
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
