import { isScreenshotSize } from "@shared/png";
import { SESSION_REPLAY_AGENT_ACCESS_PARAM } from "@shared/session-replay-agent-access";
import { useEffect, useRef, useState } from "react";

import {
  blobToBase64,
  replayFrameFailureReason,
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

function nextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
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
      const playback = await fetchSessionReplayPlayback(recordingId, {
        agentAccessToken,
      });
      if (
        !playback.isComplete ||
        playback.unavailableChunks > 0 ||
        playback.chunks.some((chunk) => chunk.unavailable)
      ) {
        throw new Error("replay_incomplete");
      }
      const events = normalizeReplayEvents(
        playback.chunks.flatMap((chunk) => chunk.events),
      );
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
      const captureOne = async (
        offsetMs: number,
      ): Promise<ReplayFrameCapture> => {
        if (!Number.isFinite(offsetMs) || offsetMs < 0) {
          throw new Error("offset_invalid");
        }
        if (offsetMs > totalTimeMs) throw new Error("offset_out_of_range");
        const dimensions =
          replayViewportDimensionsAtTime(timeline, offsetMs) ?? initial;
        replayer.pause(offsetMs);
        replayer.handleResize?.(dimensions);
        sizeStage(dimensions.width, dimensions.height);
        await nextPaint();
        const iframe = replayer.iframe as HTMLIFrameElement | undefined;
        if (!iframe) throw new Error("replay_frame_missing");
        const blob = await captureReplayScreenshot(stage, stageRoot, iframe);
        return {
          offsetMs,
          width: dimensions.width,
          height: dimensions.height,
          route: replayFramePath(replayRouteAtOffset(events, offsetMs)),
          capturedAt: new Date().toISOString(),
          png: await blobToBase64(blob),
        };
      };

      window.__anReplayFrame = {
        status: "ready",
        recordingId,
        totalTimeMs,
        eventCount: playback.recording.eventCount,
        // One seek at a time: rrweb has a single playhead.
        capture: (offsetMs) => {
          const run = queue.then(() => captureOne(offsetMs));
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
