import { join, videoDir } from "@tauri-apps/api/path";
import {
  BaseDirectory,
  create,
  mkdir,
  readFile,
  remove,
  writeFile,
  type FileHandle,
} from "@tauri-apps/plugin-fs";

import { injectWebmDuration } from "./webm-duration";

export type LocalRecordingFileRole = "composed" | "desktop" | "camera";

export interface LocalRecordingTarget {
  role: LocalRecordingFileRole;
  stream: MediaStream;
}

export interface LocalExportedFile {
  role: LocalRecordingFileRole;
  path: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  durationMs: number;
  width?: number | null;
  height?: number | null;
}

export interface LocalRecordingExportHandle {
  folderPath: string;
  folderName: string;
  start(timesliceMs?: number): void;
  pause(): void;
  resume(): void;
  stop(durationMs: number): Promise<LocalExportedFile[]>;
  cancel(): Promise<void>;
}

export interface LocalBlobExportResult {
  folderPath: string;
  folderName: string;
  file: LocalExportedFile;
}

interface PreparedLocalTarget {
  role: LocalRecordingFileRole;
  stream: MediaStream;
  recorder: MediaRecorder;
  file: FileHandle;
  fileName: string;
  relativePath: string;
  absolutePath: string;
  mimeType: string;
  bytes: number;
  failed: Error | null;
  writeQueue: Promise<void>;
}

interface WebmDurationPatchTarget {
  role: LocalRecordingFileRole;
  relativePath: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  failed?: Error | null;
}

export const LOCAL_EXPORT_FOLDER = "Clips";

function pickRecordingMimeType(): string {
  return (
    [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? ""
  );
}

export function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("quicktime")) return "mov";
  return "webm";
}

function roleFileSuffix(role: LocalRecordingFileRole): string {
  return {
    composed: "clip",
    desktop: "desktop",
    camera: "camera",
  }[role];
}

export function createLocalRecordingFolderName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nonce = Math.random().toString(36).slice(2, 8);
  return `clip-${timestamp}-${nonce}`;
}

export async function exportBlobChunksToLocalRecordingFile({
  chunks,
  role = "composed",
  mimeType,
  folderName,
  durationMs = 0,
  width = null,
  height = null,
}: {
  chunks: Blob[];
  role?: LocalRecordingFileRole;
  mimeType: string;
  folderName?: string;
  durationMs?: number;
  width?: number | null;
  height?: number | null;
}): Promise<LocalBlobExportResult> {
  if (chunks.length === 0) {
    throw new Error("No saved recording chunks are available to export");
  }

  const resolvedFolderName = folderName ?? createLocalRecordingFolderName();
  const relativeFolderPath = `${LOCAL_EXPORT_FOLDER}/${resolvedFolderName}`;
  const normalizedMimeType = mimeType || "video/webm";
  const fileName = `${roleFileSuffix(role)}.${extensionForMimeType(
    normalizedMimeType,
  )}`;
  const relativePath = `${relativeFolderPath}/${fileName}`;

  await mkdir(relativeFolderPath, {
    baseDir: BaseDirectory.Video,
    recursive: true,
  });

  const folderPath = await join(await videoDir(), relativeFolderPath);
  const filePath = await join(folderPath, fileName);
  const file = await create(relativePath, {
    baseDir: BaseDirectory.Video,
  });

  let bytes = 0;
  let closed = false;
  try {
    for (const chunk of chunks) {
      if (!chunk || chunk.size === 0) continue;
      const data = new Uint8Array(await chunk.arrayBuffer());
      if (data.byteLength === 0) continue;
      const written = await file.write(data);
      if (written !== data.byteLength) {
        throw new Error(
          `Short write for ${fileName}: wrote ${written} of ${data.byteLength} bytes`,
        );
      }
      bytes += written;
    }
    await file.close();
    closed = true;
  } catch (err) {
    if (!closed) {
      await file.close().catch(() => {});
    }
    await remove(relativePath, {
      baseDir: BaseDirectory.Video,
    }).catch(() => {});
    throw err;
  }

  if (bytes === 0) {
    await remove(relativePath, {
      baseDir: BaseDirectory.Video,
    }).catch(() => {});
    throw new Error("Saved recording export was empty");
  }

  const patchTarget: WebmDurationPatchTarget = {
    role,
    relativePath,
    fileName,
    mimeType: normalizedMimeType,
    bytes,
    failed: null,
  };
  await finalizeWebmDuration(patchTarget, durationMs);
  bytes = patchTarget.bytes;

  return {
    folderPath,
    folderName: resolvedFolderName,
    file: {
      role,
      path: filePath,
      fileName,
      mimeType: normalizedMimeType,
      bytes,
      durationMs,
      width,
      height,
    },
  };
}

function enqueueWrite(target: PreparedLocalTarget, blob: Blob) {
  target.writeQueue = target.writeQueue
    .then(async () => {
      if (target.failed) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.byteLength === 0) return;
      const written = await target.file.write(bytes);
      if (written !== bytes.byteLength) {
        throw new Error(
          `Short write for ${target.fileName}: wrote ${written} of ${bytes.byteLength} bytes`,
        );
      }
      target.bytes += written;
    })
    .catch((err) => {
      target.failed = err instanceof Error ? err : new Error(String(err));
    });
}

function stopRecorder(target: PreparedLocalTarget): Promise<void> {
  return new Promise((resolve) => {
    const { recorder } = target;
    if (recorder.state === "inactive") {
      resolve();
      return;
    }
    recorder.addEventListener("stop", () => resolve(), { once: true });
    try {
      if (recorder.state === "paused") recorder.resume();
    } catch {
      // ignore
    }
    // Do NOT call recorder.requestData() before stop(). stop() already
    // synchronously flips state to "inactive" (so a queued requestData task
    // just aborts) AND fires its own final `dataavailable` containing every
    // sample since the last timeslice. Nudging the muxer with requestData()
    // immediately before the encoder is torn down makes Chromium/WebKit drop
    // the trailing sub-timeslice fragment — a consistent ~1–2s of lost frames
    // at the end (ffprobe-confirmed: the camera's last real frame landed
    // ~1.5s before the recording's true end while audio/screen ran full
    // length). The start()-time ondataavailable handler chains stop()'s final
    // blob into writeQueue, and stop(durationMs) awaits that queue, so the
    // tail is fully flushed to disk. This was re-introduced once in a bulk
    // sweep (dbf8db44e) — keep it removed.
    try {
      recorder.stop();
    } catch {
      resolve();
    }
  });
}

async function closeTargetFile(target: PreparedLocalTarget) {
  try {
    await target.file.close();
  } catch {
    // ignore
  }
}

/**
 * Reading the whole file back to patch its header is fine for the camera
 * feed (the `separate`-mode case this exists for), but a long `composed`
 * screen recording can be multi-GB. Skip the in-memory rewrite above this
 * cap rather than risk an OOM in the webview — the file is still usable,
 * just with MediaRecorder's slightly-short estimated duration.
 */
const MAX_DURATION_FIX_BYTES = 1_500 * 1024 * 1024;

/**
 * MediaRecorder WebM ships without a `Duration` element, so players
 * under-report length by up to one timeslice — which is why a `separate`
 * camera file lands ~2s shorter than the natively-muxed desktop MP4. After
 * the file is fully written and closed, rewrite it with a correct
 * `Duration` injected. Best-effort: any failure leaves the original
 * (working, slightly-short) file untouched — never a corrupted recording.
 */
async function finalizeWebmDuration(
  target: WebmDurationPatchTarget,
  durationMs: number,
): Promise<void> {
  if (target.failed) return;
  if (!/webm/i.test(target.mimeType)) return;
  if (!(durationMs > 0)) return;
  if (target.role !== "camera" && target.bytes > MAX_DURATION_FIX_BYTES) {
    return;
  }
  try {
    const original = await readFile(target.relativePath, {
      baseDir: BaseDirectory.Video,
    });
    const patched = injectWebmDuration(original, durationMs);
    // The injector returns the input reference unchanged on any no-op or
    // unsafe-to-patch path; only rewrite when it actually produced a copy.
    if (patched === original) return;
    await writeFile(target.relativePath, patched, {
      baseDir: BaseDirectory.Video,
    });
    target.bytes = patched.byteLength;
  } catch (err) {
    console.warn(
      `[clips-local-export] could not inject WebM duration for ${target.fileName}; keeping original`,
      err,
    );
  }
}

function exportedFileForTarget(
  target: PreparedLocalTarget,
  durationMs: number,
): LocalExportedFile {
  const settings = target.stream.getVideoTracks()[0]?.getSettings();
  return {
    role: target.role,
    path: target.absolutePath,
    fileName: target.fileName,
    mimeType: target.mimeType,
    bytes: target.bytes,
    durationMs,
    width: typeof settings?.width === "number" ? settings.width : null,
    height: typeof settings?.height === "number" ? settings.height : null,
  };
}

export async function prepareLocalRecordingExport(
  targets: LocalRecordingTarget[],
  options: { folderName?: string } = {},
): Promise<LocalRecordingExportHandle> {
  if (targets.length === 0) {
    throw new Error("No local recording streams are available");
  }

  const folderName = options.folderName ?? createLocalRecordingFolderName();
  const relativeFolderPath = `${LOCAL_EXPORT_FOLDER}/${folderName}`;

  await mkdir(relativeFolderPath, {
    baseDir: BaseDirectory.Video,
    recursive: true,
  });

  const folderPath = await join(await videoDir(), relativeFolderPath);
  const prepared: PreparedLocalTarget[] = [];

  try {
    for (const target of targets) {
      const mimeType = pickRecordingMimeType();
      const extension = extensionForMimeType(mimeType || "video/webm");
      const fileName = `${roleFileSuffix(target.role)}.${extension}`;
      const relativePath = `${relativeFolderPath}/${fileName}`;
      const absolutePath = await join(folderPath, fileName);
      const file = await create(relativePath, {
        baseDir: BaseDirectory.Video,
      });
      const recorder = new MediaRecorder(
        target.stream,
        mimeType ? { mimeType } : undefined,
      );
      const preparedTarget: PreparedLocalTarget = {
        role: target.role,
        stream: target.stream,
        recorder,
        file,
        fileName,
        relativePath,
        absolutePath,
        mimeType: mimeType || "video/webm",
        bytes: 0,
        failed: null,
        writeQueue: Promise.resolve(),
      };
      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        enqueueWrite(preparedTarget, event.data);
      };
      prepared.push(preparedTarget);
    }
  } catch (err) {
    await Promise.allSettled(
      prepared.map(async (target) => {
        target.recorder.ondataavailable = null;
        await closeTargetFile(target);
        await remove(target.relativePath, {
          baseDir: BaseDirectory.Video,
        }).catch(() => {});
      }),
    );
    throw err;
  }

  return {
    folderPath,
    folderName,
    start(timesliceMs = 2_000) {
      for (const target of prepared) {
        target.recorder.start(timesliceMs);
      }
    },
    pause() {
      for (const target of prepared) {
        if (target.recorder.state !== "recording") continue;
        try {
          target.recorder.pause();
        } catch {
          // ignore
        }
      }
    },
    resume() {
      for (const target of prepared) {
        if (target.recorder.state !== "paused") continue;
        try {
          target.recorder.resume();
        } catch {
          // ignore
        }
      }
    },
    async stop(durationMs: number) {
      await Promise.all(prepared.map(stopRecorder));
      await Promise.all(prepared.map((target) => target.writeQueue));
      const firstFailure = prepared.find((target) => target.failed)?.failed;
      await Promise.all(prepared.map(closeTargetFile));
      for (const target of prepared) {
        target.recorder.ondataavailable = null;
      }
      if (firstFailure) throw firstFailure;
      await Promise.all(
        prepared.map((target) => finalizeWebmDuration(target, durationMs)),
      );
      return prepared.map((target) =>
        exportedFileForTarget(target, durationMs),
      );
    },
    async cancel() {
      await Promise.allSettled(
        prepared.map(async (target) => {
          target.recorder.ondataavailable = null;
          if (target.recorder.state !== "inactive") {
            try {
              target.recorder.stop();
            } catch {
              // ignore
            }
          }
          await target.writeQueue.catch(() => {});
          await closeTargetFile(target);
          await remove(target.relativePath, { baseDir: BaseDirectory.Video });
        }),
      );
    },
  };
}
