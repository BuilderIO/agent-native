/**
 * Browser-side video compression for clips that would exceed the upload
 * provider's per-file limit.
 *
 * The motivating bug: Builder.io's `/api/v1/upload` caps each file at 100 MB
 * (`fileUpload({ limits: { fileSize: 100 * 1024 * 1024 } })` plus a
 * `express.raw({ limit: '200mb' })` body limit). When the assembled recording
 * blob exceeds that, the streaming upload to GCS errors mid-write and the
 * client sees `Builder.io upload failed (500): Internal Error` — a confusing
 * dead-end with no remediation. Saee hit this on her second clip.
 *
 * Strategy: ride the existing ffmpeg.wasm install (we already lazy-load it
 * for export / GIF / stitch in `ffmpeg-export.ts`). Re-encode video at a
 * resolution-aware target bitrate, copy audio (Opus stays Opus inside WebM,
 * AAC stays AAC inside MP4), bind the whole thing to an AbortController so
 * it can't hang a tab forever, and return a smaller blob.
 *
 * Out-of-scope here:
 *  - Raising Builder.io's per-file limit (server-side, separate work).
 *  - Uploading via multipart instead of one POST (requires Builder.io API
 *    changes + server-side reassembly).
 *  - Returning 413 instead of 500 from upload (server-side, separate work).
 *
 * Threshold: skip compression entirely under 80 MB so the small-clip happy
 * path pays no extra cost. Target ratio aims for ~30–60% of original on
 * 1080p screen capture; the result is verified against the 100 MB hard cap
 * before we attempt the upload, so a still-too-large clip surfaces a clean
 * user-facing error rather than the opaque 500.
 */

import { loadFfmpeg, removeFfmpegLogListener } from "./ffmpeg-export";

/** Start compressing at 80 MB. Below this, the upload fits and we don't pay
 * for ffmpeg.wasm load + transcode. */
export const COMPRESS_THRESHOLD_BYTES = 80 * 1024 * 1024;

/** Builder.io's hard per-file upload limit. We reject at the client BEFORE
 * issuing the upload if the compressed result still exceeds this — better
 * than letting it 500 mid-stream. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Hard cap on total compression time. ffmpeg.wasm is single-threaded WASM
 * and can wedge on certain inputs; we'd rather give the user a clear error
 * after 5 minutes than let them stare at a spinner for an hour. */
const COMPRESSION_TIMEOUT_MS = 5 * 60 * 1000;

/** Number of stderr lines retained for crash diagnostics. */
const STDERR_TAIL_LINES = 50;

export interface CompressionProgress {
  stage: "loading-ffmpeg" | "preparing" | "encoding" | "finalizing";
  /** 0..1, or null when indeterminate. */
  progress: number | null;
  message?: string;
}

export interface CompressionResult {
  /** Output blob. May be the SAME ref as `input` when below threshold. */
  blob: Blob;
  /** True when we actually re-encoded (vs. passed the input through). */
  compressed: boolean;
  originalBytes: number;
  compressedBytes: number;
  /** `compressedBytes / originalBytes`. 1 when not compressed. */
  ratio: number;
  /** Wall-clock ms spent in this function. ~0 when below threshold. */
  elapsedMs: number;
  /** ffmpeg's chosen output mime type (matches container). */
  outputMimeType: string;
}

export interface CompressOptions {
  /** Override the threshold (mostly for testing). Defaults to 80 MB. */
  thresholdBytes?: number;
  /** Optional progress callback for UI plumbing. */
  onProgress?: (p: CompressionProgress) => void;
  /** Detected source dimensions, if known — picks the bitrate ladder. */
  width?: number;
  height?: number;
  /** External abort signal (e.g. the user navigated away). Combined with
   * the internal 5-minute timeout. */
  signal?: AbortSignal;
}

/**
 * Pick a target video bitrate based on the source's larger dimension.
 *
 * The numbers map to what YouTube / Vimeo recommend for screen-capture style
 * footage (high-detail UI, low motion):
 *   - 1080p+ → 8 Mbps
 *   - 720p   → 6 Mbps
 *   - 480p   → 3 Mbps
 *   - other  → 8 Mbps as a safe upper bound (we don't want to under-bitrate
 *              an unknown-dimensions clip and produce mush)
 */
function pickVideoBitrate(
  width?: number,
  height?: number,
): {
  bitrate: string;
  maxrate: string;
  bufsize: string;
} {
  const longSide = Math.max(width ?? 0, height ?? 0);
  if (longSide >= 1080) {
    return { bitrate: "8M", maxrate: "10M", bufsize: "16M" };
  }
  if (longSide >= 720) {
    return { bitrate: "6M", maxrate: "8M", bufsize: "12M" };
  }
  if (longSide > 0 && longSide < 720) {
    return { bitrate: "3M", maxrate: "4M", bufsize: "6M" };
  }
  // Unknown — be conservative on the high side. Worse than ideal compression
  // is still much better than a failed upload.
  return { bitrate: "8M", maxrate: "10M", bufsize: "16M" };
}

/** Pick container + codecs to match the source. WebM keeps VP8/9 + Opus,
 * MP4 keeps H.264 + AAC. Audio is always copy — re-encoding adds latency
 * and compresses very little compared to video. */
function pickEncodeArgs(
  inputMimeType: string,
  width: number | undefined,
  height: number | undefined,
): { args: string[]; outputName: string; outputMimeType: string } {
  const isMp4 = /mp4|quicktime/i.test(inputMimeType);
  const { bitrate, maxrate, bufsize } = pickVideoBitrate(width, height);

  if (isMp4) {
    return {
      outputName: "compressed.mp4",
      outputMimeType: "video/mp4",
      args: [
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-b:v",
        bitrate,
        "-maxrate",
        maxrate,
        "-bufsize",
        bufsize,
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        // moov before mdat so the result streams cleanly via HTTP range
        // requests (mirrors the existing pure-TS faststart pass on the
        // server, but cheaper to do here while we already have the
        // transcoded mp4 in hand).
        "-movflags",
        "+faststart",
      ],
    };
  }

  // WebM / VP8 — fastest VP8 encode available; VP9 is too slow for the
  // 5-minute wall-clock budget on a typical laptop. Audio (Opus) is left
  // alone via copy. WebM has no faststart equivalent — the cluster index
  // is already at the start by spec.
  return {
    outputName: "compressed.webm",
    outputMimeType: "video/webm",
    args: [
      "-c:v",
      "libvpx",
      "-deadline",
      "realtime",
      "-cpu-used",
      "5",
      "-b:v",
      bitrate,
      "-maxrate",
      maxrate,
      "-bufsize",
      bufsize,
      "-c:a",
      "copy",
    ],
  };
}

/**
 * Compress `input` if it's larger than the threshold; otherwise return it
 * untouched.
 *
 * Errors during compression are NOT thrown — we return a result with
 * `compressed: false` and the original blob, so the caller can still attempt
 * to upload (and let Builder.io's 500 / our hard-cap check surface to Sentry
 * with the original-bytes context). The optional `onError` callback receives
 * a structured failure record for Sentry tagging.
 */
export async function compressBlobIfTooLarge(
  input: Blob,
  inputMimeType: string,
  opts: CompressOptions & {
    /** Called with diagnostic info if compression is attempted but fails. */
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

  if (originalBytes <= threshold) {
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

  // Capture a tail of ffmpeg stderr so a crash later in this function can be
  // reported to Sentry with enough context to tell whether the source was
  // unsupported, OOMed, etc.
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

  const { args, outputName, outputMimeType } = pickEncodeArgs(
    inputMimeType,
    opts.width,
    opts.height,
  );

  // Pick a container-appropriate input filename — ffmpeg.wasm uses the
  // extension to detect the demuxer. Webm vs. mp4 matters for short-circuit
  // probe behaviour inside libavformat.
  const inputName = /mp4|quicktime/i.test(inputMimeType)
    ? "input.mp4"
    : "input.webm";

  // Plumb encoder progress events back to the UI. ffmpeg.wasm reports the
  // progress as 0..1 over the duration of the input.
  const handleProgress = ({ progress }: { progress: number }) => {
    opts.onProgress?.({
      stage: "encoding",
      progress: Math.max(0, Math.min(1, progress)),
    });
  };
  ffmpeg.on("progress", handleProgress);

  // Internal AbortController owns the 5-minute hard cap; if the caller
  // passed in their own signal we forward its abort too.
  const internalAbort = new AbortController();
  const timeoutId = setTimeout(
    () => internalAbort.abort(new Error("Compression timed out after 5 min")),
    COMPRESSION_TIMEOUT_MS,
  );
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

    opts.onProgress?.({ stage: "encoding", progress: 0 });

    const ffArgs = ["-i", inputName, ...args, outputName];
    const exitCode = await ffmpeg.exec(ffArgs, undefined, {
      signal: internalAbort.signal,
    });

    if (exitCode !== 0) {
      throw new Error(
        `ffmpeg exited with code ${exitCode} (likely encoder error or timeout)`,
      );
    }

    opts.onProgress?.({ stage: "finalizing", progress: 1 });

    const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
    const blob = new Blob([data as BlobPart], { type: outputMimeType });
    const compressedBytes = blob.size;

    // Best-effort cleanup so we don't pile up files in WASM's virtual FS
    // across multiple recordings in the same tab.
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      // ignore
    }
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {
      // ignore
    }

    const elapsedMs = Math.round(performance.now() - startedAt);
    return {
      blob,
      compressed: true,
      originalBytes,
      compressedBytes,
      ratio: originalBytes > 0 ? compressedBytes / originalBytes : 1,
      elapsedMs,
      outputMimeType,
    };
  } catch (err) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const message =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    opts.onError?.({
      message,
      stderrTail,
      elapsedMs,
    });
    // Best-effort cleanup so a failed run doesn't leak input data inside
    // the wasm FS for the lifetime of the tab.
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      // ignore
    }
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
    clearTimeout(timeoutId);
    if (externalAbortHandler && opts.signal) {
      opts.signal.removeEventListener("abort", externalAbortHandler);
    }
    ffmpeg.off("progress", handleProgress);
    removeFfmpegLogListener(onLog);
  }
}

/** Format a byte count as "12.3mb" for user-facing error strings. Lowercase
 * and zero-padded to 1 decimal so the message reads naturally. */
export function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
}
