import { trackEvent } from "@agent-native/core/client/analytics";

import type { LocalRecorderPlatform } from "./recording-backup";

export interface LocalRecordingSaved {
  recordingPlatform: LocalRecorderPlatform;
  captureType: "camera" | "tab" | "screen" | null;
  durationMs: number;
  stopOutcome: "stopped" | "stop_failed";
  /** False when the browser copy failed and only memory holds it: lost on reload. */
  hasStoredCopy: boolean;
}

/**
 * Report that a recording made without storage finished into its local copy.
 * `reported` holds the local ids already sent: the hand-off that calls this
 * can run again for the same copy (retry, the failed-stop path), and each
 * recording is one event.
 */
export function trackLocalRecordingSaved(
  reported: Set<string>,
  recordingId: string,
  saved: LocalRecordingSaved,
): void {
  if (reported.has(recordingId)) return;
  reported.add(recordingId);
  try {
    void trackEvent("clips_local_recording_saved", {
      app_name: "clips",
      template_name: "clips",
      recording_attempt_id: recordingId,
      recording_platform: saved.recordingPlatform,
      capture_type: saved.captureType ?? undefined,
      duration_s: Math.round(saved.durationMs / 1000),
      stop_outcome: saved.stopOutcome,
      has_stored_copy: saved.hasStoredCopy,
    });
  } catch (err) {
    // Never let analytics break saving the local copy.
    console.warn("[clips] clips_local_recording_saved track failed:", err);
  }
}
