import type { TweakSelections } from "@shared/resolve-tweaks";

export interface PendingTweakSave {
  selections: TweakSelections;
  revision: number;
  expectedSelectionsHash: string;
}

export function createQueuedTweakSave(
  selections: TweakSelections,
  revision: number,
  confirmedSelectionsHash: string,
  existingDebouncedSave: PendingTweakSave | null,
): PendingTweakSave {
  return {
    selections,
    revision,
    // Multiple knob ticks inside one debounce window are one full-snapshot
    // edit and must retain the base observed by the first tick.
    expectedSelectionsHash:
      existingDebouncedSave?.expectedSelectionsHash ?? confirmedSelectionsHash,
  };
}

export function rebaseTweakSaveForSend(
  pending: PendingTweakSave,
  confirmedSelectionsHash: string,
): PendingTweakSave {
  return {
    ...pending,
    // Saves are serialized. Resolve the base only when this request reaches
    // the front of the chain so it follows a verified predecessor success,
    // but not a predecessor that failed.
    expectedSelectionsHash: confirmedSelectionsHash,
  };
}

export function retainLatestFailedTweakSave(
  queued: PendingTweakSave | null,
  failed: PendingTweakSave,
): PendingTweakSave {
  return queued && queued.revision > failed.revision ? queued : failed;
}

export function clearCompletedTweakSave(
  queued: PendingTweakSave | null,
  completedRevision: number,
): PendingTweakSave | null {
  return queued?.revision === completedRevision ? null : queued;
}
