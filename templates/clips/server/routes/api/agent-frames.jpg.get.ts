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
  editedToOriginal,
  effectiveDuration,
  getExcludedRanges,
  parseEdits,
} from "../../../app/lib/timestamp-mapping.js";
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
  extractEditedJpegFrameSheetFromFile,
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

  const edits = parseEdits(recording.editsJson);
  const cuts = getExcludedRanges(edits);
  const hasCuts = cuts.length > 0;
  const editedDurationMs = hasCuts
    ? effectiveDuration(recording.durationMs, edits)
    : recording.durationMs;
  if (hasCuts && editedDurationMs <= 0) {
    return sendFrameJson(event, 422, {
      failureKind: "unsupported",
      error: "This clip has no visible frames after its trims.",
      nextStep: "Restore part of the recording before requesting frames.",
    });
  }

  const parsed = parseFrameSheetRequest({
    startMs: queryString(query.startMs),
    endMs: queryString(query.endMs),
    fps: queryString(query.fps),
  });
  if (!parsed.ok) return requestFailure(event, parsed);
  const range = clampFrameSheetRange(parsed.value, editedDurationMs);
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
    parsed.value.fps === null ||
    (hasCuts &&
      frameSheetReachesPast(parsed.value, parsed.value.fps, editedDurationMs))
      ? null
      : planWithin(parsed.value.fps, editedDurationMs);
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
      const reachesPast = frameSheetReachesPast(
        parsed.value,
        fps,
        editedDurationMs,
      );
      const probedDurationMs = reachesPast
        ? await probeMediaDurationMsFromFile(media.path)
        : null;
      if (hasCuts && reachesPast && probedDurationMs === null) {
        throw new VideoFrameExtractionError(
          "EXTRACTION_FAILED",
          "Could not determine the source duration for this trimmed range.",
        );
      }
      const sourceDurationMs = hasCuts
        ? (probedDurationMs ?? recording.durationMs)
        : recording.durationMs;
      const durationMs = hasCuts
        ? effectiveDuration(sourceDurationMs, edits)
        : reachesPast
          ? probedDurationMs
          : editedDurationMs;
      const plan = planWithin(fps, durationMs);
      if (!plan.ok) return requestFailure(event, plan);
      const extractEdited = (
        editedPlan: FrameSheetPlan,
        sourceDurationMs: number,
      ) => {
        if (cuts.every((cut) => editedPlan.endMs <= cut.startMs)) {
          return extractJpegFrameSheetFromFile({
            mediaPath: media.path,
            plan: editedPlan,
          });
        }
        return extractEditedJpegFrameSheetFromFile({
          mediaPath: media.path,
          plan: editedPlan,
          sourceFrames: editedPlan.frameTimesMs.map((editedMs) => {
            const atMs = editedToOriginal(editedMs, edits);
            return {
              atMs,
              visibleStartMs: cuts.reduce(
                (start, cut) =>
                  cut.endMs <= atMs ? Math.max(start, cut.endMs) : start,
                0,
              ),
              visibleEndMs: Math.min(
                sourceDurationMs,
                cuts.find((cut) => cut.startMs > atMs)?.startMs ??
                  sourceDurationMs,
              ),
            };
          }),
        });
      };
      let result: { plan: FrameSheetPlan; sheet: Uint8Array };
      if (hasCuts) {
        try {
          result = {
            plan: plan.value,
            sheet: await extractEdited(plan.value, sourceDurationMs),
          };
        } catch (error) {
          if (
            !(error instanceof VideoFrameExtractionError) ||
            error.code !== "NO_FRAME_AT_TIMESTAMP"
          )
            throw error;
          const actualDurationMs =
            probedDurationMs ??
            (await probeMediaDurationMsFromFile(media.path));
          if (
            actualDurationMs === null ||
            actualDurationMs >= recording.durationMs
          )
            throw error;
          const actualEditedDurationMs = effectiveDuration(
            actualDurationMs,
            edits,
          );
          if (
            actualEditedDurationMs <= 0 ||
            (!(reachesPast && probedDurationMs !== null) &&
              !plan.value.frameTimesMs.some(
                (time) => editedToOriginal(time, edits) >= actualDurationMs,
              ))
          )
            throw error;
          let recovered:
            | { plan: FrameSheetPlan; sheet: Uint8Array }
            | undefined;
          const candidates = [
            actualEditedDurationMs,
            Math.max(1, actualEditedDurationMs - 1000),
            1,
          ];
          for (const candidate of [...new Set(candidates)]) {
            const retry = planWithin(fps, candidate);
            if (!retry.ok) continue;
            try {
              recovered = {
                plan: retry.value,
                sheet: await extractEdited(retry.value, actualDurationMs),
              };
              break;
            } catch (retryError) {
              if (
                !(retryError instanceof VideoFrameExtractionError) ||
                retryError.code !== "NO_FRAME_AT_TIMESTAMP"
              )
                throw retryError;
            }
          }
          if (!recovered) throw error;
          result = recovered;
        }
      } else {
        result = await extractSheetWithStaleDurationRecovery({
          mediaPath: media.path,
          plan: plan.value,
          replan: (actualDurationMs) => planWithin(fps, actualDurationMs),
        });
      }
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
