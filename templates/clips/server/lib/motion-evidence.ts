import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveFfmpegCommand, withRemuxSlot } from "./video-remux.js";

const MOTION_DECODE_TIMEOUT_MS = 30_000;
const STDERR_LIMIT = 256 * 1024;
const SEEK_PREROLL_MS = 100;
const ENCODER_TIME_BASE = "1:1000000";
const STRICTLY_INCREASING_ENCODER_PTS = "settb=AVTB,setpts=PTS+N";
const NOTHING_SELECTED =
  /Nothing was written into output file|Output file is empty, nothing was encoded/;

export const MAX_MOTION_EVIDENCE_IMAGES = 4;
export const MAX_CONSECUTIVE_INTERVAL_MS = 30_000;
export const MAX_FILMSTRIP_INTERVAL_MS = 120_000;
export const MAX_FILMSTRIP_SAMPLES = 32;
export const DEFAULT_FILMSTRIP_SAMPLES = 12;
export const MAX_CURSOR_DUPLICATE_FRAMES = 256;

export type MotionEvidenceMode = "consecutive" | "filmstrip";

export interface MotionEvidenceCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MotionEvidenceDimensions {
  width: number;
  height: number;
}

export interface MotionEvidenceFrame {
  pts: number;
  ptsUs: number;
  ptsMs: number;
  samePtsOrdinal: number;
  jpegBytes: Uint8Array;
  targetMs?: number;
}

export interface ConsecutiveMotionCursor {
  pts: number;
  ptsUs: number;
  samePtsSeen: number;
}

export interface ExtractMotionEvidenceInput {
  mediaBytes: Uint8Array;
  mimeType: string;
  startMs: number;
  endMs: number;
  mode: MotionEvidenceMode;
  limit: number;
  after?: ConsecutiveMotionCursor | undefined;
  filmstripTargetsMs?: number[] | undefined;
  crop?: MotionEvidenceCrop | undefined;
}

export interface ExtractMotionEvidenceResult {
  frames: MotionEvidenceFrame[];
  hasMore: boolean;
  sourceDimensions: MotionEvidenceDimensions;
  crop: MotionEvidenceCrop | null;
}

export class MotionEvidenceExtractionError extends Error {
  constructor(
    readonly code:
      | "ffmpeg_unavailable"
      | "decode_failed"
      | "no_video"
      | "timestamp_mismatch"
      | "crop_out_of_bounds",
    message: string,
  ) {
    super(message);
    this.name = "MotionEvidenceExtractionError";
  }
}

function mediaExtension(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase();
  if (base === "video/mp4" || base === "video/quicktime") return "mp4";
  if (base === "video/webm") return "webm";
  return "bin";
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(6);
}

function escapeSelectNumber(ms: number): string {
  return seconds(ms);
}

export function buildMotionSelectFilter(input: {
  mode: MotionEvidenceMode;
  startMs: number;
  endMs: number;
  afterPts?: number | undefined;
  filmstripTargetsMs?: number[] | undefined;
  crop?: MotionEvidenceCrop | undefined;
}): string {
  const cropFilter = input.crop
    ? `,crop=${input.crop.width}:${input.crop.height}:${input.crop.x}:${input.crop.y}:exact=1`
    : "";
  const scaleFilter = "scale='min(1280,iw)':-1";
  const afterShowinfo = `${cropFilter},${scaleFilter},${STRICTLY_INCREASING_ENCODER_PTS}`;
  if (input.mode === "consecutive") {
    const lower =
      input.afterPts === undefined
        ? `gte(t,${escapeSelectNumber(input.startMs)})`
        : `gte(pts,${input.afterPts})`;
    return `select='${lower}*lte(t,${escapeSelectNumber(input.endMs)})',showinfo${afterShowinfo}`;
  }

  const targets = input.filmstripTargetsMs ?? [];
  const endSeconds = escapeSelectNumber(input.endMs);
  const expression = targets.reduceRight(
    (otherwise, targetMs, index) =>
      `if(eq(selected_n,${index}),gte(t,${escapeSelectNumber(targetMs)})*lte(t,${endSeconds}),${otherwise})`,
    "0",
  );
  return `select='${expression}',showinfo${afterShowinfo}`;
}

export function parseShowinfoSourceDimensions(
  stderr: string,
): MotionEvidenceDimensions | null {
  for (const line of stderr.split(/\r?\n/)) {
    if (!line.includes("showinfo")) continue;
    const match = line.match(/\bs:\s*(\d+)x(\d+)\b/);
    if (!match) continue;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (Number.isSafeInteger(width) && Number.isSafeInteger(height)) {
      return { width, height };
    }
  }
  return null;
}

export interface ShowinfoFrameTimestamp {
  pts: number;
  ptsUs: number;
}

export function parseShowinfoFrameTimestamps(
  stderr: string,
): ShowinfoFrameTimestamp[] {
  const stamps: ShowinfoFrameTimestamp[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    if (!line.includes("showinfo")) continue;
    const match = line.match(
      /\bpts:\s*(-?\d+)\s+pts_time:\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i,
    );
    if (!match) continue;
    const pts = Number(match[1]);
    const ptsSeconds = Number(match[2]);
    if (Number.isSafeInteger(pts) && Number.isFinite(ptsSeconds))
      stamps.push({ pts, ptsUs: Math.round(ptsSeconds * 1_000_000) });
  }
  return stamps;
}

export function parseShowinfoPresentationTimes(stderr: string): number[] {
  return parseShowinfoFrameTimestamps(stderr).map(({ ptsUs }) => ptsUs);
}

async function runMotionDecode(args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // observed-write-ok: ffmpeg writes frame JPEGs only into this call's own temp directory, removed before it returns
    const child = spawn(resolveFfmpegCommand(), args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() =>
        reject(new Error(`ffmpeg motion decode timed out\n${stderr}`)),
      );
    }, MOTION_DECODE_TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_LIMIT);
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) =>
      finish(() => {
        if (code === 0) resolve(stderr);
        else reject(new Error(`ffmpeg exited with code ${code}\n${stderr}`));
      }),
    );
  });
}

function mapDecodeError(error: unknown): MotionEvidenceExtractionError {
  const message = error instanceof Error ? error.message : String(error);
  if (/enoent|not found|eacces|enoexec/i.test(message)) {
    return new MotionEvidenceExtractionError(
      "ffmpeg_unavailable",
      "Motion evidence extraction requires ffmpeg.",
    );
  }
  if (
    /matches no streams|does not contain any stream|video: none/i.test(message)
  ) {
    return new MotionEvidenceExtractionError(
      "no_video",
      "This recording does not contain a decodable video track.",
    );
  }
  return new MotionEvidenceExtractionError(
    "decode_failed",
    `Motion evidence decode failed: ${message}`,
  );
}

const EMPTY_OUTPUT_FALLOUT = [
  NOTHING_SELECTED,
  /No filtered frames for output stream/,
  /Error while opening encoder|Could not open encoder|ff_frame_thread_encoder_init failed/,
  /Error initializing output stream|Finishing stream without any data/,
  /Non full-range YUV is non-standard/,
  /Error sending frames to consumers/,
  /Task finished with error code|Terminating thread with return code/,
  /Conversion failed!/,
];

export function ffmpegErrorLines(stderr: string): string[] {
  return stderr
    .split(/\r?\n/)
    .filter((line) => /\[(error|fatal|panic)\]/.test(line))
    .filter(
      (line) =>
        !/^\[(vost#|out#)/.test(line) &&
        !EMPTY_OUTPUT_FALLOUT.some((pattern) => pattern.test(line)),
    )
    .map((line) => line.replace(/^(\[[^\]]*\]\s*)+/, "").trim());
}

export function decodeFailureIn(
  stderr: string,
  framesWritten: number,
): string | null {
  if (framesWritten > 0) return null;
  const errors = ffmpegErrorLines(stderr);
  if (errors.length > 0) return errors.slice(0, 3).join(" | ");
  const selected = parseShowinfoFrameTimestamps(stderr).length;
  if (selected > 0) {
    return `${selected} selected source frame(s) produced no image.`;
  }
  return null;
}

export function withoutMuxerLookaheadPts<T>(
  pts: T[],
  writtenFrames: number,
): T[] {
  return pts.length === writtenFrames + 1 ? pts.slice(0, writtenFrames) : pts;
}

function pairWrittenFramesWithPts(
  filenames: string[],
  pts: ShowinfoFrameTimestamp[],
  targetsMs: number[] | undefined,
): Array<{
  filename: string;
  pts: number;
  ptsUs: number;
  targetMs?: number;
}> {
  if (filenames.length !== pts.length) {
    throw new MotionEvidenceExtractionError(
      "timestamp_mismatch",
      `ffmpeg produced ${filenames.length} frame images but reported ${pts.length} presentation timestamps.`,
    );
  }
  const ptsValues = pts.values();
  const targetValues = (targetsMs ?? []).values();
  return filenames.flatMap((filename) => {
    const stamp = ptsValues.next();
    if (stamp.done) return [];
    const target = targetValues.next();
    return [
      {
        filename,
        pts: stamp.value.pts,
        ptsUs: stamp.value.ptsUs,
        ...(target.done ? {} : { targetMs: target.value }),
      },
    ];
  });
}

function assignSamePtsOrdinals(
  frames: Array<Omit<MotionEvidenceFrame, "samePtsOrdinal">>,
  after?: ConsecutiveMotionCursor,
): MotionEvidenceFrame[] {
  let previousPts: number | null = null;
  let ordinal = 0;
  return frames.map((frame) => {
    if (frame.pts === previousPts) {
      ordinal += 1;
    } else {
      previousPts = frame.pts;
      ordinal = after && frame.pts === after.pts ? after.samePtsSeen + 1 : 1;
    }
    return { ...frame, samePtsOrdinal: ordinal };
  });
}

export async function extractMotionEvidenceFrames(
  input: ExtractMotionEvidenceInput,
): Promise<ExtractMotionEvidenceResult> {
  if (input.mediaBytes.byteLength === 0) {
    throw new MotionEvidenceExtractionError(
      "no_video",
      "Recording media is empty.",
    );
  }

  const skipAtCursor = input.after?.samePtsSeen ?? 0;
  const outputLimit =
    input.mode === "consecutive"
      ? input.limit + skipAtCursor + 1
      : (input.filmstripTargetsMs?.length ?? input.limit);
  const firstRelevantMs =
    input.mode === "filmstrip"
      ? (input.filmstripTargetsMs?.[0] ?? input.startMs)
      : Math.max(
          input.startMs,
          input.after ? input.after.ptsUs / 1000 : input.startMs,
        );
  const seekMs = Math.max(0, firstRelevantMs - SEEK_PREROLL_MS);
  const decodeThroughMs = input.endMs + SEEK_PREROLL_MS;
  const filter = buildMotionSelectFilter({
    mode: input.mode,
    startMs: input.startMs,
    endMs: input.endMs,
    afterPts: input.after?.pts,
    filmstripTargetsMs: input.filmstripTargetsMs,
    crop: input.crop,
  });

  return withRemuxSlot(async () => {
    // observed-write-ok: a private temp directory for one decode, removed in finally
    const dir = await mkdtemp(join(tmpdir(), "clips-motion-evidence-"));
    const inputPath = join(dir, `input.${mediaExtension(input.mimeType)}`);
    const outputPattern = join(dir, "frame-%04d.jpg");
    try {
      // observed-write-ok: the media copy lives only in this call's temp directory
      await writeFile(inputPath, input.mediaBytes);
      let sourceDimensions: MotionEvidenceDimensions;
      try {
        const probeStderr = await runMotionDecode([
          "-hide_banner",
          "-loglevel",
          "info",
          "-nostdin",
          "-copyts",
          "-i",
          inputPath,
          "-an",
          "-sn",
          "-vf",
          "showinfo",
          "-frames:v",
          "1",
          "-f",
          "null",
          "-",
        ]);
        const decoded = parseShowinfoSourceDimensions(probeStderr);
        if (!decoded) {
          throw new MotionEvidenceExtractionError(
            "no_video",
            "The recording has no decoded video dimensions.",
          );
        }
        sourceDimensions = decoded;
      } catch (error) {
        if (error instanceof MotionEvidenceExtractionError) throw error;
        throw mapDecodeError(error);
      }
      if (
        input.crop &&
        (input.crop.x + input.crop.width > sourceDimensions.width ||
          input.crop.y + input.crop.height > sourceDimensions.height)
      ) {
        throw new MotionEvidenceExtractionError(
          "crop_out_of_bounds",
          `Crop ${input.crop.x},${input.crop.y} ${input.crop.width}x${input.crop.height} exceeds decoded source dimensions ${sourceDimensions.width}x${sourceDimensions.height}.`,
        );
      }
      let stderr: string;
      try {
        stderr = await runMotionDecode([
          "-hide_banner",
          "-loglevel",
          "level+info",
          "-nostdin",
          "-y",
          "-copyts",
          "-ss",
          seconds(seekMs),
          "-i",
          inputPath,
          "-an",
          "-sn",
          "-to",
          seconds(decodeThroughMs),
          "-vf",
          filter,
          "-fps_mode",
          "passthrough",
          "-enc_time_base:v",
          ENCODER_TIME_BASE,
          "-frames:v",
          String(Math.max(1, outputLimit)),
          "-q:v",
          "4",
          outputPattern,
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!NOTHING_SELECTED.test(message)) throw mapDecodeError(error);
        stderr = message;
      }

      const filenames = (await readdir(dir))
        .filter((name) => /^frame-\d+\.jpg$/.test(name))
        .sort();
      const failure = decodeFailureIn(stderr, filenames.length);
      if (failure) {
        throw new MotionEvidenceExtractionError(
          "decode_failed",
          `Motion evidence decode failed: ${failure}`,
        );
      }
      const written = pairWrittenFramesWithPts(
        filenames,
        withoutMuxerLookaheadPts(
          parseShowinfoFrameTimestamps(stderr),
          filenames.length,
        ),
        input.mode === "filmstrip" ? input.filmstripTargetsMs : undefined,
      );

      let raw = await Promise.all(
        written.map(async ({ filename, pts, ptsUs, targetMs }) => ({
          pts,
          ptsUs,
          ptsMs: ptsUs / 1000,
          jpegBytes: new Uint8Array(await readFile(join(dir, filename))),
          ...(targetMs === undefined ? {} : { targetMs }),
        })),
      );

      const after = input.after;
      if (input.mode === "consecutive" && after) {
        let equalSeen = 0;
        raw = raw.filter((frame) => {
          if (frame.pts < after.pts) return false;
          if (frame.pts !== after.pts) return true;
          equalSeen += 1;
          return equalSeen > after.samePtsSeen;
        });
      }

      if (input.mode === "filmstrip") {
        const endUs = Math.ceil(input.endMs * 1000);
        raw = raw.filter((frame) => frame.ptsUs <= endUs);
      }
      const hasMore = input.mode === "consecutive" && raw.length > input.limit;
      return {
        frames: assignSamePtsOrdinals(raw.slice(0, input.limit), input.after),
        hasMore,
        sourceDimensions,
        crop: input.crop ?? null,
      };
    } finally {
      // observed-write-ok: removes this call's own temp directory
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}
