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

import { spawn } from "node:child_process";
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

function ffmpegCommand(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  return resolveFfmpegStaticPath() ?? "ffmpeg";
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
  return Boolean(process.env.FFMPEG_PATH) || resolveFfmpegStaticPath() !== null;
}

function startsWithMagic(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.byteLength < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegCommand(), args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`ffmpeg remux timed out\n${stderr}`));
    }, REMUX_TIMEOUT_MS);

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

async function withRemuxSlot<T>(fn: () => Promise<T>): Promise<T> {
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
