import { track } from "@agent-native/core/tracking";

import { recordingTrackingSource } from "./recording-failures.js";

export type RecordingSource =
  | "recorder"
  | "file_upload"
  | "local_copy_upload"
  | "meeting"
  | "import";

/**
 * `recording_created` for a newly inserted `recordings` row. Call it once,
 * right after the insert succeeds, from every action that inserts a new
 * recording row. Stitched clips and screenshots are deliberately left out:
 * they are derived outputs, not recordings.
 *
 * `recording_attempt_id` names the take: a local copy's upload retries each
 * get a fresh row id, and BI groups those rows back into one take by it.
 */
export function trackRecordingCreated(params: {
  recordingId: string;
  userId: string;
  platform: string | null | undefined;
  source: RecordingSource | undefined;
  attemptId?: string | null;
  hasAudio: boolean;
  hasCamera: boolean;
}): void {
  try {
    track(
      "recording_created",
      {
        app_name: "clips",
        template_name: "clips",
        output_id: params.recordingId,
        output_type: "clip",
        recording_attempt_id: params.attemptId || params.recordingId,
        recording_platform: params.platform ?? "unknown",
        recording_source: params.source ?? "unknown",
        has_audio: params.hasAudio,
        has_camera: params.hasCamera,
      },
      recordingTrackingSource(params.userId),
    );
  } catch (err) {
    console.warn("[clips] recording_created track failed:", err);
  }
}
