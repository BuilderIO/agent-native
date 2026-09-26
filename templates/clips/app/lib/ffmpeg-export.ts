
import {
  effectiveDuration,
  getKeptRanges,
  parseEdits,
  type EditsJson,
} from "./timestamp-mapping";

export interface ExportProgress {
  progress: number;
  stage: "loading-ffmpeg" | "preparing" | "encoding" | "finalizing";
  message?: string;
}

export interface ExportRecording {
  id: string;
  videoUrl: string | null;
  durationMs: number;
  videoFormat?: "webm" | "mp4";
  title?: string;
}

export interface ExportResult {
  blob: Blob;
  durationMs: number;
  filename: string;
}

export interface ConcatExportResult {
  blob: Blob;
  width: number;
  height: number;
}

export const LONG_EXPORT_THRESHOLD_MS = 10 * 60 * 1000;

let ffmpegInstancePromise: Promise<any> | null = null;
let ffmpegLogListeners: Array<(msg: string) => void> = [];

export async function loadFfmpeg(onLog?: (msg: string) => void): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error("ffmpeg.wasm is only available in the browser");
  }
  if (!ffmpegInstancePromise) {
    ffmpegInstancePromise = (async () => {
      const [{ FFmpeg }, util] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);
      const ffmpeg = new FFmpeg();
      ffmpeg.on("log", ({ message }: { message: string }) => {
        for (const listener of ffmpegLogListeners) {
          try {
            listener(message);
          } catch {
            // a busted listener must not block the others.
          }
        }
      });
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      await ffmpeg.load({
        coreURL: await util.toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          "text/javascript",
        ),
        wasmURL: await util.toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          "application/wasm",
        ),
      });
      return ffmpeg;
    })().catch((err) => {
      ffmpegInstancePromise = null;
      throw err;
    });
  }

  if (onLog && !ffmpegLogListeners.includes(onLog)) {
    ffmpegLogListeners.push(onLog);
  }

  return ffmpegInstancePromise;
}

export function removeFfmpegLogListener(listener: (msg: string) => void): void {
  ffmpegLogListeners = ffmpegLogListeners.filter((l) => l !== listener);
}

export function resetFfmpegInstance(): void {
  ffmpegInstancePromise = null;
  ffmpegLogListeners = [];
}

export async function exportMp4(
  recording: ExportRecording,
  editsJsonRaw: EditsJson | string | null | undefined,
  onProgress?: (p: ExportProgress) => void,
): Promise<ExportResult> {
  if (!recording.videoUrl) {
    throw new Error("Recording has no videoUrl to export");
  }

  const edits =
    typeof editsJsonRaw === "string"
      ? parseEdits(editsJsonRaw)
      : (editsJsonRaw ?? parseEdits("{}"));

  onProgress?.({ progress: 0, stage: "loading-ffmpeg" });
  let lastProgress = 0;
  const onLog = (msg: string) => {
    onProgress?.({ progress: lastProgress, stage: "encoding", message: msg });
  };
  const ffmpeg = await loadFfmpeg(onLog);

  const handleProgress = ({ progress }: { progress: number }) => {
    lastProgress = Math.max(0, Math.min(1, progress));
    onProgress?.({
      progress: lastProgress,
      stage: "encoding",
    });
  };
  ffmpeg.on("progress", handleProgress);

  try {
    onProgress?.({ progress: 0, stage: "preparing" });

    const { fetchFile } = await import("@ffmpeg/util");
    const inputName = `input.${recording.videoFormat ?? "webm"}`;
    const outputName = "output.mp4";
    await ffmpeg.writeFile(inputName, await fetchFile(recording.videoUrl));

    const kept = getKeptRanges(recording.durationMs, edits);
    const effective = effectiveDuration(recording.durationMs, edits);

    if (
      kept.length === 1 &&
      kept[0].startMs === 0 &&
      kept[0].endMs === recording.durationMs
    ) {
      await ffmpeg.exec([
        "-i",
        inputName,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outputName,
      ]);
    } else {
      const filterParts: string[] = [];
      const concatInputs: string[] = [];
      kept.forEach((range, i) => {
        const startSec = range.startMs / 1000;
        const endSec = range.endMs / 1000;
        filterParts.push(
          `[0:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS[v${i}]`,
        );
        filterParts.push(
          `[0:a]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS[a${i}]`,
        );
        concatInputs.push(`[v${i}][a${i}]`);
      });
      filterParts.push(
        `${concatInputs.join("")}concat=n=${kept.length}:v=1:a=1[outv][outa]`,
      );
      const filterComplex = filterParts.join(";");

      await ffmpeg.exec([
        "-i",
        inputName,
        "-filter_complex",
        filterComplex,
        "-map",
        "[outv]",
        "-map",
        "[outa]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outputName,
      ]);
    }

    onProgress?.({ progress: 1, stage: "finalizing" });
    const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
    const blob = new Blob([data as BlobPart], { type: "video/mp4" });

    try {
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch {
      // noop
    }

    const safeTitle = (recording.title ?? `clip-${recording.id}`).replace(
      /[^a-z0-9-_]+/gi,
      "-",
    );
    return {
      blob,
      durationMs: effective,
      filename: `${safeTitle}.mp4`,
    };
  } finally {
    ffmpeg.off("progress", handleProgress);
    removeFfmpegLogListener(onLog);
  }
}

export async function exportGif(
  recording: ExportRecording,
  startMs: number,
  durationMs: number,
  onProgress?: (p: ExportProgress) => void,
): Promise<Blob> {
  if (!recording.videoUrl) throw new Error("Recording has no videoUrl");

  onProgress?.({ progress: 0, stage: "loading-ffmpeg" });
  const ffmpeg = await loadFfmpeg();
  const { fetchFile } = await import("@ffmpeg/util");

  const inputName = `input.${recording.videoFormat ?? "webm"}`;
  const outputName = "thumb.gif";
  await ffmpeg.writeFile(inputName, await fetchFile(recording.videoUrl));

  const startSec = startMs / 1000;
  const durSec = Math.max(0.25, durationMs / 1000);

  const handleProgress = ({ progress }: { progress: number }) => {
    onProgress?.({ progress, stage: "encoding" });
  };
  ffmpeg.on("progress", handleProgress);

  try {
    await ffmpeg.exec([
      "-ss",
      String(startSec),
      "-t",
      String(durSec),
      "-i",
      inputName,
      "-vf",
      "fps=15,scale=320:-2:flags=lanczos",
      "-loop",
      "0",
      outputName,
    ]);
    const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
    const blob = new Blob([data as BlobPart], { type: "image/gif" });
    try {
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch {
      // noop
    }
    return blob;
  } finally {
    ffmpeg.off("progress", handleProgress);
  }
}

export async function exportConcat(
  sources: Array<{
    url: string;
    format?: "webm" | "mp4";
    hasAudio?: boolean;
    width?: number;
    height?: number;
  }>,
  onProgress?: (p: ExportProgress) => void,
): Promise<ConcatExportResult> {
  if (sources.length < 2) {
    throw new Error("exportConcat needs at least 2 sources");
  }

  onProgress?.({ progress: 0, stage: "loading-ffmpeg" });
  const dimensions = await Promise.all(
    sources.map(async (source) => {
      if (
        Number.isFinite(source.width) &&
        source.width! > 0 &&
        Number.isFinite(source.height) &&
        source.height! > 0
      ) {
        return { width: source.width!, height: source.height! };
      }

      return new Promise<{ width: number; height: number }>(
        (resolve, reject) => {
          const video = document.createElement("video");
          let settled = false;
          const timeout = setTimeout(
            () => finish(new Error("Video metadata timed out")),
            10_000,
          );
          const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            const dimensions = {
              width: video.videoWidth,
              height: video.videoHeight,
            };
            clearTimeout(timeout);
            video.onloadedmetadata = null;
            video.onerror = null;
            video.removeAttribute("src");
            if (error) reject(error);
            else resolve(dimensions);
          };
          video.preload = "metadata";
          video.onloadedmetadata = () => {
            if (video.videoWidth > 0 && video.videoHeight > 0) finish();
            else finish(new Error("Video metadata has no dimensions"));
          };
          video.onerror = () =>
            finish(new Error("Could not read video dimensions"));
          video.src = source.url;
          video.load();
        },
      );
    }),
  );
  const targetWidth =
    Math.ceil(Math.max(...dimensions.map(({ width }) => width)) / 2) * 2;
  const targetHeight =
    Math.ceil(Math.max(...dimensions.map(({ height }) => height)) / 2) * 2;
  const ffmpeg = await loadFfmpeg();
  const { fetchFile } = await import("@ffmpeg/util");

  onProgress?.({ progress: 0, stage: "preparing" });
  for (let i = 0; i < sources.length; i++) {
    const name = `src${i}.${sources[i].format ?? "webm"}`;
    await ffmpeg.writeFile(name, await fetchFile(sources[i].url));
  }

  const handleProgress = ({ progress }: { progress: number }) => {
    onProgress?.({ progress, stage: "encoding" });
  };
  ffmpeg.on("progress", handleProgress);

  try {
    const inputArgs = sources.flatMap((s, i) => [
      "-i",
      `src${i}.${s.format ?? "webm"}`,
    ]);
    const includesAudio = sources.every((source) => source.hasAudio !== false);
    const filterParts: string[] = [];
    const concatInputs: string[] = [];
    for (let i = 0; i < sources.length; i++) {
      filterParts.push(
        `[${i}:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS[v${i}]`,
      );
      if (includesAudio) {
        filterParts.push(`[${i}:a]asetpts=PTS-STARTPTS[a${i}]`);
        concatInputs.push(`[v${i}][a${i}]`);
      } else {
        concatInputs.push(`[v${i}]`);
      }
    }
    filterParts.push(
      `${concatInputs.join("")}concat=n=${sources.length}:v=1:a=${includesAudio ? 1 : 0}[outv]${includesAudio ? "[outa]" : ""}`,
    );
    const outputArgs = [
      ...inputArgs,
      "-filter_complex",
      filterParts.join(";"),
      "-map",
      "[outv]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      ...(includesAudio
        ? ["-map", "[outa]", "-c:a", "aac", "-b:a", "128k"]
        : []),
      "-movflags",
      "+faststart",
      "stitched.mp4",
    ];
    const exitCode = await ffmpeg.exec(outputArgs);
    if (exitCode !== 0) {
      throw new Error(`Could not combine recordings (ffmpeg exit ${exitCode})`);
    }

    const data = (await ffmpeg.readFile("stitched.mp4")) as Uint8Array;
    const blob = new Blob([data as BlobPart], { type: "video/mp4" });
    try {
      for (let i = 0; i < sources.length; i++) {
        await ffmpeg.deleteFile(`src${i}.${sources[i].format ?? "webm"}`);
      }
      await ffmpeg.deleteFile("stitched.mp4");
    } catch {
      // noop
    }
    return { blob, width: targetWidth, height: targetHeight };
  } finally {
    ffmpeg.off("progress", handleProgress);
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}
