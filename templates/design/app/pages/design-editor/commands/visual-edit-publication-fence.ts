import type { RefObject } from "react";

export interface VisualEditClearFence {
  /** Resolves true when the clear discarded this tab's pending edits. */
  settled: Promise<boolean>;
}

export type VisualEditPublicationQueueRef = RefObject<Promise<void>>;
export type VisualEditClearFenceRef = RefObject<VisualEditClearFence | null>;

/**
 * Appends one handoff publication to this tab's serial queue. A publication
 * queued while a clear is running waits for it: a successful clear drops
 * publications that carry edits, because they were snapshotted before the
 * clear and would recreate the handoff it just discarded. Empty publications
 * still run so the local bridge and clear-request state settle.
 */
export function enqueueVisualEditPublication(args: {
  queueRef: VisualEditPublicationQueueRef;
  clearFenceRef: VisualEditClearFenceRef;
  carriesEdits: boolean;
  publish: () => Promise<void>;
  onError: (error: unknown) => void;
}): void {
  const fence = args.clearFenceRef.current;
  args.queueRef.current = args.queueRef.current
    .catch(args.onError)
    .then(async () => {
      if (fence && (await fence.settled) && args.carriesEdits) return;
      await args.publish();
    });
}

export type VisualEditClearFenceResult<T> =
  | { status: "busy" }
  | { status: "done"; value: T };

/**
 * Runs a clear so this tab's own publisher cannot advance the handoff
 * revision between the clear's pending read and its compare-and-set. Waits
 * only for publications queued before the fence; later ones wait on the fence
 * itself, so awaiting them here would deadlock.
 */
export async function runFencedVisualEditClear<T>(args: {
  queueRef: VisualEditPublicationQueueRef;
  clearFenceRef: VisualEditClearFenceRef;
  clear: (priorPublications: Promise<void>) => Promise<T>;
  discardedEdits: (value: T) => boolean;
}): Promise<VisualEditClearFenceResult<T>> {
  if (args.clearFenceRef.current) return { status: "busy" };
  let settle!: (discarded: boolean) => void;
  const fence: VisualEditClearFence = {
    settled: new Promise<boolean>((resolve) => {
      settle = resolve;
    }),
  };
  args.clearFenceRef.current = fence;
  const priorPublications = args.queueRef.current.catch(() => {});
  let discarded = false;
  try {
    const value = await args.clear(priorPublications);
    discarded = args.discardedEdits(value);
    return { status: "done", value };
  } finally {
    if (args.clearFenceRef.current === fence) {
      args.clearFenceRef.current = null;
    }
    settle(discarded);
  }
}

export function clearEditsDiscardedLocalEdits(result: {
  cleared: boolean;
  stale: boolean;
  resetTweakSelections: boolean;
  handoffCleared: boolean;
  handoffPending: boolean;
}): boolean {
  if (result.stale) return false;
  if (result.cleared) return true;
  // A local-preview clear leaves a collaborator's shared handoff in place.
  return (
    result.handoffPending &&
    !result.resetTweakSelections &&
    !result.handoffCleared
  );
}
