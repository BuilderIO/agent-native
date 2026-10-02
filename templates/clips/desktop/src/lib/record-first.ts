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

/**
 * The saved file itself is gone, so retrying cannot help. Thrown only after
 * the file system confirms the path no longer exists, never inferred from an
 * error message (a server's "Not Found" is not a missing file).
 */
export class RecordFirstFileMissingError extends Error {
  constructor(fileName: string) {
    super(`${fileName} is no longer in Movies/Clips.`);
    this.name = "RecordFirstFileMissingError";
  }
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

/**
 * A stored list that cannot be read is never overwritten: its raw value is
 * set aside under its own key first, so the files it names stay findable.
 */
export function saveRecordFirstFiles(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  key: string,
  files: RecordFirstFile[],
  nowMs = Date.now(),
): void {
  try {
    loadRecordFirstFiles(storage, key);
  } catch {
    const raw = storage.getItem(key);
    if (raw !== null) storage.setItem(`${key}:unreadable:${nowMs}`, raw);
  }
  if (files.length === 0) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(files));
}

export interface RecordFirstChunk {
  recordingId: string;
  index: number;
  blob: Blob;
  bytes: number;
  mimeType: string;
  createdAt: string;
}

/**
 * Copy a record-first file into the desktop backup store's shape, so the
 * existing pending-upload retry path uploads it into its new server row. The
 * file is read one slice at a time, so memory holds a single slice however
 * long the recording is.
 */
export async function stageRecordFirstFile(input: {
  recordingId: string;
  serverUrl: string;
  file: RecordFirstFile;
  /** Reads into `buffer`; resolves to the bytes read, or null at the end. */
  read: (buffer: Uint8Array) => Promise<number | null>;
  putChunk: (chunk: RecordFirstChunk) => Promise<void>;
  chunkBytes: number;
  now?: Date;
}): Promise<Omit<PendingBrowserRecordingUpload, "kind">> {
  const { recordingId, file, chunkBytes } = input;
  const createdAt = (input.now ?? new Date()).toISOString();
  let bytes = 0;
  let chunkCount = 0;
  for (;;) {
    const buffer = new Uint8Array(chunkBytes);
    let filled = 0;
    // A read may return fewer bytes than asked for before the end.
    while (filled < chunkBytes) {
      const read = await input.read(buffer.subarray(filled));
      if (!read) break;
      filled += read;
    }
    if (filled > 0) {
      await input.putChunk({
        recordingId,
        index: chunkCount,
        blob: new Blob([buffer.subarray(0, filled)], { type: file.mimeType }),
        bytes: filled,
        mimeType: file.mimeType,
        createdAt,
      });
      bytes += filled;
      chunkCount += 1;
    }
    if (filled < chunkBytes) break;
  }
  if (bytes === 0) throw new Error(`${file.fileName} is empty`);
  return {
    recordingId,
    serverUrl: input.serverUrl.replace(/\/+$/, ""),
    durationMs: file.durationMs,
    width: file.width ?? null,
    height: file.height ?? null,
    bytes,
    hasAudio: file.hasAudio,
    hasCamera: file.hasCamera,
    savedAt: file.savedAt,
    lastAttemptAt: null,
    lastError: null,
    retryCount: 0,
    chunkCount,
    mimeType: file.mimeType,
  };
}
