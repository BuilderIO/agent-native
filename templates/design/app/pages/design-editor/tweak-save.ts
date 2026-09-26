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

type TweakSaveKeepaliveAttempt =
  | { accepted: true; completion: Promise<unknown> }
  | { accepted: false; completion: null };

export async function sendJournaledTweakSaveKeepalive(options: {
  journal: () => Promise<boolean>;
  send: () => TweakSaveKeepaliveAttempt;
  acknowledge: () => Promise<unknown>;
}): Promise<boolean> {
  if (!(await options.journal())) return false;
  const attempt = options.send();
  if (!attempt.accepted) return false;
  await attempt.completion;
  await options.acknowledge();
  return true;
}

export type TweakSaveFailureKind =
  | "conflict"
  | "durable-retry"
  | "tab-memory-only";

export function classifyTweakSaveFailure(
  error: unknown,
  journaled: boolean,
): TweakSaveFailureKind {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  if (status === 409) return "conflict";
  return journaled ? "durable-retry" : "tab-memory-only";
}
