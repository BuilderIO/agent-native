import { getRequestContext } from "@agent-native/core/server/request-context";
import { track } from "@agent-native/core/tracking";

export type RecordingFailureCode =
  | "storage_setup_required"
  | "hosted_storage_unavailable"
  | "recording_too_large"
  | "chunk_assembly_failed"
  | "media_verification_failed"
  | "finalize_failed"
  | "upload_failed"
  | "multipart_start_failed"
  | "chunk_html_error"
  | "upload_aborted"
  | "upload_interrupted"
  | "recording_interrupted"
  | "upload_timed_out"
  | "loom_import_failed"
  | "user_cancelled"
  | "unknown";

const recordingFailureCodes = new Set<RecordingFailureCode>([
  "storage_setup_required",
  "hosted_storage_unavailable",
  "recording_too_large",
  "chunk_assembly_failed",
  "media_verification_failed",
  "finalize_failed",
  "upload_failed",
  "multipart_start_failed",
  "chunk_html_error",
  "upload_aborted",
  "upload_interrupted",
  "recording_interrupted",
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

export function hostedStorageAuthFailure(
  error: unknown,
): { status?: number } | null {
  const pending = [error];
  const seen = new Set<object>();

  for (let depth = 0; depth < 5 && pending.length > 0; depth += 1) {
    const candidate = pending.shift();
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    const details = candidate as Record<string, unknown>;
    const response =
      details.response && typeof details.response === "object"
        ? (details.response as Record<string, unknown>)
        : null;
    const metadata =
      details.$metadata && typeof details.$metadata === "object"
        ? (details.$metadata as Record<string, unknown>)
        : null;
    const statusValue =
      details.status ??
      details.statusCode ??
      details.httpStatus ??
      response?.status ??
      metadata?.httpStatusCode;
    const status =
      Number.isInteger(statusValue) && Number(statusValue) >= 100
        ? Number(statusValue)
        : undefined;
    const typedAuthFailure = [
      details.name,
      details.code,
      details.errorCode,
      details.providerCode,
      details.Code,
    ].some(
      (value) =>
        typeof value === "string" &&
        /^(?:accessdenied(?:exception)?|expiredtoken(?:exception)?|invalidaccesskeyid|invalidtoken|invalidsignature|signaturedoesnotmatch|unauthorized|forbidden|authenticationfailed|authorizationfailed|authfailure|unrecognizedclientexception)$/i.test(
          value.replace(/[^a-z]/gi, ""),
        ),
    );
    if (status === 401 || status === 403 || typedAuthFailure) {
      return { ...(status ? { status } : {}) };
    }
    if (details.cause) pending.push(details.cause);
  }
  return null;
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

export function recordingTrackingSource(
  userId: string,
  browserSessionId?: string,
) {
  const requestContext = getRequestContext();
  const authUserId = requestContext?.authUserId;
  const sessionId = browserSessionId ?? requestContext?.browserSessionId;
  return {
    userId,
    ...(authUserId ? { authUserId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export function trackRecordingFailure(params: {
  recordingId: string;
  userId: string;
  uploadAttemptId?: string | null;
  platform: unknown;
  failureCode: RecordingFailureCode;
  failureStage?: "multipart_start" | "chunk_upload" | "reset_chunks";
  httpStatus?: number;
  browserSessionId?: string;
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
        ...(params.failureStage ? { failure_stage: params.failureStage } : {}),
        ...(Number.isInteger(params.httpStatus)
          ? { http_status: params.httpStatus }
          : {}),
      },
      recordingTrackingSource(params.userId, params.browserSessionId),
    );
  } catch {
    // coercion-ok: analytics is best-effort and must not affect recording recovery.
  }
}
