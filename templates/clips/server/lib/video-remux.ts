/**
 * Make recorded video seekable so browsers can start playback immediately and
 * scrub without re-buffering the whole file.
 *
 * Two problems this fixes, both produced by `MediaRecorder` output:
 *   - MP4: the `moov` metadata atom is written AFTER `mdat`, so a player must
 *     download the entire file before it can start / seek. We relocate it with
 *     the pure-TypeScript {@link applyFaststart} (no ffmpeg needed).
 *   - WebM: MediaRecorder emits a "live" stream with no Cues (seek index) and an
 *     unknown Segment duration, so Chrome refuses to honor `currentTime = X`
 *     seeks and has to scan/download to move around. A cheap `ffmpeg -c copy`
 *     remux rewrites the container with a SeekHead + Cues index and a real
 *     duration — no re-encode, so it's fast and lossless.
 *
 * Everything here is best-effort: on any failure (ffmpeg missing, bad input,
 * timeout) we return the ORIGINAL bytes with `changed: false`, so callers never
 * regress relative to uploading the raw recording.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyFaststart, hasPlayableMp4Metadata } from "./faststart.js";

const REMUX_TIMEOUT_MS = 120_000;
const STDERR_LIMIT = 16 * 1024;
const MAX_CONCURRENT_REMUXES = 2;
// EBML magic that every valid Matroska/WebM file starts with.
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

const requireFromThisFile = createRequire(import.meta.url);
let cachedFfmpegStaticPath: string | null | undefined;
let activeRemuxes = 0;
const remuxWaiters: Array<() => void> = [];

export type VideoFormat = "webm" | "mp4";

export interface SeekableResult {
  /** The seekable bytes, or the original bytes when nothing changed. */
  bytes: Uint8Array;
  /** True when the returned bytes differ from the input. */
  changed: boolean;
}

/**
 * Build the ffmpeg command used by the explicit sparse-timeline repair path.
 * The `fps` filter emits a constant frame rate, duplicating the most recent
 * decoded frame across timestamp gaps while audio is mapped through and
 * transcoded independently. H.264/AAC plus faststart gives mobile browsers a
 * broadly playable result.
 */
export function timelineNormalizationFfmpegArgs(
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-fflags",
    "+genpts",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    "fps=30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    outputPath,
  ];
}

export function resolveFfmpegCommand(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  return resolveFfmpegStaticPath() ?? "ffmpeg";
}

function ffmpegCommand(): string {
  return resolveFfmpegCommand();
}

function resolveFfmpegStaticPath(): string | null {
  if (cachedFfmpegStaticPath !== undefined) return cachedFfmpegStaticPath;
  try {
    const resolved = requireFromThisFile("ffmpeg-static");
    cachedFfmpegStaticPath =
      typeof resolved === "string" && resolved && existsSync(resolved)
        ? resolved
        : null;
  } catch {
    cachedFfmpegStaticPath = null;
  }
  return cachedFfmpegStaticPath;
}

/** Whether a server-side ffmpeg binary is resolvable. */
export function isFfmpegAvailable(): boolean {
  return (
    spawnSync(resolveFfmpegCommand(), ["-version"], {
      stdio: "ignore",
      timeout: 2_000,
    }).status === 0
  );
}

function startsWithMagic(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.byteLength < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

export async function runFfmpeg(
  args: string[],
  options: { timeoutMs?: number; label?: string } = {},
): Promise<void> {
  const { timeoutMs = REMUX_TIMEOUT_MS, label = "remux" } = options;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegCommand(), args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`ffmpeg ${label} timed out\n${stderr}`));
    }, timeoutMs);

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_LIMIT);
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`${err.message}\n${stderr}`));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}\n${stderr}`));
    });
  });
}

/**
 * Run ffmpeg and report how far through it is.
 *
 * ffmpeg will describe its own progress on a pipe if asked (`-progress`), in
 * `key=value` lines, of which `out_time_us` is the one worth reading: how much
 * of the output has been written. Against a known duration that is a
 * percentage — and a re-encode of a long clip is several minutes of a person
 * wondering whether anything is happening.
 *
 * The fraction is monotonic and capped just below 1: the last frames, the
 * container being finalised and the upload all happen after ffmpeg stops
 * counting, and a bar that sits at 100% for thirty seconds is worse than one
 * that sits at 99%.
 */
export async function runFfmpegWithProgress(
  args: string[],
  options: {
    timeoutMs?: number;
    label?: string;
    totalMs: number;
    onProgress: (fraction: number) => void;
  },
): Promise<void> {
  const { timeoutMs = REMUX_TIMEOUT_MS, label = "remux", totalMs } = options;
  const withProgress = [
    args[0],
    "-progress",
    "pipe:1",
    "-nostats",
    ...args.slice(1),
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegCommand(), withProgress, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    let highest = 0;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`ffmpeg ${label} timed out\n${stderr}`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^out_time_us=(\d+)/.exec(line.trim());
        if (!match || !(totalMs > 0)) continue;
        const fraction = Number(match[1]) / 1000 / totalMs;
        if (!Number.isFinite(fraction)) continue;
        const next = Math.min(0.99, Math.max(highest, fraction));
        if (next > highest) {
          highest = next;
          options.onProgress(next);
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_LIMIT);
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`${err.message}\n${stderr}`));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}\n${stderr}`));
    });
  });
}

const PROBE_TIMEOUT_MS = 20_000;
// Demuxer stream listing happens at container-open time regardless of how
// much we ask ffmpeg to process, so bounding the probe to a fraction of a
// second of stream-copy keeps this cheap even for multi-gigabyte recordings.
const PROBE_DURATION_SECONDS = "0.1";

/**
 * Best-effort probe for whether a media file has at least one audio stream.
 * Returns `null` (unknown) when ffmpeg is unavailable or the probe itself
 * fails — callers should treat `null` as "couldn't verify" and skip any
 * check that depends on the answer, never as "no audio".
 */
export async function probeHasAudioStream(
  mediaBytes: Uint8Array,
  extension: "webm" | "mp4",
): Promise<boolean | null> {
  if (mediaBytes.byteLength === 0) return null;
  if (!isFfmpegAvailable()) return null;

  const dir = await mkdtemp(join(tmpdir(), "clips-audio-probe-"));
  const inputPath = join(dir, `input.${extension}`);

  try {
    await writeFile(inputPath, mediaBytes);
    const stderr = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        ffmpegCommand(),
        [
          "-hide_banner",
          "-nostdin",
          "-i",
          inputPath,
          "-t",
          PROBE_DURATION_SECONDS,
          "-map",
          "0",
          "-c",
          "copy",
          "-f",
          "null",
          "-",
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let buf = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`ffmpeg audio probe timed out\n${buf}`));
      }, PROBE_TIMEOUT_MS);
      child.stderr?.on("data", (chunk: Buffer) => {
        // Keep the HEAD of stderr, not the tail: ffmpeg prints the input
        // stream listing (what we grep for below) at container-open time,
        // before any per-frame warnings. Unlike `runFfmpeg`'s error-diagnostic
        // tail-window, truncating from the end here risks scrolling the
        // `Stream #...: Audio:` line out of the buffer on a warning-heavy input.
        if (buf.length < STDERR_LIMIT) {
          buf += chunk.toString("utf8");
        }
      });
      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`${err.message}\n${buf}`));
      });
      child.on("close", () => {
        // A non-zero exit is expected here for some malformed/edge inputs
        // even when the stream listing itself printed fine — this is a
        // probe, not a correctness check, so we still inspect stderr for
        // the stream listing rather than rejecting on exit code.
        clearTimeout(timeout);
        resolve(buf);
      });
    });
    // Require positive proof the demuxer actually opened the container
    // (found at least one stream of any kind) before trusting a "no audio"
    // reading — an unreadable/corrupt file (bad data, unknown format) also
    // prints no `Stream #...: Audio:` line, but that means "couldn't verify",
    // not "confirmed no audio". Only a file ffmpeg could actually demux earns
    // a definite `false`.
    if (!/Stream #\d+:\d+/i.test(stderr)) return null;
    return /Stream #\d+:\d+.*: ?Audio:/i.test(stderr);
  } catch (err) {
    console.warn("[video-remux] audio-stream probe failed, skipping check", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Read a file's duration in milliseconds, best-effort. `null` means "could not
 * tell", never "zero" — callers use this to check that a re-encode did not
 * silently truncate, and an unreadable probe must not be mistaken for a
 * truncated file.
 */
export interface ProbedMediaInfo {
  /** Real duration of the file, not what the client reported at finalize. */
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

/**
 * Read a file's header with ffmpeg and return what it actually says.
 *
 * Both values are worth having from the file rather than the row: `durationMs`
 * is client-reported at finalize and is unreliable for MediaRecorder webm, and
 * `recordings.width` defaults to 0. Anything that sizes an overlay or clips a
 * time range off those columns can be wrong in a way that silently leaves
 * pixels on show.
 */
export async function probeMediaInfo(
  mediaBytes: Uint8Array,
  extension: "webm" | "mp4",
): Promise<ProbedMediaInfo> {
  const none: ProbedMediaInfo = { durationMs: null, width: null, height: null };
  if (mediaBytes.byteLength === 0) return none;
  if (!isFfmpegAvailable()) return none;

  const dir = await mkdtemp(join(tmpdir(), "clips-media-probe-"));
  const inputPath = join(dir, `input.${extension}`);

  try {
    await writeFile(inputPath, mediaBytes);
    const stderr = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        ffmpegCommand(),
        ["-hide_banner", "-nostdin", "-i", inputPath],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let buf = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("ffmpeg media probe timed out"));
      }, PROBE_TIMEOUT_MS);
      child.stderr?.on("data", (chunk: Buffer) => {
        // The header, like the audio probe: `Duration:` and the stream table
        // are printed when the container opens, before anything else.
        if (buf.length < STDERR_LIMIT) buf += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      // Listing the input with no output is an error exit by design.
      child.on("close", () => {
        clearTimeout(timeout);
        resolve(buf);
      });
    });

    const durationMatch = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/i.exec(
      stderr,
    );
    const durationMs = durationMatch
      ? Math.round(
          (Number(durationMatch[1]) * 3600 +
            Number(durationMatch[2]) * 60 +
            Number(durationMatch[3])) *
            1000,
        )
      : null;

    // e.g. `Stream #0:0(eng): Video: vp9 ..., yuv420p, 1920x1080, ...`
    const sizeMatch = /Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})/i.exec(stderr);
    const width = sizeMatch ? Number(sizeMatch[1]) : null;
    const height = sizeMatch ? Number(sizeMatch[2]) : null;

    return {
      durationMs,
      width: width && width > 0 ? width : null,
      height: height && height > 0 ? height : null,
    };
  } catch (err) {
    console.warn("[video-remux] media probe failed, skipping check", {
      err: err instanceof Error ? err.message : String(err),
    });
    return none;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function probeDurationMs(
  mediaBytes: Uint8Array,
  extension: "webm" | "mp4",
): Promise<number | null> {
  return (await probeMediaInfo(mediaBytes, extension)).durationMs;
}

/**
 * Bound concurrent ffmpeg invocations process-wide. Every ffmpeg caller must go
 * through this, including non-remux jobs — the limit protects the box, not the
 * remux path specifically.
 */
export async function withRemuxSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeRemuxes >= MAX_CONCURRENT_REMUXES) {
    await new Promise<void>((resolve) => remuxWaiters.push(resolve));
  }
  activeRemuxes += 1;
  try {
    return await fn();
  } finally {
    activeRemuxes = Math.max(0, activeRemuxes - 1);
    remuxWaiters.shift()?.();
  }
}

/**
 * Rewrite a WebM/Matroska file with a SeekHead + Cues index and a real
 * duration via a lossless `ffmpeg -c copy` remux. Returns the original bytes
 * unchanged when ffmpeg is unavailable, the input isn't WebM, or anything
 * goes wrong.
 */
export async function remuxWebmToSeekable(
  mediaBytes: Uint8Array,
): Promise<SeekableResult> {
  const unchanged: SeekableResult = { bytes: mediaBytes, changed: false };

  if (mediaBytes.byteLength === 0) return unchanged;
  if (!startsWithMagic(mediaBytes, EBML_MAGIC)) return unchanged;
  if (!isFfmpegAvailable()) return unchanged;

  const dir = await mkdtemp(join(tmpdir(), "clips-remux-"));
  const inputPath = join(dir, "input.webm");
  const outputPath = join(dir, "output.webm");

  try {
    await writeFile(inputPath, mediaBytes);
    await withRemuxSlot(() =>
      runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        // Regenerate presentation timestamps so a live MediaRecorder stream
        // gets a coherent, seekable timeline in the remuxed output.
        "-fflags",
        "+genpts",
        "-i",
        inputPath,
        // Stream-copy every track: no re-encode, so this stays fast + lossless.
        "-map",
        "0",
        "-c",
        "copy",
        "-f",
        "webm",
        outputPath,
      ]),
    );

    const info = await stat(outputPath).catch(() => null);
    if (!info || info.size === 0) return unchanged;

    const out = new Uint8Array(await readFile(outputPath));
    // Validate the muxer actually produced a WebM before trusting it.
    if (!startsWithMagic(out, EBML_MAGIC)) return unchanged;

    return { bytes: out, changed: true };
  } catch (err) {
    console.warn("[video-remux] webm remux failed, keeping original", {
      err: err instanceof Error ? err.message : String(err),
    });
    return unchanged;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Normalize sparse or discontinuous video timestamps into a constant-frame-
 * rate, faststart MP4. This is intentionally a full transcode rather than the
 * normal lossless seekability repair: the fps filter must synthesize duplicate
 * frames through source gaps so browsers keep advancing while continuous audio
 * plays.
 *
 * Best-effort and non-destructive. Any missing ffmpeg support, decode/encode
 * failure, invalid output, or audio-track loss returns the original bytes with
 * `changed: false`; callers must not replace stored media in that case.
 */
export async function normalizeTimelineToMp4(input: {
  mediaBytes: Uint8Array;
  videoFormat: VideoFormat;
}): Promise<SeekableResult> {
  const unchanged: SeekableResult = {
    bytes: input.mediaBytes,
    changed: false,
  };

  if (input.mediaBytes.byteLength === 0) return unchanged;
  if (!isFfmpegAvailable()) return unchanged;

  const dir = await mkdtemp(join(tmpdir(), "clips-timeline-normalize-"));
  const inputPath = join(dir, `input.${input.videoFormat}`);
  const outputPath = join(dir, "output.mp4");

  try {
    const inputHasAudio = await probeHasAudioStream(
      input.mediaBytes,
      input.videoFormat,
    );
    await writeFile(inputPath, input.mediaBytes);
    await withRemuxSlot(() =>
      runFfmpeg(timelineNormalizationFfmpegArgs(inputPath, outputPath)),
    );

    const info = await stat(outputPath).catch(() => null);
    if (!info || info.size === 0) return unchanged;

    const out = new Uint8Array(await readFile(outputPath));
    if (!hasPlayableMp4Metadata(out)) return unchanged;

    if (inputHasAudio === true) {
      const outputHasAudio = await probeHasAudioStream(out, "mp4");
      if (outputHasAudio !== true) {
        console.warn(
          "[video-remux] timeline normalization dropped or could not verify audio; keeping original",
        );
        return unchanged;
      }
    }

    return { bytes: out, changed: true };
  } catch (err) {
    console.warn(
      "[video-remux] timeline normalization failed, keeping original",
      {
        err: err instanceof Error ? err.message : String(err),
      },
    );
    return unchanged;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Make an MP4 start-playable by moving its `moov` atom ahead of `mdat`. Pure
 * TypeScript — no ffmpeg. Returns the original bytes when already faststarted
 * or when the result would fail metadata validation.
 */
export function faststartMp4(mediaBytes: Uint8Array): SeekableResult {
  if (mediaBytes.byteLength === 0) return { bytes: mediaBytes, changed: false };
  try {
    const out = applyFaststart(mediaBytes);
    if (out === mediaBytes) return { bytes: mediaBytes, changed: false };
    if (!hasPlayableMp4Metadata(out)) {
      return { bytes: mediaBytes, changed: false };
    }
    return { bytes: out, changed: true };
  } catch (err) {
    console.warn("[video-remux] mp4 faststart failed, keeping original", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { bytes: mediaBytes, changed: false };
  }
}

/**
 * Make recorded media seekable based on its container format. Dispatches to
 * {@link faststartMp4} for MP4 and {@link remuxWebmToSeekable} for WebM.
 * Always resolves; unknown formats and failures return the input unchanged.
 */
export async function makeSeekable(input: {
  mediaBytes: Uint8Array;
  videoFormat: VideoFormat;
}): Promise<SeekableResult> {
  if (input.videoFormat === "mp4") return faststartMp4(input.mediaBytes);
  if (input.videoFormat === "webm") {
    return remuxWebmToSeekable(input.mediaBytes);
  }
  return { bytes: input.mediaBytes, changed: false };
}
