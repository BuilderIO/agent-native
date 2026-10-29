/**
 * GET /api/agent-frames.jpg?id=<recordingId>&startMs=<ms>[&endMs=<ms>][&fps=<n>][&agent_access=<token>]
 *
 * A frame sheet for external agents: consecutive video frames from one range
 * in a single JPEG grid, so an agent can watch an animation or a transition
 * in one request. Cells read left to right, then top to bottom; cell i shows
 * the frame on screen at startMs + i * 1000 / fps. Leaving out fps uses the
 * video's own frame rate; leaving out endMs takes up to 36 frames from
 * startMs, stopping at 60 seconds or the end of the clip.
 */

import { MAX_AGENT_FRAME_SHEET_FRAMES } from "@shared/agent-context";
import { isImageRecording } from "@shared/recording-kind";
import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  type H3Event,
} from "h3";

import {
  describeFrameFailure,
  frameFailureStatus,
  loadAgentFrameAccess,
  sendFrameJson,
} from "../../lib/agent-frame-request.js";
import {
  loadRecordingMediaFile,
  queryString,
} from "../../lib/public-agent-context.js";
import {
  clampFrameSheetRange,
  frameSheetReachesPast,
  parseFrameSheetRequest,
  planFrameSheet,
  type FrameSheetPlan,
  type FrameSheetResult,
} from "../../lib/video-frame-sheet.js";
import {
  extractJpegFrameSheetFromFile,
  probeFrameSheetFpsFromFile,
  probeMediaDurationMsFromFile,
  VideoFrameExtractionError,
} from "../../lib/video-frame.js";

function requestFailure(
  event: H3Event,
  failure: { error: string; nextStep: string },
) {
  return sendFrameJson(event, 400, {
    failureKind: "request",
    error: failure.error,
    nextStep: failure.nextStep,
    maxFrames: MAX_AGENT_FRAME_SHEET_FRAMES,
  });
}

function applySheetHeaders(event: H3Event, plan: FrameSheetPlan) {
  setResponseHeader(event, "Content-Type", "image/jpeg");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
  // The image can't say which cell is which; these headers can, for clients
  // that read them. Times are whole milliseconds.
  setResponseHeader(event, "X-Clips-Frame-Sheet-Fps", String(plan.fps));
  setResponseHeader(
    event,
    "X-Clips-Frame-Sheet-Grid",
    `${plan.columns}x${plan.rows}`,
  );
  setResponseHeader(
    event,
    "X-Clips-Frame-Sheet-Times",
    plan.frameTimesMs.join(","),
  );
}

/**
 * A stored duration can overstate the file, leaving a range past the real end
 * with no frames. Like the single-frame route, probe the real duration once
 * and plan the sheet again inside it.
 */
async function extractSheetWithStaleDurationRecovery({
  mediaPath,
  plan,
  replan,
}: {
  mediaPath: string;
  plan: FrameSheetPlan;
  replan: (durationMs: number) => FrameSheetResult<FrameSheetPlan> | null;
}): Promise<{ sheet: Uint8Array; plan: FrameSheetPlan }> {
  try {
    return {
      sheet: await extractJpegFrameSheetFromFile({ mediaPath, plan }),
      plan,
    };
  } catch (error) {
    if (
      !(error instanceof VideoFrameExtractionError) ||
      error.code !== "NO_FRAME_AT_TIMESTAMP" ||
      plan.startMs <= 0
    ) {
      throw error;
    }
    const actualDurationMs = await probeMediaDurationMsFromFile(mediaPath);
    const retry = actualDurationMs === null ? null : replan(actualDurationMs);
    if (!retry?.ok || retry.value.startMs >= plan.startMs) throw error;
    return {
      sheet: await extractJpegFrameSheetFromFile({
        mediaPath,
        plan: retry.value,
      }),
      plan: retry.value,
    };
  }
}

export default defineEventHandler(async (event: H3Event) => {
  const query = getQuery(event);
  const accessResult = await loadAgentFrameAccess(event);
  if (!accessResult.ok) return accessResult.body;
  const recording = accessResult.access.recording;

  if (isImageRecording(recording)) {
    return sendFrameJson(event, 422, {
      failureKind: "unsupported",
      error:
        "This clip is a screenshot, so it has no frames to put in a sheet.",
      nextStep:
        "Fetch apis.frame.urlTemplate with atMs=0 to see the picture. Do not retry the frame sheet.",
    });
  }

  const parsed = parseFrameSheetRequest({
    startMs: queryString(query.startMs),
    endMs: queryString(query.endMs),
    fps: queryString(query.fps),
  });
  if (!parsed.ok) return requestFailure(event, parsed);
  const range = clampFrameSheetRange(parsed.value, recording.durationMs);
  if (!range.ok) return requestFailure(event, range);

  // Plan against a duration: clamp the request to it, then lay out the grid.
  const planWithin = (fps: number, durationMs: number | null) => {
    const clamped = clampFrameSheetRange(parsed.value, durationMs);
    if (!clamped.ok) return clamped;
    return planFrameSheet({
      request: clamped.value,
      fps,
      durationMs,
      width: recording.width,
      height: recording.height,
    });
  };
  // With fps given, an oversized request fails before the media download.
  const earlyPlan =
    parsed.value.fps === null
      ? null
      : planWithin(parsed.value.fps, recording.durationMs);
  if (earlyPlan && !earlyPlan.ok) return requestFailure(event, earlyPlan);

  try {
    const media = await loadRecordingMediaFile(recording);
    try {
      const fps =
        parsed.value.fps ?? (await probeFrameSheetFpsFromFile(media.path));
      // A stored duration can understate the file. When the request reaches
      // past it, plan against the file's real duration so the sheet covers
      // the range that was asked for, not an earlier one. If the probe fails,
      // plan without a duration rather than move the range on the stored one.
      const durationMs = frameSheetReachesPast(
        parsed.value,
        fps,
        recording.durationMs,
      )
        ? await probeMediaDurationMsFromFile(media.path)
        : recording.durationMs;
      const plan = planWithin(fps, durationMs);
      if (!plan.ok) return requestFailure(event, plan);
      const result = await extractSheetWithStaleDurationRecovery({
        mediaPath: media.path,
        plan: plan.value,
        replan: (actualDurationMs) => planWithin(fps, actualDurationMs),
      });
      applySheetHeaders(event, result.plan);
      return Buffer.from(result.sheet);
    } finally {
      await media.cleanup().catch(() => {});
    }
  } catch (err) {
    const status = frameFailureStatus(err);
    return sendFrameJson(event, status, describeFrameFailure(err, status));
  }
});
