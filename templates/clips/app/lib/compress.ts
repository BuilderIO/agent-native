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
 * Threshold: skip compression under 24 MB so the small-clip happy path pays no
 * extra cost. The binding constraint is Builder's ~32 MB Cloud Run edge cap
 * (see above), so we target ~22 MB and hard-stop at 30 MB — a blob that clears
 * the client check is then comfortably under both Builder's ~32 MB edge and the
 * server's SQL-staging cap.
 */

import {
  loadFfmpeg,
  removeFfmpegLogListener,
  resetFfmpegInstance,
} from "./ffmpeg-export";

/** Start compressing at 24 MB. Below this, the upload clears Builder's ~32 MB
 * Cloud Run edge cap and we don't pay for ffmpeg.wasm load + transcode. */
export const COMPRESS_THRESHOLD_BYTES = 24 * 1024 * 1024;

/** Clips' effective per-recording upload limit. Builder's upload endpoint is
 * fronted by a Gen-2 Cloud Function (Cloud Run) with a hard ~32 MB inbound
 * request cap that the app config can't raise, so we hard-stop just under it.
 * Anything larger needs an S3-compatible provider or a resumable Builder flow
 * (separate work) — failing fast here beats an opaque Builder 500. */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/** Preferred compressed output size. The hard cap above leaves room for
 * encoder variance and audio tracks that were copied rather than re-encoded. */
const TARGET_COMPRESSED_BYTES = 22 * 1024 * 1024;

const ASSUMED_AUDIO_BITRATE_BPS = 96_000;
const MIN_VIDEO_BITRATE_BPS = 450_000;

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
  /** Override the threshold (mostly for testing). Defaults to 45 MB. */
  thresholdBytes?: number;
  /** Optional progress callback for UI plumbing. */
  onProgress?: (p: CompressionProgress) => void;
  /** Detected source dimensions, if known — picks the bitrate ladder. */
  width?: number;
  height?: number;
  /** Recording duration, used to keep multi-minute clips under the upload cap. */
  durationMs?: number;
  /** External abort signal (e.g. the user navigated away). Combined with
   * the internal 5-minute timeout. */
  signal?: AbortSignal;
}

/**
 * Pick a target video bitrate based on the source's larger dimension.
 *
 * The numbers start with a resolution cap for screen-capture style footage
 * (high-detail UI, low motion), then tighten by duration so multi-minute clips
 * land near TARGET_COMPRESSED_BYTES instead of blasting past the server staging
 * cap.
 */
export function pickVideoBitrate(
  width?: number,
  height?: number,
  durationMs?: number,
): {
  bitrate: string;
  maxrate: string;
  bufsize: string;
} {
  function formatBitrate(bps: number): string {
    const mbps = Math.max(0.1, Math.round(bps / 100_000) / 10);
    return `${mbps.toFixed(1).replace(/\.0$/, "")}M`;
  }

  const longSide = Math.max(width ?? 0, height ?? 0);
  let resolutionCapBps: number;
  if (longSide >= 1080) {
    resolutionCapBps = 3_000_000;
  } else if (longSide >= 720) {
    resolutionCapBps = 2_000_000;
  } else if (longSide > 0) {
    resolutionCapBps = 1_200_000;
  } else {
    // Unknown dimensions — keep enough detail for UI text without assuming a
    // giant 4K recording.
    resolutionCapBps = 3_000_000;
  }

  let targetBps = resolutionCapBps;
  if (typeof durationMs === "number" && durationMs > 1000) {
    const seconds = durationMs / 1000;
    const totalBudgetBps = (TARGET_COMPRESSED_BYTES * 8) / seconds;
    const videoBudgetBps = totalBudgetBps - ASSUMED_AUDIO_BITRATE_BPS;
    if (Number.isFinite(videoBudgetBps) && videoBudgetBps > 0) {
      targetBps = Math.min(
        resolutionCapBps,
        Math.max(MIN_VIDEO_BITRATE_BPS, videoBudgetBps),
      );
    }
  }

  return {
    bitrate: formatBitrate(targetBps),
    maxrate: formatBitrate(targetBps * 1.25),
    bufsize: formatBitrate(targetBps * 2),
  };
}

/** Pick container + codecs to match the source. WebM keeps VP8/9 + Opus,
 * MP4 keeps H.264 + AAC. Audio is always copy — re-encoding adds latency
 * and compresses very little compared to video. */
function pickEncodeArgs(
  inputMimeType: string,
  width: number | undefined,
  height: number | undefined,
  durationMs: number | undefined,
): { args: string[]; outputName: string; outputMimeType: string } {
  const isMp4 = /mp4|quicktime/i.test(inputMimeType);
  const { bitrate, maxrate, bufsize } = pickVideoBitrate(
    width,
    height,
    durationMs,
  );

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
    opts.durationMs,
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
  // passed in their own signal we forward its abort too. We track whether
  // the timeout has fired separately from the external signal so the catch
  // path below can tell timeout vs external-cancel vs ffmpeg-crash apart
  // and throw a clearly-named error each caller can branch on.
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
    // Best-effort cleanup so a failed run doesn't leak input data inside
    // the wasm FS for the lifetime of the tab.
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      // ignore
    }
    // Any abort — internal 5-minute timeout OR external cancel — leaves
    // the ffmpeg.wasm worker in an undefined state per ffmpeg.wasm docs:
    // once an exec/writeFile is aborted, subsequent operations on the same
    // instance silently misbehave (corrupt outputs, stuck progress, etc.)
    // until the tab reloads. So treat both as requiring `terminate()` +
    // `resetFfmpegInstance()` — checking only `opts.signal?.aborted` would
    // skip cleanup on the timeout path and poison the shared instance for
    // every subsequent compress / export op in this tab.
    const externallyAborted = opts.signal?.aborted ?? false;
    const anyAborted = internalAbort.signal.aborted || externallyAborted;
    if (anyAborted) {
      // Terminate the wasm worker — once an exec/writeFile is aborted the
      // instance state is undefined per ffmpeg.wasm docs, so the next call
      // must re-load. resetFfmpegInstance() drops the cached promise.
      try {
        ffmpeg.terminate();
      } catch {
        // ignore — terminate is best effort.
      }
      resetFfmpegInstance();
      // Throw with a name the caller can branch on so the UI can
      // distinguish "user cancelled" from "compression timed out" from
      // "ffmpeg crashed" without string-matching error messages.
      //  - External cancel: AbortError, "Compression cancelled"
      //  - Internal timeout: TimeoutError, "Compression timed out…"
      //  - Ffmpeg crash that happened during/after an unrelated abort:
      //    re-throw original (rare — would mean the worker died on its
      //    own and an abort fired in the same tick).
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
      // Internal abort fired but neither timeout nor external — should be
      // unreachable in practice; surface the original.
      throw err instanceof Error ? err : new Error(message);
    }
    // Genuine ffmpeg failure (encoder error, OOM, unsupported source, …):
    // capture diagnostics for Sentry and fall through to the safe-upload
    // fallback so the user's recording still has a chance.
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
    // Each cleanup is wrapped independently — a throw from one (e.g.
    // `removeEventListener` after the signal was already torn down, or
    // `ffmpeg.off` on an instance whose worker was just terminated)
    // must NOT prevent the others from running, or stale listeners pile
    // up on the shared ffmpeg instance and cause memory leaks across
    // recordings. Don't collapse this to a single `try { … }` — that
    // defeats the purpose.
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

/** Format a byte count as "12.3mb" for user-facing error strings. Lowercase
 * and zero-padded to 1 decimal so the message reads naturally. */
export function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
}
