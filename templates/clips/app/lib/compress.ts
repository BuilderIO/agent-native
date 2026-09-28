/**
 * Browser-side video compression for clips that would exceed the upload
 * provider's per-file limit.
 *
 * The motivating bug: Builder.io's `/api/v1/upload` looks like it caps files
 * at 100 MB (`fileUpload({ limits: { fileSize: 100 * 1024 * 1024 } })` plus a
 * `express.raw({ limit: '200mb' })` body limit), but the REAL ceiling is far
 * lower: the upload endpoint runs as a Gen-2 Cloud Function (Cloud Run), whose
 * inbound HTTP request body is hard-capped at ~32 MB by the Google Front End —
 * a platform limit the app config can't raise. Bodies above ~32 MB are dropped
 * at the edge or OOM the 256 MB function while it buffers the whole body in
 * memory, and the client sees an opaque `Builder.io upload failed (500)`. So a
 * blob only has to clear ~32 MB — not 100 MB — to fail. Saee hit this on her
 * second clip. We therefore compress to a target well under 32 MB and hard-stop
 * client-side with a clear message instead of letting Builder 500.
 *
 * (Builder has no resumable / signed-URL upload endpoint today, so true
 * 100 MB–2 GB videos need either an S3-compatible provider or a new
 * builder-internal direct-to-GCS flow — tracked as separate work.)
 *
 * Strategy: ride the existing ffmpeg.wasm install (we already lazy-load it
 * for export / GIF / stitch in `ffmpeg-export.ts`). Re-encode oversized clips
 * to HandBrake-style H.264/AAC MP4: x264 preset `fast`, CRF/RF-first quality,
 * 1080p/30 max, yuv420p, and faststart. A duration-aware VBV ceiling keeps
 * pathological high-motion clips under the upload cap, but CRF remains the
 * primary rate control so low-motion screen recordings can land far below the
 * old target-bitrate output. If the HandBrake-like profile is still too large,
 * we retry progressively smaller compact profiles.
 *
 * Out-of-scope here:
 *  - Raising Builder.io's per-file limit (server-side, separate work).
 *  - Uploading via multipart instead of one POST (requires Builder.io API
 *    changes + server-side reassembly).
 *  - Returning 413 instead of 500 from upload (server-side, separate work).
 *
 * Threshold: skip compression under 24 MB so the small-clip happy path pays no
 * extra cost. The binding constraint is Builder's ~32 MB Cloud Run edge cap
 * (see above), so we target ~18 MB and hard-stop at 30 MB — a blob that clears
 * the client check is then comfortably under both Builder's ~32 MB edge and the
 * server's SQL-staging cap.
 */

import {
  loadFfmpeg,
  removeFfmpegLogListener,
  resetFfmpegInstance,
} from "./ffmpeg-export";

export const COMPRESSION_ENABLED = false;

export const COMPRESS_THRESHOLD_BYTES = 24 * 1024 * 1024;
export const AUDIO_LOUDNESS_FILTER = "loudnorm=I=-16:TP=-1.5:LRA=11";

export { MAX_UPLOAD_BYTES } from "@shared/upload-limits";

const TARGET_COMPRESSED_BYTES = 18 * 1024 * 1024;

const MIN_VIDEO_RATE_LIMIT_KBPS = 350;
const RATE_LIMIT_OVERHEAD_KBPS = 64;

export interface CompressionProfile {
  label: string;
  maxLongSide: number;
  maxShortSide: number;
  frameRate: number;
  crf: number;
  x264Preset: "fast";
  audioBitrateKbps: number;
  maxVideoRateKbps: number;
}

const HANDBRAKE_FAST_1080P30_PROFILE: CompressionProfile = {
  label: "HandBrake Fast 1080p30",
  maxLongSide: 1920,
  maxShortSide: 1080,
  frameRate: 30,
  crf: 22,
  x264Preset: "fast",
  audioBitrateKbps: 160,
  maxVideoRateKbps: 6000,
};

const COMPRESSION_PROFILES: CompressionProfile[] = [
  HANDBRAKE_FAST_1080P30_PROFILE,
  {
    label: "1080p compact",
    maxLongSide: 1920,
    maxShortSide: 1080,
    frameRate: 30,
    crf: 24,
    x264Preset: "fast",
    audioBitrateKbps: 128,
    maxVideoRateKbps: 4000,
  },
  {
    label: "720p compact",
    maxLongSide: 1280,
    maxShortSide: 720,
    frameRate: 30,
    crf: 26,
    x264Preset: "fast",
    audioBitrateKbps: 96,
    maxVideoRateKbps: 2200,
  },
  {
    label: "540p small",
    maxLongSide: 960,
    maxShortSide: 540,
    frameRate: 30,
    crf: 28,
    x264Preset: "fast",
    audioBitrateKbps: 80,
    maxVideoRateKbps: 1200,
  },
];

const COMPRESSION_TIMEOUT_MS = 5 * 60 * 1000;

const STDERR_TAIL_LINES = 50;

export interface CompressionProgress {
  stage: "loading-ffmpeg" | "preparing" | "encoding" | "finalizing";
  progress: number | null;
  message?: string;
}

export interface CompressionResult {
  blob: Blob;
  compressed: boolean;
  originalBytes: number;
  compressedBytes: number;
  ratio: number;
  elapsedMs: number;
  outputMimeType: string;
}

export interface CompressOptions {
  thresholdBytes?: number;
  onProgress?: (p: CompressionProgress) => void;
  width?: number;
  height?: number;
  durationMs?: number;
  signal?: AbortSignal;
}

function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export function pickCompressedDimensions(
  width?: number,
  height?: number,
  profile: CompressionProfile = HANDBRAKE_FAST_1080P30_PROFILE,
): { width: number; height: number } | null {
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  const scale = Math.min(
    1,
    profile.maxLongSide / longSide,
    profile.maxShortSide / shortSide,
  );
  if (scale >= 1) return { width, height };
  return {
    width: evenDimension(width * scale),
    height: evenDimension(height * scale),
  };
}

function pickScaleArgs(
  width: number | undefined,
  height: number | undefined,
  profile: CompressionProfile,
): string[] {
  const filters = pickVideoFilters(width, height, profile);
  return filters.length > 0 ? ["-vf", filters.join(",")] : [];
}

export function pickVideoRateLimit(
  durationMs?: number,
  profile: CompressionProfile = HANDBRAKE_FAST_1080P30_PROFILE,
): {
  maxrate: string;
  bufsize: string;
} {
  function formatKbps(kbps: number): string {
    if (kbps >= 1000) {
      const mbps = Math.round(kbps / 100) / 10;
      return `${mbps.toFixed(1).replace(/\.0$/, "")}M`;
    }
    return `${Math.round(kbps)}k`;
  }

  let targetKbps = profile.maxVideoRateKbps;
  if (typeof durationMs === "number" && durationMs > 1000) {
    const seconds = durationMs / 1000;
    const totalBudgetKbps = (TARGET_COMPRESSED_BYTES * 8) / seconds / 1000;
    const videoBudgetKbps =
      totalBudgetKbps - profile.audioBitrateKbps - RATE_LIMIT_OVERHEAD_KBPS;
    if (Number.isFinite(videoBudgetKbps)) {
      targetKbps = Math.min(
        profile.maxVideoRateKbps,
        Math.max(MIN_VIDEO_RATE_LIMIT_KBPS, videoBudgetKbps),
      );
    }
  }

  return {
    maxrate: formatKbps(targetKbps),
    bufsize: formatKbps(targetKbps * 2),
  };
}

export function pickVideoFilters(
  width?: number,
  height?: number,
  profile: CompressionProfile = HANDBRAKE_FAST_1080P30_PROFILE,
): string[] {
  const filters: string[] = [];
  const dimensions = pickCompressedDimensions(width, height, profile);
  if (
    dimensions &&
    (dimensions.width !== Math.round(width ?? 0) ||
      dimensions.height !== Math.round(height ?? 0))
  ) {
    filters.push(
      `scale=${dimensions.width}:${dimensions.height}:flags=lanczos`,
    );
  }
  return filters;
}

export function pickAudioFilters(): string[] {
  return ["-af", AUDIO_LOUDNESS_FILTER];
}

function pickEncodeArgs(
  width: number | undefined,
  height: number | undefined,
  durationMs: number | undefined,
  profile: CompressionProfile,
): { args: string[]; outputName: string; outputMimeType: string } {
  const { maxrate, bufsize } = pickVideoRateLimit(durationMs, profile);
  const scaleArgs = pickScaleArgs(width, height, profile);

  return {
    outputName: "compressed.mp4",
    outputMimeType: "video/mp4",
    args: [
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      ...scaleArgs,
      ...pickAudioFilters(),
      "-fpsmax",
      String(profile.frameRate),
      "-c:v",
      "libx264",
      "-preset",
      profile.x264Preset,
      "-profile:v",
      "main",
      "-level:v",
      "4.0",
      "-crf",
      String(profile.crf),
      "-maxrate",
      maxrate,
      "-bufsize",
      bufsize,
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      `${profile.audioBitrateKbps}k`,
      "-ac",
      "2",
      "-movflags",
      "+faststart",
    ],
  };
}

export async function compressBlobIfTooLarge(
  input: Blob,
  inputMimeType: string,
  opts: CompressOptions & {
    onError?: (err: {
      message: string;
      stderrTail: string[];
      elapsedMs: number;
    }) => void;
  } = {},
): Promise<CompressionResult> {
  const startedAt = performance.now();
  const threshold = opts.thresholdBytes ?? COMPRESS_THRESHOLD_BYTES;
  const originalBytes = input.size;

  if (!COMPRESSION_ENABLED || originalBytes <= threshold) {
    return {
      blob: input,
      compressed: false,
      originalBytes,
      compressedBytes: originalBytes,
      ratio: 1,
      elapsedMs: 0,
      outputMimeType: inputMimeType,
    };
  }

  opts.onProgress?.({ stage: "loading-ffmpeg", progress: null });

  const stderrTail: string[] = [];
  const onLog = (msg: string) => {
    stderrTail.push(msg);
    if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
  };

  let ffmpeg: any;
  try {
    ffmpeg = await loadFfmpeg(onLog);
  } catch (err) {
    removeFfmpegLogListener(onLog);
    const elapsedMs = Math.round(performance.now() - startedAt);
    opts.onError?.({
      message:
        err instanceof Error
          ? `ffmpeg.wasm load failed: ${err.message}`
          : "ffmpeg.wasm load failed",
      stderrTail,
      elapsedMs,
    });
    return {
      blob: input,
      compressed: false,
      originalBytes,
      compressedBytes: originalBytes,
      ratio: 1,
      elapsedMs,
      outputMimeType: inputMimeType,
    };
  }

  const inputName = /mp4|quicktime/i.test(inputMimeType)
    ? "input.mp4"
    : "input.webm";

  const handleProgress = ({ progress }: { progress: number }) => {
    const safeProgress = Math.max(0, Math.min(1, progress));
    opts.onProgress?.({
      stage: "encoding",
      progress: safeProgress,
    });
  };
  ffmpeg.on("progress", handleProgress);

  const internalAbort = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    internalAbort.abort(new Error("Compression timed out after 5 minutes"));
  }, COMPRESSION_TIMEOUT_MS);
  let externalAbortHandler: (() => void) | null = null;
  if (opts.signal) {
    if (opts.signal.aborted) {
      internalAbort.abort(opts.signal.reason ?? new Error("Aborted"));
    } else {
      externalAbortHandler = () => {
        internalAbort.abort(opts.signal!.reason ?? new Error("Aborted"));
      };
      opts.signal.addEventListener("abort", externalAbortHandler);
    }
  }

  try {
    opts.onProgress?.({ stage: "preparing", progress: null });

    const { fetchFile } = await import("@ffmpeg/util");
    await ffmpeg.writeFile(inputName, await fetchFile(input), {
      signal: internalAbort.signal,
    });

    let best: {
      blob: Blob;
      compressedBytes: number;
      outputMimeType: string;
    } | null = null;
    const encodeFailures: string[] = [];

    for (let index = 0; index < COMPRESSION_PROFILES.length; index += 1) {
      const profile = COMPRESSION_PROFILES[index];
      const { args, outputName, outputMimeType } = pickEncodeArgs(
        opts.width,
        opts.height,
        opts.durationMs,
        profile,
      );

      opts.onProgress?.({
        stage: "encoding",
        progress: 0,
        message: profile.label,
      });

      const ffArgs = ["-i", inputName, ...args, outputName];
      const exitCode = await ffmpeg.exec(ffArgs, undefined, {
        signal: internalAbort.signal,
      });

      if (exitCode !== 0) {
        encodeFailures.push(
          `${profile.label}: ffmpeg exited with code ${exitCode}`,
        );
        try {
          await ffmpeg.deleteFile(outputName);
        } catch {
          // ignore
        }
        continue;
      }

      const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
      const blob = new Blob([data as BlobPart], { type: outputMimeType });
      const compressedBytes = blob.size;

      try {
        await ffmpeg.deleteFile(outputName);
      } catch {
        // ignore
      }

      if (compressedBytes < originalBytes) {
        if (!best || compressedBytes < best.compressedBytes) {
          best = { blob, compressedBytes, outputMimeType };
        }
        if (compressedBytes <= TARGET_COMPRESSED_BYTES) {
          break;
        }
      }
    }

    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      // ignore
    }

    const elapsedMs = Math.round(performance.now() - startedAt);
    if (best) {
      opts.onProgress?.({ stage: "finalizing", progress: 1 });
      return {
        blob: best.blob,
        compressed: true,
        originalBytes,
        compressedBytes: best.compressedBytes,
        ratio: originalBytes > 0 ? best.compressedBytes / originalBytes : 1,
        elapsedMs,
        outputMimeType: best.outputMimeType,
      };
    }

    opts.onError?.({
      message:
        encodeFailures.length > 0
          ? `ffmpeg compression did not produce a smaller file; profile failures: ${encodeFailures.join("; ")}`
          : "ffmpeg compression did not produce a smaller file",
      stderrTail,
      elapsedMs,
    });
    return {
      blob: input,
      compressed: false,
      originalBytes,
      compressedBytes: originalBytes,
      ratio: 1,
      elapsedMs,
      outputMimeType: inputMimeType,
    };
  } catch (err) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "unknown error";
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      // ignore
    }
    try {
      await ffmpeg.deleteFile("compressed.mp4");
    } catch {
      // ignore
    }
    const externallyAborted = opts.signal?.aborted ?? false;
    const anyAborted = internalAbort.signal.aborted || externallyAborted;
    if (anyAborted) {
      try {
        ffmpeg.terminate();
      } catch {
        // ignore — terminate is best effort.
      }
      resetFfmpegInstance();
      if (externallyAborted) {
        const cancelErr = new Error("Compression cancelled");
        cancelErr.name = "AbortError";
        throw cancelErr;
      }
      if (timedOut) {
        const timeoutErr = new Error("Compression timed out after 5 minutes");
        timeoutErr.name = "TimeoutError";
        throw timeoutErr;
      }
      throw err instanceof Error ? err : new Error(message);
    }
    opts.onError?.({
      message,
      stderrTail,
      elapsedMs,
    });
    return {
      blob: input,
      compressed: false,
      originalBytes,
      compressedBytes: originalBytes,
      ratio: 1,
      elapsedMs,
      outputMimeType: inputMimeType,
    };
  } finally {
    try {
      clearTimeout(timeoutId);
    } catch {
      // ignore
    }
    try {
      if (externalAbortHandler && opts.signal) {
        opts.signal.removeEventListener("abort", externalAbortHandler);
      }
    } catch {
      // ignore
    }
    try {
      ffmpeg.off("progress", handleProgress);
    } catch {
      // ignore
    }
    try {
      removeFfmpegLogListener(onLog);
    } catch {
      // ignore
    }
  }
}

export function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
}
