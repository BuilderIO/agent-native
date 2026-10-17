/**
 * Plans a frame sheet: one JPEG grid of consecutive video frames from a time
 * range, so an agent can watch motion (an animation, a transition, a cursor
 * path) in one image instead of one frame request per timestamp.
 *
 * Cells read left to right, then top to bottom. Cell i shows the frame on
 * screen at startMs + i * 1000 / fps.
 */

import {
  MAX_AGENT_FRAME_SHEET_FPS,
  MAX_AGENT_FRAME_SHEET_FRAMES,
  MAX_AGENT_FRAME_SHEET_SPAN_MS,
  MIN_AGENT_FRAME_SHEET_FPS,
} from "@shared/agent-context";

export const DEFAULT_FRAME_SHEET_FPS = 30;
const CELL_BOX_WIDTH = 320;
const CELL_BOX_HEIGHT = 240;
const MAX_SHEET_WIDTH = 1280;
// A frame that starts up to 2 ms after a cell's time still belongs to that
// cell: containers round timestamps to whole milliseconds.
const CELL_TOLERANCE_MS = 2;

export interface FrameSheetRequest {
  startMs: number;
  endMs: number | null;
  fps: number | null;
}

export interface FrameSheetPlan {
  startMs: number;
  endMs: number;
  fps: number;
  frameCount: number;
  frameTimesMs: number[];
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
}

export type FrameSheetResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; nextStep: string };

// The advertised URL template carries {endMs} and {fps} placeholders. A
// client that fills in only the values it has leaves the others as they
// are, so an unfilled placeholder counts as left out.
function parseOptionalNumber(
  raw: string,
  placeholder?: string,
): number | null | undefined {
  if (!raw || raw.trim() === placeholder) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function parseFrameSheetRequest(query: {
  startMs: string;
  endMs: string;
  fps: string;
}): FrameSheetResult<FrameSheetRequest> {
  const startMs = parseOptionalNumber(query.startMs);
  const endMs = parseOptionalNumber(query.endMs, "{endMs}");
  const fps = parseOptionalNumber(query.fps, "{fps}");
  if (startMs === undefined || (startMs !== null && startMs < 0)) {
    return {
      ok: false,
      error: "startMs must be a non-negative number of milliseconds.",
      nextStep: "Set startMs to the time of the first frame you want to see.",
    };
  }
  const start = Math.round(startMs ?? 0);
  if (endMs === undefined || (endMs !== null && endMs <= start)) {
    return {
      ok: false,
      error: "endMs must be a number of milliseconds after startMs.",
      nextStep: `Set endMs after startMs, or leave it out to get up to ${MAX_AGENT_FRAME_SHEET_FRAMES} frames from startMs.`,
    };
  }
  if (
    fps === undefined ||
    (fps !== null &&
      (fps < MIN_AGENT_FRAME_SHEET_FPS || fps > MAX_AGENT_FRAME_SHEET_FPS))
  ) {
    return {
      ok: false,
      error: `fps must be a number from ${MIN_AGENT_FRAME_SHEET_FPS} to ${MAX_AGENT_FRAME_SHEET_FPS}.`,
      nextStep: `Set fps from ${MIN_AGENT_FRAME_SHEET_FPS} to ${MAX_AGENT_FRAME_SHEET_FPS}, or leave it out to use the video's own frame rate.`,
    };
  }
  return {
    ok: true,
    value: {
      startMs: start,
      endMs: endMs === null ? null : Math.round(endMs),
      fps,
    },
  };
}

/** Keep the range inside the recording and under the span limit. */
export function clampFrameSheetRange(
  request: FrameSheetRequest,
  durationMs: number | null | undefined,
): FrameSheetResult<FrameSheetRequest> {
  const duration =
    typeof durationMs === "number" && durationMs > 0 ? durationMs : null;
  // The first cell must start before the video ends even after the cell
  // tolerance moves it later, or ffmpeg ends the stream before any cell.
  const startMs =
    duration === null
      ? request.startMs
      : Math.min(
          request.startMs,
          Math.max(0, duration - 1 - CELL_TOLERANCE_MS),
        );
  const endMs =
    request.endMs === null || duration === null
      ? request.endMs
      : Math.min(request.endMs, duration);
  if (endMs !== null && endMs - startMs > MAX_AGENT_FRAME_SHEET_SPAN_MS) {
    return {
      ok: false,
      error: `A frame sheet covers at most ${MAX_AGENT_FRAME_SHEET_SPAN_MS / 1000} seconds; this range covers ${formatSeconds(endMs - startMs)}.`,
      nextStep: `Split the range into requests of at most ${MAX_AGENT_FRAME_SHEET_SPAN_MS} ms, or fetch single frames from apis.frame for moments spread across the clip.`,
    };
  }
  return { ok: true, value: { ...request, startMs, endMs } };
}

/**
 * The frame rate a sheet uses when the request leaves fps out: the video's
 * own rate from ffmpeg's stream line, so each frame appears once. tbr (the
 * nominal rate) comes first because a screen recording's average fps drops
 * while nothing moves. MediaRecorder WebM reports a millisecond timebase
 * ("1k tbr") and no rate at all; those fall back to 30. A real rate above 60
 * is capped at 60.
 */
export function frameSheetFpsFromProbe(stderr: string): number {
  const input = stderr.split(/\n(?:Stream mapping:|Output #0)/)[0] ?? "";
  const videoLine = input
    .split("\n")
    .find((line) => /Stream #\d+:\d+.*: Video:/.test(line));
  if (!videoLine) return DEFAULT_FRAME_SHEET_FPS;
  const rate = (label: "tbr" | "fps") => {
    const match = videoLine.match(
      new RegExp(`(\\d+(?:\\.\\d+)?)(k?) ${label}\\b`),
    );
    if (!match) return null;
    const value = Number(match[1]) * (match[2] ? 1000 : 1);
    return Number.isFinite(value) && value >= 1 && value < 1000 ? value : null;
  };
  const detected = rate("tbr") ?? rate("fps");
  return detected === null
    ? DEFAULT_FRAME_SHEET_FPS
    : Math.min(detected, MAX_AGENT_FRAME_SHEET_FPS);
}

export function planFrameSheet({
  request,
  fps,
  durationMs,
  width,
  height,
}: {
  request: FrameSheetRequest;
  fps: number;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
}): FrameSheetResult<FrameSheetPlan> {
  const { startMs } = request;
  const stepMs = 1000 / fps;
  const cellsUntil = (endMs: number) =>
    // A cell starts at each step inside [startMs, endMs); the epsilon keeps
    // 1000 ms at 30 fps at 30 cells despite floating-point division.
    Math.max(1, Math.ceil((endMs - startMs) / stepMs - 1e-6));
  let frameCount: number;
  let endMs: number;
  if (request.endMs === null) {
    endMs =
      startMs +
      Math.min(
        MAX_AGENT_FRAME_SHEET_FRAMES * stepMs,
        MAX_AGENT_FRAME_SHEET_SPAN_MS,
      );
    if (typeof durationMs === "number" && durationMs > startMs) {
      endMs = Math.min(endMs, durationMs);
    }
    frameCount = Math.min(MAX_AGENT_FRAME_SHEET_FRAMES, cellsUntil(endMs));
  } else {
    endMs = request.endMs;
    frameCount = cellsUntil(endMs);
    if (frameCount > MAX_AGENT_FRAME_SHEET_FRAMES) {
      const fittingEndMs = Math.floor(
        startMs + MAX_AGENT_FRAME_SHEET_FRAMES * stepMs,
      );
      const fittingFps =
        Math.floor(
          ((MAX_AGENT_FRAME_SHEET_FRAMES * 1000) / (endMs - startMs)) * 100,
        ) / 100;
      return {
        ok: false,
        error: `This range needs ${frameCount} frames at ${formatFps(fps)} fps; a frame sheet holds at most ${MAX_AGENT_FRAME_SHEET_FRAMES}.`,
        nextStep: `Keep fps=${formatFps(fps)} and set endMs=${fittingEndMs}, then request the next sheet from startMs=${fittingEndMs}; or keep this range and set fps=${formatFps(fittingFps)}.`,
      };
    }
  }

  const { cellWidth, cellHeight } = cellSize(width, height);
  const columns = Math.min(
    frameCount,
    Math.max(1, Math.floor(MAX_SHEET_WIDTH / cellWidth)),
  );
  return {
    ok: true,
    value: {
      startMs,
      endMs,
      fps,
      frameCount,
      frameTimesMs: Array.from({ length: frameCount }, (_, index) =>
        Math.round(startMs + index * stepMs),
      ),
      columns,
      rows: Math.ceil(frameCount / columns),
      cellWidth,
      cellHeight,
    },
  };
}

function cellSize(width?: number | null, height?: number | null) {
  const aspect =
    width && height && width > 0 && height > 0 ? width / height : 16 / 9;
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return aspect >= CELL_BOX_WIDTH / CELL_BOX_HEIGHT
    ? { cellWidth: CELL_BOX_WIDTH, cellHeight: even(CELL_BOX_WIDTH / aspect) }
    : {
        cellWidth: even(CELL_BOX_HEIGHT * aspect),
        cellHeight: CELL_BOX_HEIGHT,
      };
}

/**
 * ffmpeg input and filter arguments for a plan. -noaccurate_seek keeps every
 * frame from the keyframe before startMs, so the frame already on screen is
 * there however long the screen stood still (screen recordings drop frames
 * while nothing moves). setpts moves startMs (less the tolerance) to time
 * zero, and the fps filter then emits, for each cell, the latest frame at or
 * before its time. trim keeps exactly frameCount cells and ends the run, and
 * tile flushes a partial grid when the video ends first, leaving the remaining
 * cells black. There is no input -t: without an accurate seek it would count
 * from the keyframe, not from startMs.
 */
export function frameSheetFfmpegArgs(plan: FrameSheetPlan): {
  inputArgs: string[];
  filter: string;
} {
  return {
    inputArgs: ["-noaccurate_seek", "-ss", seconds(plan.startMs)],
    filter: [
      `setpts=PTS-${seconds(CELL_TOLERANCE_MS)}/TB`,
      `fps=fps=${plan.fps}:start_time=0:round=up`,
      `trim=end_frame=${plan.frameCount}`,
      `scale=${plan.cellWidth}:${plan.cellHeight}:force_original_aspect_ratio=decrease`,
      `pad=${plan.cellWidth}:${plan.cellHeight}:-1:-1:color=black`,
      `tile=${plan.columns}x${plan.rows}`,
    ].join(","),
  };
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(6);
}

function formatSeconds(ms: number): string {
  return `${Math.round(ms / 100) / 10} seconds`;
}

// The exact value, so a suggested request computed from it still fits.
function formatFps(fps: number): string {
  return String(fps);
}
