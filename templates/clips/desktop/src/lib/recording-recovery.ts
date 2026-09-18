import type { PendingBrowserRecordingUpload } from "./recorder";

export interface PendingNativeUpload {
  kind: "native";
  recordingId: string;
  serverUrl: string;
  folderPath?: string;
  durationMs: number;
  width?: number | null;
  height?: number | null;
  bytes: number;
  hasAudio: boolean;
  hasCamera: boolean;
  savedAt: string;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  retryCount: number;
  corrupt?: boolean;
}

export type PendingDesktopUpload =
  | PendingNativeUpload
  | PendingBrowserRecordingUpload;
export type RecoveryLookupError = {
  kind: PendingDesktopUpload["kind"];
  cause: unknown;
};
export type RecoverySnapshot = {
  uploads: PendingDesktopUpload[];
  errors: RecoveryLookupError[];
};

export function recordingRecoveryKey(upload: PendingDesktopUpload): string {
  return `${upload.kind}:${upload.recordingId}`;
}

export function shouldShowRecordingRecoveryBanner(
  view: string,
  authenticated: boolean,
): boolean {
  return authenticated && view === "recorder";
}

export function classifyRecordingRecoveryError(
  message: string,
  options: {
    storageRequired?: boolean;
    incomplete?: boolean;
    actionError?: boolean;
  } = {},
) {
  if (options.storageRequired) return "storageRequired";
  if (options.incomplete) return "recordingIncomplete";
  if (/audio.{0,80}(?:requires|needs|missing).{0,16}ffmpeg/i.test(message))
    return "audioNeedsFfmpeg";
  if (
    /(?:requires|needs|missing).{0,16}ffmpeg|ffmpeg.{0,30}(?:not found|unavailable|missing)/i.test(
      message,
    )
  )
    return "processingNeedsFfmpeg";
  if (
    /folder.{0,30}(?:unavailable|fail)|(?:could not|cannot|failed to).{0,16}open.{0,20}folder/i.test(
      message,
    )
  )
    return "folderOpenFailed";
  if (/export.{0,30}fail/i.test(message)) return "exportFailed";
  if (
    /(?:writing|sav(?:e|ing)).{0,30}(?:recording|fail)|save failed/i.test(
      message,
    )
  )
    return "localSaveFailed";
  if (/ffmpeg|finaliz|mux|source.{0,16}bytes|corrupt/i.test(message))
    return "recordingIncomplete";
  if (
    /upload.{0,40}(?:fail|interrupt|disconnect|timeout)|network.{0,20}(?:error|fail)/i.test(
      message,
    )
  )
    return "uploadInterrupted";
  if (options.actionError) return "recoveryActionFailed";
  return "recordingNeedsAttention";
}

export function recordingRecoverySeverity(
  messages: readonly (string | null | undefined)[],
  options: { incomplete?: boolean; inProgress?: boolean } = {},
): "neutral" | "warning" | "error" {
  if (options.inProgress) return "neutral";
  if (
    options.incomplete ||
    messages.some((message) => {
      const kind = classifyRecordingRecoveryError(message || "");
      return kind === "recordingIncomplete" || kind === "localSaveFailed";
    })
  )
    return "error";
  return "warning";
}

function isRecoveryMetadata(
  value: unknown,
  kind: PendingDesktopUpload["kind"],
): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const nonnegativeNumber = (field: unknown) =>
    typeof field === "number" && Number.isFinite(field) && field >= 0;
  return (
    typeof row.recordingId === "string" &&
    row.recordingId.trim().length > 0 &&
    typeof row.serverUrl === "string" &&
    typeof row.savedAt === "string" &&
    nonnegativeNumber(row.bytes) &&
    nonnegativeNumber(row.durationMs) &&
    nonnegativeNumber(row.retryCount) &&
    Number.isInteger(row.retryCount) &&
    typeof row.hasAudio === "boolean" &&
    typeof row.hasCamera === "boolean" &&
    (row.width == null || nonnegativeNumber(row.width)) &&
    (row.height == null || nonnegativeNumber(row.height)) &&
    (row.lastAttemptAt == null || typeof row.lastAttemptAt === "string") &&
    (row.lastError == null || typeof row.lastError === "string") &&
    (kind === "native"
      ? (row.kind == null || row.kind === "native") &&
        (row.folderPath == null || typeof row.folderPath === "string") &&
        (row.corrupt == null || typeof row.corrupt === "boolean")
      : row.kind === "browser" &&
        nonnegativeNumber(row.chunkCount) &&
        Number.isInteger(row.chunkCount) &&
        typeof row.mimeType === "string" &&
        row.mimeType.length > 0 &&
        (row.uploadAttemptId == null ||
          typeof row.uploadAttemptId === "string"))
  );
}

export function reconcileRecordingRecovery(
  previous: PendingDesktopUpload[],
  native: PromiseSettledResult<Omit<PendingNativeUpload, "kind">[]>,
  browser: PromiseSettledResult<PendingBrowserRecordingUpload[]>,
): RecoverySnapshot {
  const uploads: PendingDesktopUpload[] = [];
  const errors: RecoveryLookupError[] = [];
  for (const [kind, result] of [
    ["native", native],
    ["browser", browser],
  ] as const) {
    if (
      result.status === "fulfilled" &&
      Array.isArray(result.value) &&
      result.value.every((value) => isRecoveryMetadata(value, kind))
    ) {
      uploads.push(
        ...result.value.map(
          (upload) => ({ ...upload, kind }) as PendingDesktopUpload,
        ),
      );
    } else {
      errors.push({
        kind,
        cause:
          result.status === "rejected"
            ? result.reason
            : new Error("Invalid pending recording response"),
      });
      uploads.push(...previous.filter((upload) => upload.kind === kind));
    }
  }
  uploads.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return { uploads, errors };
}
