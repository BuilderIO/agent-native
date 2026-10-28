import { callAction } from "@agent-native/core/client/hooks";
import {
  compareLiveBody,
  describeLiveBodyMismatch,
  materializeLiveBody,
  type LiveBodyMismatch,
  type LiveBodyParity,
} from "@shared/live-body";
import { applyUpdate, encodeStateAsUpdate, Doc as YDoc } from "yjs";

// Shadow mode only: the editor stops saving bodies once the server writes
// them from the live copy, and this goes with them.

// Building runs on the editor's main thread, so it waits for typing to pause,
// and larger live copies are counted without being built.
export const LIVE_BODY_PARITY_QUIET_MS = 2000;
const MAX_LIVE_COPY_BYTES = 256 * 1024;

export interface LiveBodyParityReport {
  outcome: LiveBodyParity;
  ms: number;
  bytes: number;
  mismatch?: LiveBodyMismatch;
}

/**
 * Compare `saved` with the body built from a copy of `ydoc` the way the
 * server will build it. `saved` must be what the editor serialized from
 * `ydoc` in this same tick; any later and the two can show different states.
 */
export function measureLiveBodyParity(
  ydoc: YDoc,
  saved: string,
): LiveBodyParityReport {
  const started = performance.now();
  const state = encodeStateAsUpdate(ydoc);
  const report = (outcome: LiveBodyParity, mismatch?: LiveBodyMismatch) => ({
    outcome,
    ms: performance.now() - started,
    bytes: state.length,
    ...(mismatch ? { mismatch } : {}),
  });
  if (state.length > MAX_LIVE_COPY_BYTES) return report("too-large");
  const copy = new YDoc();
  try {
    applyUpdate(copy, state);
    const live = materializeLiveBody(copy);
    const outcome = compareLiveBody(live, saved);
    if (outcome !== "mismatch" || live.kind !== "body") return report(outcome);
    try {
      return report(outcome, describeLiveBodyMismatch(live, saved));
    } catch (error) {
      console.warn("[content] could not locate a live body mismatch", error);
      return report(outcome);
    }
  } catch (error) {
    console.warn("[content] live body parity check failed", error);
    return report("error");
  } finally {
    copy.destroy();
  }
}

export function reportLiveBodyParity(
  documentId: string,
  report: LiveBodyParityReport,
): void {
  void callAction("record-live-body-parity", {
    id: documentId,
    ...report,
  }).catch((error) =>
    console.warn("[content] live body parity report failed", {
      documentId,
      error,
    }),
  );
}
