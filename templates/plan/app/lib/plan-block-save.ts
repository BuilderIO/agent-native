import { mergePlanBlocks } from "@shared/plan-blocks-merge";
import type { PlanBlock } from "@shared/plan-content";

/** The saved plan content at one revision. */
export type PlanBlocksRevision = {
  updatedAt: string;
  blocks: PlanBlock[];
};

/**
 * What a save needs from the open document: the blocks it holds now, and the
 * saved revision those edits were made on top of.
 */
export type PlanDocumentSnapshot = {
  blocks: PlanBlock[];
  base: PlanBlocksRevision | null;
};

// Each conflict means another writer saved while this one was merging, so a
// plan under heavy concurrent editing can need a few rounds. Past the cap the
// 409 reaches the caller instead of looping.
const MAX_CONFLICT_MERGES = 3;

/**
 * The pending edit and another writer's edit changed the same thing. Nothing
 * was saved; retrying on a timer would only overwrite their work, so this one
 * waits for the person to decide.
 */
export class PlanBlocksOverlapError extends Error {
  constructor(readonly conflict: unknown) {
    super("Another writer changed the same part of this plan.");
    this.name = "PlanBlocksOverlapError";
  }
}

export function isPlanRevisionConflict(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { errorCode?: unknown }).errorCode === "plan_revision_conflict"
  );
}

/**
 * Saves `blocks` against `base`. When another writer got there first, merges
 * the pending edit onto the content they saved and saves again, so a concurrent
 * edit is never overwritten and never dropped. Throws `PlanBlocksOverlapError`
 * when the edits overlap and rethrows the original conflict when the retry
 * budget runs out.
 */
export async function saveBlocksMergingConflicts({
  base,
  blocks,
  save,
  readLatest,
}: {
  base: PlanBlocksRevision | null;
  blocks: PlanBlock[];
  save: (
    blocks: PlanBlock[],
    expectedUpdatedAt: string,
  ) => Promise<PlanBlocksRevision>;
  readLatest: () => Promise<PlanBlocksRevision>;
}): Promise<PlanBlocksRevision> {
  if (!base) throw new Error("A plan revision is required to save blocks.");
  let attempt = { base, blocks };
  for (let merges = 0; ; merges += 1) {
    try {
      return await save(attempt.blocks, attempt.base.updatedAt);
    } catch (error) {
      if (!isPlanRevisionConflict(error) || merges >= MAX_CONFLICT_MERGES) {
        throw error;
      }
      const latest = await readLatest();
      const merged = mergePlanBlocks(
        attempt.base.blocks,
        attempt.blocks,
        latest.blocks,
      );
      if (!merged) throw new PlanBlocksOverlapError(error);
      attempt = { base: latest, blocks: merged };
    }
  }
}
