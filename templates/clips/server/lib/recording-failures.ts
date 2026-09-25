import { track } from "@agent-native/core/tracking";

export type RecordingFailureCode =
  | "storage_setup_required"
  | "recording_too_large"
  | "chunk_assembly_failed"
  | "media_verification_failed"
  | "finalize_failed"
  | "upload_failed"
  | "upload_aborted"
  | "upload_interrupted"
  | "upload_timed_out"
  | "loom_import_failed"
  | "user_cancelled"
  | "unknown"
  | "legacy_unknown";

const recordingFailureCodes = new Set<RecordingFailureCode>([
  "storage_setup_required",
  "recording_too_large",
  "chunk_assembly_failed",
  "media_verification_failed",
  "finalize_failed",
  "upload_failed",
  "upload_aborted",
  "upload_interrupted",
  "upload_timed_out",
  "loom_import_failed",
  "user_cancelled",
  "unknown",
  "legacy_unknown",
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

export function trackRecordingFailure(params: {
  recordingId: string;
  uploadAttemptId?: string | null;
  platform: unknown;
  failureCode: RecordingFailureCode;
}): void {
  try {
    track(
      params.failureCode === "user_cancelled"
        ? "recording_cancelled"
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
      },
    );
  } catch {
    // coercion-ok: analytics is best-effort and must not affect recording recovery.
  }
}
