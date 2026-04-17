/**
 * Lazy-loaded ffmpeg.wasm wrapper for exporting edited recordings to MP4.
 *
 * Implementation notes / assumed limits:
 *  - ffmpeg.wasm is ~30MB, so we lazy-load it only when the user actually
 *    clicks Export.
 *  - Memory ceiling is ~2GB (single-threaded WASM). We've been able to export
 *    up to about 10 minutes of 1080p WebM → MP4 in practice; longer than that
 *    and the browser tab tends to OOM, which is why the UI warns before
 *    exporting anything longer.
 *  - We use filter_complex with the concat filter to cut out the excluded
 *    ranges rather than the demuxer `-f concat` + intermediate files; that's
 *    both simpler and robust against keyframe boundaries.
 *  - We transcode to H.264 + AAC so the result plays in every browser. If the
 *    source was already MP4/H.264, we could attempt `-c copy` as an
 *    optimisation but the concat filter requires re-encoding anyway.
 *
 * Usage:
 *   const result = await exportMp4(recording, edits, (p) => setProgress(p));
 *   const url = URL.createObjectURL(result.blob);
 */

import {
  effectiveDuration,
  getKeptRanges,
  parseEdits,
  type EditsJson,
} from "./timestamp-mapping";

export interface ExportProgress {
  /** 0..1 */
  progress: number;
  /** Current stage for UI display. */
  stage: "loading-ffmpeg" | "preparing" | "encoding" | "finalizing";
  /** Free-form message to surface in the UI (e.g. ffmpeg logs). */
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

/** Threshold above which the UI should warn the user before exporting. */
export const LONG_EXPORT_THRESHOLD_MS = 10 * 60 * 1000;

let ffmpegInstancePromise: Promise<any> | null = null;

/**
 * Lazy-load ffmpeg.wasm once per tab. Subsequent calls resolve to the same
 * instance. The wasm core is fetched from the CDN matching the version we
 * declared in package.json.
 */
export async function loadFfmpeg(onLog?: (msg: string) => void): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error("ffmpeg.wasm is only available in the browser");
  }
  if (ffmpegInstancePromise) return ffmpegInstancePromise;

  ffmpegInstancePromise = (async () => {
    const [{ FFmpeg }, util] = await Promise.all([
      import("@ffmpeg/ffmpeg"),
      import("@ffmpeg/util"),
    ]);
    const ffmpeg = new FFmpeg();
    if (onLog) {
      ffmpeg.on("log", ({ message }: { message: string }) => {
        onLog(message);
      });
    }
    // Match the version of @ffmpeg/ffmpeg installed in package.json.
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
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

  return ffmpegInstancePromise;
}

/**
 * Export a recording with its non-destructive edits applied. Currently
 * supports cutting out excluded ranges and re-encoding to H.264+AAC MP4.
 * Blurs are not yet applied in this first pass — the MP4 export is primarily
 * for clean "remove the umms" style cuts.
 */
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
  const ffmpeg = await loadFfmpeg((msg) => {
    onProgress?.({ progress: -1, stage: "encoding", message: msg });
  });

  // Hook ffmpeg progress events — they fire per frame written.
  const handleProgress = ({ progress }: { progress: number }) => {
    onProgress?.({
      progress: Math.max(0, Math.min(1, progress)),
      stage: "encoding",
    });
  };
  ffmpeg.on("progress", handleProgress);

  try {
    onProgress?.({ progress: 0, stage: "preparing" });

    // Fetch the source video into WASM's virtual FS.
    const { fetchFile } = await import("@ffmpeg/util");
    const inputName = `input.${recording.videoFormat ?? "webm"}`;
    const outputName = "output.mp4";
    await ffmpeg.writeFile(inputName, await fetchFile(recording.videoUrl));

    const kept = getKeptRanges(recording.durationMs, edits);
    const effective = effectiveDuration(recording.durationMs, edits);

    // Fast path: no trims — just transcode.
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
      // Build a filter_complex that trims each kept range and concats them.
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

    // Best-effort cleanup so WASM memory is freed up for another export.
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
  }
}

/**
 * Generate an animated GIF from a slice of the video. Used by the thumbnail
 * picker's "Animated GIF" tab. Keeps GIF small by scaling to 320px wide and
 * 15fps — more than enough for a library thumbnail.
 */
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

/**
 * Client-side concat of N videos into a single MP4. Used by the Stitch dialog
 * before calling the `stitch-recordings` action with the uploaded URL.
 */
export async function exportConcat(
  sources: Array<{ url: string; format?: "webm" | "mp4" }>,
  onProgress?: (p: ExportProgress) => void,
): Promise<Blob> {
  if (sources.length < 2) {
    throw new Error("exportConcat needs at least 2 sources");
  }

  onProgress?.({ progress: 0, stage: "loading-ffmpeg" });
  const ffmpeg = await loadFfmpeg();
  const { fetchFile } = await import("@ffmpeg/util");

  // Load all inputs
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
    const filterParts: string[] = [];
    const concatInputs: string[] = [];
    for (let i = 0; i < sources.length; i++) {
      filterParts.push(`[${i}:v]setpts=PTS-STARTPTS[v${i}]`);
      filterParts.push(`[${i}:a]asetpts=PTS-STARTPTS[a${i}]`);
      concatInputs.push(`[v${i}][a${i}]`);
    }
    filterParts.push(
      `${concatInputs.join("")}concat=n=${sources.length}:v=1:a=1[outv][outa]`,
    );
    await ffmpeg.exec([
      ...inputArgs,
      "-filter_complex",
      filterParts.join(";"),
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
      "stitched.mp4",
    ]);

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
    return blob;
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
