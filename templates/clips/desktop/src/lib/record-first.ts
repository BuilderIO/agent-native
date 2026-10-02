import type { LocalRecordingMode } from "../shared/config";
import type { LocalExportedFile } from "./local-export";
import type { PendingBrowserRecordingUpload } from "./recorder";

export type VideoStorageStatus = "checking" | "configured" | "missing";

/**
 * The local mode a recording actually uses. Recording never waits on
 * storage: until storage reads as connected (missing, still checking, or
 * unreachable) a cloud recording is written to Movies/Clips first and
 * uploads once storage connects.
 */
export function effectiveLocalRecordingMode(
  mode: LocalRecordingMode,
  storageStatus: VideoStorageStatus,
): LocalRecordingMode {
  return mode === "off" && storageStatus !== "configured" ? "composed" : mode;
}

/** A recording saved to disk because storage was not connected yet. */
export interface RecordFirstFile extends LocalExportedFile {
  hasAudio: boolean;
  hasCamera: boolean;
  savedAt: string;
}

/**
 * Per server and account, so a file only ever uploads to who recorded it. A
 * file saved while signed out (an expired session) goes under "unclaimed"
 * and uploads only after the user explicitly adds it to their account.
 */
export function recordFirstFilesKey(
  serverOrigin: string,
  account: string | null,
) {
  return `clips-record-first-files:${serverOrigin}|${account ? account.toLowerCase() : "unclaimed"}`;
}

/** A failure that means the file itself is gone, so retrying cannot help. */
export function isMissingRecordFirstFile(message: string): boolean {
  return /not found|no such file|os error 2|does not exist/i.test(message);
}

/** Absent is an empty list; an unreadable list throws instead of hiding files. */
export function loadRecordFirstFiles(
  storage: Pick<Storage, "getItem">,
  key: string,
): RecordFirstFile[] {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("The list of recordings waiting for storage is unreadable");
  }
  return parsed as RecordFirstFile[];
}

export function saveRecordFirstFiles(
  storage: Pick<Storage, "setItem" | "removeItem">,
  key: string,
  files: RecordFirstFile[],
): void {
  if (files.length === 0) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(files));
}

/**
 * A record-first file in the desktop backup store's shape, so the existing
 * pending-upload retry path uploads it into its new server row.
 */
export function recordFirstBackup(input: {
  recordingId: string;
  serverUrl: string;
  file: RecordFirstFile;
  bytes: Uint8Array;
  chunkBytes: number;
  now?: Date;
}): {
  meta: Omit<PendingBrowserRecordingUpload, "kind">;
  chunks: Array<{
    recordingId: string;
    index: number;
    blob: Blob;
    bytes: number;
    mimeType: string;
    createdAt: string;
  }>;
} {
  const { recordingId, file, bytes, chunkBytes } = input;
  const createdAt = (input.now ?? new Date()).toISOString();
  const chunks = [];
  for (let start = 0; start < bytes.byteLength; start += chunkBytes) {
    const slice = bytes.slice(start, start + chunkBytes);
    chunks.push({
      recordingId,
      index: chunks.length,
      blob: new Blob([slice], { type: file.mimeType }),
      bytes: slice.byteLength,
      mimeType: file.mimeType,
      createdAt,
    });
  }
  return {
    meta: {
      recordingId,
      serverUrl: input.serverUrl.replace(/\/+$/, ""),
      durationMs: file.durationMs,
      width: file.width ?? null,
      height: file.height ?? null,
      bytes: bytes.byteLength,
      hasAudio: file.hasAudio,
      hasCamera: file.hasCamera,
      savedAt: file.savedAt,
      lastAttemptAt: null,
      lastError: null,
      retryCount: 0,
      chunkCount: chunks.length,
      mimeType: file.mimeType,
    },
    chunks,
  };
}
