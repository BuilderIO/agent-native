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
  /**
   * The server recording this file is being handed to, saved before that
   * row exists, so a handoff cut off by a crash resumes instead of repeating.
   */
  stagedRecordingId?: string;
}

/**
 * The files a stopped record-first capture leaves to upload: its composed
 * file, or every file it wrote when there is none.
 */
export function recordFirstFilesToQueue<T extends { role: string }>(
  files: readonly T[],
): T[] {
  const composed = files.find((file) => file.role === "composed");
  return composed ? [composed] : [...files];
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
 * The saved file itself is gone, so retrying cannot help. Thrown only when
 * the file system reports the file not found inside a folder it can still
 * read, never inferred from a server error (a server's "Not Found").
 */
export class RecordFirstFileMissingError extends Error {
  constructor() {
    super("It is no longer in Movies/Clips.");
    this.name = "RecordFirstFileMissingError";
  }
}

/** The file may still be there but cannot be read now; it stays queued. */
export class RecordFirstFileUnreadableError extends Error {
  constructor(cause: unknown) {
    super(
      `Clips can't read it right now (${cause instanceof Error ? cause.message : String(cause)}). It stays in the list; try again.`,
    );
    this.name = "RecordFirstFileUnreadableError";
  }
}

/** A file system "not found", as Tauri reports it on macOS and Windows. */
function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\(os error [23]\)|no such file or directory|cannot find the (file|path)/i.test(
    message,
  );
}

/**
 * Why a saved file could not be opened. Only a file the file system reports
 * as not found, in a folder it can still read, is missing; anything else
 * (no permission, an unmounted volume) is unreadable and stays queued.
 */
export async function classifyRecordFirstOpenFailure(
  path: string,
  cause: unknown,
  stat: (path: string) => Promise<unknown>,
): Promise<Error> {
  try {
    await stat(path);
  } catch (statError) {
    if (!isNotFoundError(statError)) {
      return new RecordFirstFileUnreadableError(statError);
    }
    const folder = path.replace(/[\\/][^\\/]*$/, "");
    try {
      await stat(folder);
      return new RecordFirstFileMissingError();
    } catch (folderError) {
      return new RecordFirstFileUnreadableError(folderError);
    }
  }
  // The file is there; opening it failed for another reason.
  return new RecordFirstFileUnreadableError(cause);
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

/**
 * Change a stored list in one synchronous read-modify-write and return what
 * was saved. Storage, not UI state, is the source of truth, so a crash right
 * after this call never loses or repeats an entry.
 */
export function changeRecordFirstFiles(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  key: string,
  change: (files: RecordFirstFile[]) => RecordFirstFile[],
): RecordFirstFile[] {
  let files: RecordFirstFile[] = [];
  try {
    files = loadRecordFirstFiles(storage, key);
  } catch {
    // coercion-ok: saveRecordFirstFiles sets the unreadable value aside before writing.
  }
  const next = change(files);
  saveRecordFirstFiles(storage, key, next);
  return next;
}

/**
 * Move every entry of one stored list into another. The destination is
 * written and read back before anything leaves the source, so a failed write
 * or a crash at any point leaves each file in at least one list, and running
 * it again never duplicates one (entries are matched by path). Throws, with
 * the source untouched, when the source is unreadable or the destination
 * write does not hold.
 */
export function transferRecordFirstFiles(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  fromKey: string,
  toKey: string,
): RecordFirstFile[] {
  const moving = loadRecordFirstFiles(storage, fromKey);
  if (moving.length === 0) return loadRecordFirstFiles(storage, toKey);
  changeRecordFirstFiles(storage, toKey, (own) => [
    ...own,
    ...moving.filter((f) => !own.some((mine) => mine.path === f.path)),
  ]);
  const landed = loadRecordFirstFiles(storage, toKey);
  const landedPaths = new Set(landed.map((f) => f.path));
  if (!moving.every((f) => landedPaths.has(f.path))) {
    throw new Error("Clips couldn't add those recordings to your account.");
  }
  changeRecordFirstFiles(storage, fromKey, (source) =>
    source.filter((f) => !landedPaths.has(f.path)),
  );
  return landed;
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
