import { isScreenshotSize } from "@shared/png";
import { SESSION_REPLAY_AGENT_ACCESS_PARAM } from "@shared/session-replay-agent-access";
import {
  MAX_SESSION_REPLAY_CAPTURE_OFFSET_MS,
  SESSION_REPLAY_CAPTURE_THROUGH_MS_PARAM,
} from "@shared/session-replay-capture";
import { useEffect, useRef, useState } from "react";

import { resolveReplayOffsetFromRecordingStart } from "../../../shared/replay-playback.js";
import {
  blobToBase64,
  extractVisibleReplayUserMessages,
  replayFrameAtMs,
  replayFrameFailureReason,
  replayFrameFitScale,
  replayFramePath,
  type ReplayFrameCapture,
} from "./session-replay-frame";
import { captureReplayScreenshot } from "./session-replay-screenshot";
import {
  buildReplayViewportTimeline,
  fetchSessionReplayPlayback,
  normalizeReplayEvents,
  REPLAY_OVERLAY_STYLE_RULES,
  replayAvailabilityErrorKey,
  replayInitialViewportDimensions,
  replayRouteAtOffset,
  replayViewportDimensionsAtTime,
} from "./SessionDetailPage";

// A browser may never paint a background tab, and an agent's often is one.
const NEXT_PAINT_LIMIT_MS = 500;

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, NEXT_PAINT_LIMIT_MS);
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export default function SessionReplayFrame({
  recordingId,
}: {
  recordingId: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const stageRootRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    let replayer: any = null;
    window.__anReplayFrame = { status: "loading" };

    const fail = (error: unknown) => {
      if (cancelled) return;
      window.__anReplayFrame = {
        status: "error",
        reason: replayFrameFailureReason(error),
      };
      setStatus("error");
    };

    async function boot() {
      const stage = stageRef.current;
      const stageRoot = stageRootRef.current;
      if (!stage || !stageRoot) throw new Error("frame_not_mounted");
      const agentAccessToken =
        new URLSearchParams(window.location.search).get(
          SESSION_REPLAY_AGENT_ACCESS_PARAM,
        ) ?? "";
      const query = new URLSearchParams(window.location.search);
      const captureThroughOffsetRaw = query.get(
        SESSION_REPLAY_CAPTURE_THROUGH_MS_PARAM,
      );
      if (captureThroughOffsetRaw === null) {
        throw new Error("replay_capture_offset_required");
      }
      const captureThroughOffsetMs = Number(captureThroughOffsetRaw);
      if (
        !/^(?:0|[1-9]\d*)$/.test(captureThroughOffsetRaw) ||
        !Number.isSafeInteger(captureThroughOffsetMs) ||
        captureThroughOffsetMs > MAX_SESSION_REPLAY_CAPTURE_OFFSET_MS
      ) {
        throw new Error("replay_capture_offset_invalid");
      }
      const atMs = replayFrameAtMs(window.location.search);
      const playback = await fetchSessionReplayPlayback(recordingId, {
        agentAccessToken,
        captureThroughOffsetMs,
      });
      if (
        playback.unavailableChunks > 0 ||
        playback.chunks.some((chunk) => chunk.unavailable)
      ) {
        throw new Error("replay_incomplete");
      }
      const events = normalizeReplayEvents(
        playback.chunks.flatMap((chunk) => chunk.events),
      );
      const recordingStartedAtMs = Date.parse(playback.recording.startedAt);
      if (!Number.isSafeInteger(recordingStartedAtMs)) {
        throw new Error("replay_start_time_unavailable");
      }
      const unavailable = replayAvailabilityErrorKey(events);
      if (unavailable) throw new Error(unavailable);
      const initial = replayInitialViewportDimensions(events);
      if (!initial) throw new Error("viewport_unavailable");
      const timeline = buildReplayViewportTimeline(events);
      // Sizes come from the recorded events, so one the browser could not
      // render is refused before any surface is allocated for it.
      if (
        !timeline.every((change) =>
          isScreenshotSize(change.width, change.height),
        )
      ) {
        throw new Error("viewport_out_of_range");
      }

      await import("@rrweb/replay/dist/style.css");
      const { Replayer } = await import("@rrweb/replay");
      if (cancelled) return;

      const sizeStage = (width: number, height: number) => {
        stageRoot.style.width = `${width}px`;
        stageRoot.style.height = `${height}px`;
        stageRoot.style.transform = "none";
        stageRoot.style.setProperty("--an-replay-cursor-scale", "1");
      };
      sizeStage(initial.width, initial.height);
      replayer = new Replayer(events as any[], {
        root: stageRoot,
        speed: 1,
        skipInactive: false,
        showWarning: false,
        showDebug: false,
        mouseTail: false,
        triggerFocus: true,
        insertStyleRules: REPLAY_OVERLAY_STYLE_RULES,
      });
      replayer.iframe?.setAttribute?.("referrerpolicy", "no-referrer");
      const totalTimeMs = Number(replayer.getMetaData?.().totalTime ?? 0);
      try {
        replayer.play?.(0);
      } catch {
        // rrweb throws when the first event cannot start playback; a pause at
        // 0 still builds the first snapshot, which is all a seek needs.
        replayer.pause?.(0);
      }
      await nextPaint();

      let queue: Promise<unknown> = Promise.resolve();
      let lastSeekedTarget: {
        recordingOffsetMs: number;
        playheadOffsetMs: number;
      } | null = null;
      const seekTo = async (recordingOffsetMs: number) => {
        if (!Number.isFinite(recordingOffsetMs) || recordingOffsetMs < 0) {
          throw new Error("offset_invalid");
        }
        const resolution = resolveReplayOffsetFromRecordingStart(
          events,
          recordingStartedAtMs,
          recordingOffsetMs,
        );
        if (!resolution) throw new Error("offset_invalid");
        if (resolution.range === "before") {
          throw new Error("offset_before_replay_start");
        }
        if (resolution.range === "after") {
          throw new Error("offset_out_of_range");
        }
        const { playheadOffsetMs } = resolution;
        if (playheadOffsetMs > totalTimeMs) {
          throw new Error("offset_out_of_range");
        }
        const dimensions =
          replayViewportDimensionsAtTime(timeline, playheadOffsetMs) ?? initial;
        replayer.pause(playheadOffsetMs);
        replayer.handleResize?.(dimensions);
        sizeStage(dimensions.width, dimensions.height);
        await nextPaint();
        return { playheadOffsetMs, dimensions };
      };
      const captureOne = async (
        recordingOffsetMs: number,
      ): Promise<ReplayFrameCapture> => {
        lastSeekedTarget = null;
        const { playheadOffsetMs, dimensions } =
          await seekTo(recordingOffsetMs);
        const iframe = replayer.iframe as HTMLIFrameElement | undefined;
        if (!iframe) throw new Error("replay_frame_missing");
        lastSeekedTarget = { recordingOffsetMs, playheadOffsetMs };
        const blob = await captureReplayScreenshot(
          stage,
          stageRoot,
          iframe,
          undefined,
          { assetCredentials: "omit" },
        );
        if (blob.type !== "image/png" || blob.size <= 0) {
          throw new Error("screenshot_invalid");
        }
        if (blob.size > 24 * 1024 * 1024) {
          throw new Error("screenshot_too_large");
        }
        return {
          offsetMs: recordingOffsetMs,
          playheadOffsetMs,
          width: dimensions.width,
          height: dimensions.height,
          route: replayFramePath(replayRouteAtOffset(events, playheadOffsetMs)),
          capturedAt: new Date().toISOString(),
          png: await blobToBase64(blob),
        };
      };

      // A browser screenshot takes the window, not the stage, so a moment is
      // shown whole. capture() goes back to the real size for its own PNG.
      if (atMs !== null) {
        const { dimensions } = await seekTo(atMs);
        const scale = replayFrameFitScale(dimensions, {
          width: window.innerWidth,
          height: window.innerHeight,
        });
        stageRoot.style.transformOrigin = "0 0";
        stageRoot.style.transform = `scale(${scale})`;
        stageRoot.style.setProperty(
          "--an-replay-cursor-scale",
          String(1 / scale),
        );
        await nextPaint();
      }

      window.__anReplayFrame = {
        status: "ready",
        recordingId,
        recordingStartedAt: playback.recording.startedAt,
        totalTimeMs,
        eventCount: playback.recording.eventCount,
        // One seek at a time: rrweb has a single playhead.
        capture: (recordingOffsetMs) => {
          const run = queue.then(() => captureOne(recordingOffsetMs));
          queue = run.catch(() => undefined);
          return run;
        },
        extractUserMessages: (recordingOffsetMs) => {
          const run = queue.then(() => {
            if (lastSeekedTarget?.recordingOffsetMs !== recordingOffsetMs) {
              throw new Error("prompt_provenance_capture_mismatch");
            }
            const iframe = replayer.iframe as HTMLIFrameElement | undefined;
            return extractVisibleReplayUserMessages(
              iframe?.contentDocument ?? null,
              lastSeekedTarget.recordingOffsetMs,
              lastSeekedTarget.playheadOffsetMs,
              new Date().toISOString(),
            );
          });
          queue = run.catch(() => undefined);
          return run;
        },
      };
      setStatus("ready");
    }

    boot().catch(fail);
    return () => {
      cancelled = true;
      try {
        replayer?.pause?.();
        replayer?.destroy?.();
        // coercion-ok: teardown of a player the page is leaving; nothing can act on a failure here.
      } catch {
        // Nothing to report: the page is going away.
      }
      window.__anReplayFrame = undefined;
    };
  }, [recordingId]);

  return (
    <div
      ref={stageRef}
      data-replay-frame={status}
      // guard:allow-raw-color — a recording with no page background renders on the browser's default white, and the frame must match it in every theme
      style={{ position: "fixed", left: 0, top: 0, background: "#fff" }}
    >
      <div
        ref={stageRootRef}
        className="an-replay-stage-root"
        style={{ position: "relative", overflow: "hidden" }}
      />
    </div>
  );
}
