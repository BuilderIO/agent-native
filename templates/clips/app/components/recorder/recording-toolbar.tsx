import { useT } from "@agent-native/core/client/i18n";
import { LiveWaveform } from "@shared/live-waveform";
import type {
  RecordingPlayheadConfirmChange,
  RecordingPlayheadIntent,
  RecordingPlayheadLayout,
} from "@shared/recording-playhead";
import { RecordingPlayhead } from "@shared/recording-playhead";
import { useEffect, useRef, useState } from "react";

import { clampRectToViewport, type BubblePosition } from "./camera-positioner";

export interface RecordingToolbarProps {
  /** Whether the elapsed-time ticker should run — true only while actively
   * recording (not during upload/compress, which freeze the last value). */
  active: boolean;
  /** Reads the current elapsed time from the recorder engine on each tick. */
  getElapsedMs: () => number;
  isPaused: boolean;
  onTogglePause: () => void;
  onStop: () => void;
  /** Used by the upload/compress state, where delete still opens the route's
   * existing confirmation dialog even though the playhead is not live. */
  onCancel: () => void;
  onConfirmAction: (intent: RecordingPlayheadIntent) => void;
  onConfirmChange: (change: RecordingPlayheadConfirmChange) => void;
}

// The shared playhead's resting width is the initial drag bound. The measured
// layout below expands that bound before the playhead reveals controls.
const TOOLBAR_WIDTH = 150;
const TOOLBAR_HEIGHT = 56;
// Drop the toolbar just below the centered "Recording your screen…" status
// text (which sits at the viewport's vertical center) so the controls don't
// overlap it.
const TOOLBAR_TOP_OFFSET = 48;

export function RecordingToolbar({
  active,
  getElapsedMs,
  isPaused,
  onTogglePause,
  onStop,
  onCancel,
  onConfirmAction,
  onConfirmChange,
}: RecordingToolbarProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  // Own the elapsed-time poll here instead of in the route component, so the
  // 4x/sec tick only re-renders this toolbar rather than the whole record page.
  const [elapsedMs, setElapsedMs] = useState(0);
  const getElapsedMsRef = useRef(getElapsedMs);
  getElapsedMsRef.current = getElapsedMs;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setElapsedMs(getElapsedMsRef.current());
    }, 250);
    return () => window.clearInterval(id);
  }, [active]);

  const [pos, setPos] = useState<BubblePosition>(() =>
    typeof window === "undefined"
      ? { left: 16, top: 16, corner: "tl" }
      : {
          left: Math.max(16, (window.innerWidth - TOOLBAR_WIDTH) / 2),
          top: Math.max(16, window.innerHeight / 2 + TOOLBAR_TOP_OFFSET),
          corner: "tl",
        },
  );
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });
  const [toolbarLayout, setToolbarLayout] = useState<RecordingPlayheadLayout>({
    width: TOOLBAR_WIDTH,
    height: TOOLBAR_HEIGHT,
  });
  const [pendingAction, setPendingAction] =
    useState<RecordingPlayheadIntent | null>(null);
  const toolbarLayoutRef = useRef(toolbarLayout);
  toolbarLayoutRef.current = toolbarLayout;

  useEffect(() => {
    if (!active) setPendingAction(null);
  }, [active]);

  function handlePlayheadLayoutChange(layout: RecordingPlayheadLayout) {
    const nextLayout = {
      width: Math.max(TOOLBAR_WIDTH, Math.ceil(layout.width)),
      height: Math.max(TOOLBAR_HEIGHT, Math.ceil(layout.height)),
    };
    toolbarLayoutRef.current = nextLayout;
    setToolbarLayout((previous) =>
      previous.width === nextLayout.width &&
      previous.height === nextLayout.height
        ? previous
        : nextLayout,
    );
    setPos((previous) => {
      const clamped = clampRectToViewport(
        previous.left,
        previous.top,
        nextLayout,
        {
          width: window.innerWidth,
          height: window.innerHeight,
        },
      );
      if (clamped.left === previous.left && clamped.top === previous.top) {
        return previous;
      }
      return { ...previous, left: clamped.left, top: clamped.top };
    });
  }

  function handlePlayheadConfirmAction(intent: RecordingPlayheadIntent) {
    setPendingAction(intent);
    onConfirmAction(intent);
  }

  useEffect(() => {
    function onResize() {
      const layout = toolbarLayoutRef.current;
      setPos((p) => {
        const clamped = clampRectToViewport(p.left, p.top, layout, {
          width: window.innerWidth,
          height: window.innerHeight,
        });
        return {
          ...p,
          left: clamped.left,
          top: clamped.top,
        };
      });
    }
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-recording-playhead-button]")) return;
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    dragOffsetRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
    };
    setDragging(true);
    rootRef.current.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const { dx, dy } = dragOffsetRef.current;
    const layout = toolbarLayoutRef.current;
    const clamped = clampRectToViewport(
      e.clientX - dx,
      e.clientY - dy,
      layout,
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos((prev) => ({ ...prev, left: clamped.left, top: clamped.top }));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!rootRef.current) return;
    if (rootRef.current.hasPointerCapture(e.pointerId)) {
      rootRef.current.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  }

  return (
    <div
      ref={rootRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={
        dragging ? "fixed z-[95] cursor-grabbing" : "fixed z-[95] cursor-grab"
      }
      style={{
        left: pos.left,
        top: pos.top,
        width: "max-content",
        minWidth: TOOLBAR_WIDTH,
        minHeight: toolbarLayout.height,
        touchAction: "none",
      }}
    >
      <RecordingPlayhead
        elapsedMs={elapsedMs}
        paused={isPaused}
        enabled={active}
        pendingAction={pendingAction}
        meter={<LiveWaveform level={null} dimmed={!active || isPaused} />}
        labels={{
          controls: t("recordingToolbar.controls"),
          stop: t("recordingToolbar.stop"),
          pause: t("recordingToolbar.pauseRecording"),
          resume: t("recordingToolbar.resumeRecording"),
          pauseShortcut: t("recordingToolbar.pauseShortcut"),
          resumeShortcut: t("recordingToolbar.resumeShortcut"),
          restart: t("recordingToolbar.restart"),
          restartShortcut: t("recordingToolbar.restartShortcut"),
          delete: t("recordingToolbar.cancel"),
          deleteShortcut: t("recordingToolbar.cancelShortcut"),
          restartQuestion: t("recordingToolbar.restartQuestion"),
          deleteQuestion: () => t("recordingToolbar.discardConfirmTitle"),
          restartConfirm: t("recordingToolbar.restartConfirm"),
          deleteConfirm: t("recordingToolbar.discardRecording"),
          resumeConfirm: t("recordingToolbar.resume"),
        }}
        onStop={onStop}
        onTogglePause={onTogglePause}
        onConfirmAction={handlePlayheadConfirmAction}
        onDeleteRequest={onCancel}
        onConfirmChange={onConfirmChange}
        onLayoutChange={handlePlayheadLayoutChange}
        className={active ? undefined : "opacity-80"}
      />
    </div>
  );
}
