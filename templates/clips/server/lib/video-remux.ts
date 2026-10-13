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
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

const requireFromThisFile = createRequire(import.meta.url);
let cachedFfmpegStaticPath: string | null | undefined;
let activeRemuxes = 0;
const remuxWaiters: Array<() => void> = [];

export type VideoFormat = "webm" | "mp4";

export interface SeekableResult {
  bytes: Uint8Array;
  changed: boolean;
}

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
const PROBE_DURATION_SECONDS = "0.1";

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
        if (buf.length < STDERR_LIMIT) {
          buf += chunk.toString("utf8");
        }
      });
      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`${err.message}\n${buf}`));
      });
      child.on("close", () => {
        clearTimeout(timeout);
        resolve(buf);
      });
    });
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

export interface ProbedMediaInfo {
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

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
        if (buf.length < STDERR_LIMIT) buf += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
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
        "-fflags",
        "+genpts",
        "-i",
        inputPath,
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
