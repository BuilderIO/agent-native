import type { PlanBlock } from "@shared/plan-content";
import { useRef, type MutableRefObject } from "react";

import {
  hasPlanBlockStructureChange,
  visitPlanBlocks,
} from "../plan/plan-block-structure";

type ChangeKind = "text" | "data" | "structural";

interface Snapshot {
  blocks: PlanBlock[];
  fromBlocks: PlanBlock[];
  kind: ChangeKind;
  changedBlockId: string | null;
  t: number;
}

export interface PlanUndoStack {
  record: (prev: PlanBlock[], next: PlanBlock[]) => void;
  undo: () => boolean;
  redo: () => boolean;
  reset: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export interface CreatePlanUndoStackOptions {
  restore: (blocks: PlanBlock[]) => void;
  getCurrentBlocks: () => PlanBlock[];
  coalesceMs?: number;
  limit?: number;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isContainerBlock(block: PlanBlock): boolean {
  return block.type === "tabs" || block.type === "columns";
}

function findLeafBlock(blocks: PlanBlock[], id: string): PlanBlock | null {
  let found: PlanBlock | null = null;
  visitPlanBlocks(blocks, (block) => {
    if (found === null && block.id === id && !isContainerBlock(block)) {
      found = block;
    }
  });
  return found;
}

function replaceLeafBlock(
  blocks: PlanBlock[],
  id: string,
  replacement: PlanBlock,
): boolean {
  for (let i = 0; i < blocks.length; i++) {
    const value: unknown = blocks[i];
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.type !== "string"
    ) {
      continue;
    }

    const block = value as PlanBlock;
    if (block.type === "columns" || block.type === "tabs") {
      const data = isRecord(block.data) ? block.data : null;
      const key = block.type === "tabs" ? "tabs" : "columns";
      const regions = data?.[key];
      if (!Array.isArray(regions)) continue;
      for (const region of regions) {
        if (
          !isRecord(region) ||
          !Array.isArray(region.blocks) ||
          !replaceLeafBlock(region.blocks as PlanBlock[], id, replacement)
        ) {
          continue;
        }
        return true;
      }
    } else if (block.id === id) {
      blocks[i] = replacement;
      return true;
    }
  }
  return false;
}

function leafDataById(
  blocks: PlanBlock[],
): Map<string, { type: string; data: string }> {
  const out = new Map<string, { type: string; data: string }>();
  visitPlanBlocks(blocks, (block) => {
    if (isContainerBlock(block)) return;
    out.set(block.id, {
      type: block.type,
      data: JSON.stringify((block as { data?: unknown }).data ?? null),
    });
  });
  return out;
}

function classify(
  prev: PlanBlock[],
  next: PlanBlock[],
): { kind: ChangeKind; changedBlockId: string | null } {
  if (hasPlanBlockStructureChange(prev, next)) {
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
    future.length = 0;
  };

  const matchesBaseline = (entry: Snapshot, target: PlanBlock[]): boolean =>
    JSON.stringify(entry.fromBlocks) === JSON.stringify(target);

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

export type PlanUndoStackRef = MutableRefObject<PlanUndoStack | null>;
