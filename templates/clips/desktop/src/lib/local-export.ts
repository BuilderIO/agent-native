import { join, videoDir } from "@tauri-apps/api/path";
import {
  BaseDirectory,
  create,
  mkdir,
  remove,
  type FileHandle,
} from "@tauri-apps/plugin-fs";

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
  start(timesliceMs?: number): void;
  pause(): void;
  resume(): void;
  stop(durationMs: number): Promise<LocalExportedFile[]>;
  cancel(): Promise<void>;
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

const LOCAL_EXPORT_FOLDER = "Clips";

function pickRecordingMimeType(): string {
  return (
    [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? ""
  );
}

function extensionForMimeType(mimeType: string): string {
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

function recordingBasename(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nonce = Math.random().toString(36).slice(2, 8);
  return `clip-${timestamp}-${nonce}`;
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
    try {
      recorder.requestData();
    } catch {
      // ignore
    }
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
): Promise<LocalRecordingExportHandle> {
  if (targets.length === 0) {
    throw new Error("No local recording streams are available");
  }

  await mkdir(LOCAL_EXPORT_FOLDER, {
    baseDir: BaseDirectory.Video,
    recursive: true,
  });

  const folderPath = await join(await videoDir(), LOCAL_EXPORT_FOLDER);
  const basename = recordingBasename();
  const prepared: PreparedLocalTarget[] = [];

  try {
    for (const target of targets) {
      const mimeType = pickRecordingMimeType();
      const extension = extensionForMimeType(mimeType || "video/webm");
      const fileName = `${basename}-${roleFileSuffix(target.role)}.${extension}`;
      const relativePath = `${LOCAL_EXPORT_FOLDER}/${fileName}`;
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
