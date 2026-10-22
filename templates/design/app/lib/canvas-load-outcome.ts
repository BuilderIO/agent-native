import { useCallback, useEffect, useRef } from "react";

import {
  clearCanvasOutcomeDesign,
  recordCanvasOutcome,
  type CanvasLoadReadyBucket,
} from "./canvas-outcome-tracking";

/** A canvas that is not ready by then counts as stalled. */
export const CANVAS_LOAD_STALL_MS = 10_000;

export function canvasLoadReadyBucket(
  elapsedMs: number,
): CanvasLoadReadyBucket {
  if (elapsedMs < 1_000) return "lt_1s";
  if (elapsedMs <= 4_000) return "1_to_4s";
  return "gt_4s";
}

interface CanvasLoad {
  designId: string;
  startedAt: number;
  settled: boolean;
  hidden: boolean;
  stallTimer: ReturnType<typeof setTimeout>;
  onVisibilityChange: () => void;
}

// One load per design opened: a board mounts a canvas per screen, and screens
// remount, so counting per canvas would inflate loads and stalls.
let currentLoad: CanvasLoad | null = null;

function startLoad(designId: string): CanvasLoad {
  const load: CanvasLoad = {
    designId,
    startedAt: Date.now(),
    settled: false,
    hidden: document.visibilityState === "hidden",
    stallTimer: setTimeout(
      () => settleLoad(load, "stalled"),
      CANVAS_LOAD_STALL_MS,
    ),
    // Hidden tabs throttle timers and frames, so their load time means nothing.
    onVisibilityChange: () => {
      if (document.visibilityState === "hidden") load.hidden = true;
    },
  };
  document.addEventListener("visibilitychange", load.onVisibilityChange);
  currentLoad = load;
  return load;
}

function endLoad(load: CanvasLoad): void {
  load.settled = true;
  clearTimeout(load.stallTimer);
  document.removeEventListener("visibilitychange", load.onVisibilityChange);
}

function settleLoad(load: CanvasLoad, outcome: "ready" | "stalled"): void {
  if (load.settled) return;
  endLoad(load);
  const { designId } = load;
  if (load.hidden) {
    recordCanvasOutcome("canvas_load", "skipped", "hidden_during_load", {
      designId,
    });
  } else if (outcome === "stalled") {
    recordCanvasOutcome("canvas_load", "failed", "stalled", { designId });
  } else {
    recordCanvasOutcome("canvas_load", "succeeded", "none", {
      designId,
      readyBucket: canvasLoadReadyBucket(Date.now() - load.startedAt),
    });
  }
}

// A load still running when its design closes is not counted.
function abandonLoad(): void {
  const load = currentLoad;
  currentLoad = null;
  if (load && !load.settled) endLoad(load);
}

/**
 * Counts one `canvas_load` per design opened: the first measured canvas of a
 * design starts it and the first to report ready ends it. Pass
 * `measure: false` for a canvas that may never report ready (a snapshot, a
 * localhost or Fusion preview), or a missing bridge would count as a stall.
 * Call the returned function when the iframe bridge reports ready.
 */
export function useCanvasLoadOutcome({
  designId,
  measure,
}: {
  designId: string | undefined;
  measure: boolean;
}): () => void {
  const latest = useRef({ designId, measure });
  latest.current = { designId, measure };
  const startedLoad = useRef<CanvasLoad | null>(null);

  useEffect(() => {
    try {
      if (!measure || !designId) {
        // A canvas that stops being measured ends the load it started, or that
        // load would only ever end as a stall.
        if (startedLoad.current && startedLoad.current === currentLoad) {
          abandonLoad();
        }
        startedLoad.current = null;
        return;
      }
      if (currentLoad?.designId === designId) return;
      abandonLoad();
      startedLoad.current = startLoad(designId);
    } catch {
      // coercion-ok: load tracking must never break canvas mounting.
    }
  }, [designId, measure]);

  // Stable, and reads the latest props: the bridge handlers that call it are
  // registered once and keep whichever callback they first saw.
  return useCallback(() => {
    try {
      const { designId: canvasDesign, measure: measuring } = latest.current;
      if (measuring && canvasDesign && currentLoad?.designId === canvasDesign) {
        settleLoad(currentLoad, "ready");
      }
    } catch {
      // coercion-ok: load tracking must never break the bridge-ready path.
    }
  }, []);
}

/** The editor closed its design: end its load and send pending counts. */
export function leaveCanvasOutcomeDesign(): void {
  try {
    abandonLoad();
    clearCanvasOutcomeDesign();
  } catch {
    // coercion-ok: tracking teardown must never break navigation.
  }
}

export function __resetCanvasLoadOutcomeForTests(): void {
  abandonLoad();
}
