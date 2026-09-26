import { getRequestContext } from "@agent-native/core/server/request-context";
import { track } from "@agent-native/core/tracking";

export type RecordingFailureCode =
  | "storage_setup_required"
  | "recording_too_large"
  | "chunk_assembly_failed"
  | "media_verification_failed"
  | "finalize_failed"
  | "upload_failed"
  | "multipart_start_failed"
  | "chunk_html_error"
  | "upload_aborted"
  | "upload_interrupted"
  | "upload_timed_out"
  | "loom_import_failed"
  | "user_cancelled"
  | "unknown";

const recordingFailureCodes = new Set<RecordingFailureCode>([
  "storage_setup_required",
  "recording_too_large",
  "chunk_assembly_failed",
  "media_verification_failed",
  "finalize_failed",
  "upload_failed",
  "multipart_start_failed",
  "chunk_html_error",
  "upload_aborted",
  "upload_interrupted",
  "upload_timed_out",
  "loom_import_failed",
  "user_cancelled",
  "unknown",
]);

export function normalizeRecordingFailureCode(
  value: unknown,
): RecordingFailureCode {
  return typeof value === "string" &&
    recordingFailureCodes.has(value as RecordingFailureCode)
    ? (value as RecordingFailureCode)
    : "unknown";
}

export type RecordingPlatform =
  | "web"
  | "desktop"
  | "extension"
  | "mobile"
  | "import"
  | "unknown";

const recordingPlatforms = new Set<RecordingPlatform>([
  "web",
  "desktop",
  "extension",
  "mobile",
  "import",
  "unknown",
]);

export function normalizeRecordingPlatform(value: unknown): RecordingPlatform {
  return typeof value === "string" &&
    recordingPlatforms.has(value as RecordingPlatform)
    ? (value as RecordingPlatform)
    : "unknown";
}

// Background failures use the canonical ID persisted when the recording was created.
export function recordingTrackingSource(
  userId: string,
  storedAuthUserId?: string | null,
) {
  const authUserId = storedAuthUserId ?? getRequestContext()?.authUserId;
  return { userId, ...(authUserId ? { authUserId } : {}) };
}

export function trackRecordingFailure(params: {
  recordingId: string;
  userId: string;
  authUserId?: string | null;
  uploadAttemptId?: string | null;
  platform: unknown;
  failureCode: RecordingFailureCode;
  failureStage?:
    | "multipart_start"
    | "chunk_upload"
    | "reset_chunks"
    | "chunk_assembly"
    | "upload_interrupt"
    | "finalize"
    | "media_verification";
  httpStatus?: number;
}): void {
  try {
    track(
      params.failureCode === "user_cancelled"
        ? "recording_cancelled"
        : params.failureCode === "upload_interrupted"
          ? "recording_upload_interrupted"
          : "recording_failed",
      {
        app_name: "clips",
        template_name: "clips",
        output_id: params.recordingId,
        output_type: "clip",
        recording_attempt_id: params.recordingId,
        ...(params.uploadAttemptId
          ? { upload_attempt_id: params.uploadAttemptId }
          : {}),
        recording_platform: normalizeRecordingPlatform(params.platform),
        failure_code: params.failureCode,
        ...(params.failureStage ? { failure_stage: params.failureStage } : {}),
        ...(Number.isInteger(params.httpStatus)
          ? { http_status: params.httpStatus }
          : {}),
      },
      recordingTrackingSource(params.userId, params.authUserId),
    );
  } catch {
    // coercion-ok: analytics is best-effort and must not affect recording recovery.
  }
}
