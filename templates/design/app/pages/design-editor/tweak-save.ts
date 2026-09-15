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

type TweakSaveKeepaliveAttempt =
  | { accepted: true; completion: Promise<unknown> }
  | { accepted: false; completion: null };

export async function sendJournaledTweakSaveKeepalive(options: {
  journal: () => Promise<boolean>;
  send: () => TweakSaveKeepaliveAttempt;
  acknowledge: () => Promise<unknown>;
}): Promise<boolean> {
  // Pagehide may freeze the document at any await boundary. Establish the
  // durable retry entry first so either the keepalive finishes or a later
  // editor session can replay the exact same operation.
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
