import { useT } from "@agent-native/core/client/i18n";
import { LiveWaveform } from "@shared/live-waveform";
import type {
  RecordingPlayheadConfirmChange,
  RecordingPlayheadIntent,
  RecordingPlayheadLayout,
} from "@shared/recording-playhead";
import { RecordingPlayhead } from "@shared/recording-playhead";
import {
  clampRecordingPlayheadPosition,
  dockRecordingPlayhead,
  resizeRecordingPlayheadPosition,
} from "@shared/recording-playhead-position";
import type {
  RecordingPlayheadPosition,
  RecordingPlayheadSize,
} from "@shared/recording-playhead-position";
import { useEffect, useRef, useState } from "react";

export interface RecordingToolbarProps {
  /** Whether the elapsed-time ticker should run — true only while actively
   * recording (not during upload/compress, which freeze the last value). */
  active: boolean;
  /** Reads the current elapsed time from the recorder engine on each tick. */
  getElapsedMs: () => number;
  isPaused: boolean;
  audioLevel: number | null;
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
const TOOLBAR_HORIZONTAL_SIZE: RecordingPlayheadSize = {
  width: 150,
  height: 56,
};
const TOOLBAR_VERTICAL_SIZE: RecordingPlayheadSize = {
  width: 42,
  height: 118,
};
// Drop the toolbar just below the centered "Recording your screen…" status
// text (which sits at the viewport's vertical center) so the controls don't
// overlap it.
const TOOLBAR_TOP_OFFSET = 48;

export function RecordingToolbar({
  active,
  getElapsedMs,
  isPaused,
  audioLevel,
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

  const [pos, setPos] = useState<RecordingPlayheadPosition>(() =>
    typeof window === "undefined"
      ? {
          left: 16,
          top: 16,
          orientation: "horizontal",
          dock: "free",
          slot: null,
        }
      : {
          left: Math.max(
            16,
            (window.innerWidth - TOOLBAR_HORIZONTAL_SIZE.width) / 2,
          ),
          top: Math.max(16, window.innerHeight / 2 + TOOLBAR_TOP_OFFSET),
          orientation: "horizontal",
          dock: "free",
          slot: null,
        },
  );
  const posRef = useRef(pos);
  posRef.current = pos;
  const dragPositionRef = useRef(pos);
  const activePointerIdRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });
  const [toolbarLayout, setToolbarLayout] = useState<RecordingPlayheadLayout>(
    TOOLBAR_HORIZONTAL_SIZE,
  );
  const playheadSizesRef = useRef({
    horizontal: TOOLBAR_HORIZONTAL_SIZE,
    vertical: TOOLBAR_VERTICAL_SIZE,
  });
  const [pendingAction, setPendingAction] =
    useState<RecordingPlayheadIntent | null>(null);
  const toolbarLayoutRef = useRef(toolbarLayout);
  toolbarLayoutRef.current = toolbarLayout;

  useEffect(() => {
    if (!active) setPendingAction(null);
  }, [active]);

  function handlePlayheadLayoutChange(layout: RecordingPlayheadLayout) {
    const orientation = posRef.current.orientation;
    const minimum =
      orientation === "vertical"
        ? TOOLBAR_VERTICAL_SIZE
        : TOOLBAR_HORIZONTAL_SIZE;
    const nextLayout = {
      width: Math.max(minimum.width, Math.ceil(layout.width)),
      height: Math.max(minimum.height, Math.ceil(layout.height)),
    } satisfies RecordingPlayheadLayout;
    playheadSizesRef.current[orientation] = nextLayout;
    toolbarLayoutRef.current = nextLayout;
    setToolbarLayout((previous) =>
      previous.width === nextLayout.width &&
      previous.height === nextLayout.height
        ? previous
        : nextLayout,
    );
    setPos((previous) => {
      const next = resizeRecordingPlayheadPosition(
        previous,
        playheadSizesRef.current,
        {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        },
      );
      if (
        next.left === previous.left &&
        next.top === previous.top &&
        next.orientation === previous.orientation
      ) {
        return previous;
      }
      return next;
    });
  }

  function handlePlayheadConfirmAction(intent: RecordingPlayheadIntent) {
    setPendingAction(intent);
    onConfirmAction(intent);
  }

  useEffect(() => {
    function onResize() {
      setPos((p) => {
        return resizeRecordingPlayheadPosition(p, playheadSizesRef.current, {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        });
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
    dragPositionRef.current = posRef.current;
    dragOffsetRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
    };
    rootRef.current.setPointerCapture(e.pointerId);
    activePointerIdRef.current = e.pointerId;
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== e.pointerId) return;
    const { dx, dy } = dragOffsetRef.current;
    const orientation = posRef.current.orientation;
    const layout = playheadSizesRef.current[orientation];
    const clamped = clampRecordingPlayheadPosition(
      e.clientX - dx,
      e.clientY - dy,
      layout,
      { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
    );
    setPos((prev) => ({
      ...prev,
      left: clamped.left,
      top: clamped.top,
      dock: "free",
      slot: null,
    }));
    dragPositionRef.current = {
      ...posRef.current,
      left: clamped.left,
      top: clamped.top,
      dock: "free",
      slot: null,
    };
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== e.pointerId) return;
    activePointerIdRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const current = dockRecordingPlayhead(
      dragPositionRef.current.left,
      dragPositionRef.current.top,
      playheadSizesRef.current,
      {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      },
    );
    dragPositionRef.current = current;
    setPos(current);
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
        minWidth:
          pos.orientation === "horizontal"
            ? TOOLBAR_HORIZONTAL_SIZE.width
            : undefined,
        minHeight: toolbarLayout.height,
        touchAction: "none",
      }}
    >
      <RecordingPlayhead
        elapsedMs={elapsedMs}
        paused={isPaused}
        orientation={pos.orientation}
        enabled={active}
        pendingAction={pendingAction}
        meter={<LiveWaveform level={audioLevel} dimmed={!active || isPaused} />}
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
