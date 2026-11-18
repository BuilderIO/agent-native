import {
  tweakSelectionsHash,
  type TweakSelections,
} from "@shared/resolve-tweaks";

import { classifyDesignSaveFailure } from "./save-failure";

export interface PendingTweakSave {
  selections: TweakSelections;
  revision: number;
  expectedSelectionsHash: string;
  /** Also-accepted base once this tab's own in-flight save lands. */
  inFlightSelectionsHash?: string;
}

export interface ConfirmedTweakSelections {
  selections: TweakSelections;
  hash: string;
  selectionsRevision: number;
  /** Revision of the save that produced this base; absent when seeded from the server. */
  revision?: number;
}

/** The one save this tab has on the wire, and the base it leaves if it lands. */
export interface InFlightTweakSave {
  revision: number;
  selectionsHashIfApplied: string;
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

/** The persisted map a save leaves behind: apply-tweaks merges over the base. */
export function selectionsHashIfApplied(
  confirmed: ConfirmedTweakSelections,
  selections: TweakSelections,
): string {
  return tweakSelectionsHash(
    { ...confirmed.selections, ...selections },
    confirmed.selectionsRevision + 1,
  );
}

export function clearCompletedTweakSave(
  queued: PendingTweakSave | null,
  completedRevision: number,
): PendingTweakSave | null {
  return queued && queued.revision <= completedRevision ? null : queued;
}

type TweakSaveKeepaliveAttempt =
  | { accepted: true; completion: Promise<unknown> }
  | { accepted: false; completion: null };

/**
 * Starts the request in the same task as the page-exit event: a closing page
 * gets no later turn, so waiting on IndexedDB first means nothing is sent.
 * Resolves true once the server took the save; the journaled copy is cleared
 * only after both it and the request finished.
 */
export async function sendJournaledTweakSaveKeepalive(options: {
  journal: () => Promise<boolean>;
  send: () => TweakSaveKeepaliveAttempt;
  acknowledge: () => Promise<unknown>;
}): Promise<boolean> {
  const attempt = options.send();
  const journaled = options.journal();
  if (!attempt.accepted) {
    await journaled;
    return false;
  }
  await attempt.completion;
  if (await journaled) await options.acknowledge();
  return true;
}

export type TweakSaveFailureKind = "conflict" | "durable-retry" | "not-saved";

export function classifyTweakSaveFailure(
  error: unknown,
  journaled: boolean,
  navigatorOnline: boolean,
): TweakSaveFailureKind {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  if (status === 409) return "conflict";
  return journaled &&
    classifyDesignSaveFailure(error, navigatorOnline) === "offline"
    ? "durable-retry"
    : "not-saved";
}
