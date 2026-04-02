import { useRef, useCallback, useState, useEffect } from "react";
import {
  IconCamera,
  IconMouse,
  IconAlertCircle,
  IconTrash,
  IconRotate,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { AnimationTrack, EasingKey } from "@/types";
import {
  frameToViewPct,
  clientXToFrame,
  pxDeltaToFrameDelta,
  clampFrame,
} from "@/utils/timelineCoordinates";

type DragMode = "move" | "resize-start" | "resize-end";

interface DragState {
  trackId: string;
  mode: DragMode;
  startX: number;
  initialStart: number;
  initialEnd: number;
  barAreaWidth: number;
}

interface KeyframeDragState {
  originalFrame: number;
  currentFrame: number;
  startX: number;
  barAreaWidth: number;
  movingKeys?: string[]; // "trackId:frame" keys being moved
  originalFrames?: Map<string, number>; // key -> original frame
}

interface KeyframeConflict {
  trackId: string;
  newFrame: number;
  originalFrame: number;
  conflictingFrame: number;
}

export type TimelineProps = {
  currentFrame: number;
  durationInFrames: number;
  fps: number;
  onSeek: (frame: number) => void;
  tracks: AnimationTrack[];
  selectedTrackId: string | null;
  onSelectTrack: (id: string | null) => void;
  onUpdateTrack: (id: string, patch: Partial<AnimationTrack>) => void;
  onDeleteTrack?: (id: string) => void;
  // Controlled view window — lifted to CompositionView so VideoPlayer shares it
  viewStart: number;
  viewEnd: number;
  onViewChange: (start: number, end: number) => void;
  onCameraKeyframeClick?: (trackType: "camera" | "cursor") => void;
  isPlaying?: boolean;
};

const RULER_HEIGHT = 24;
const TRACK_HEIGHT = 32;
const LABEL_WIDTH = 180;
const RANGE_BAR_HEIGHT = 12;

// Expression-controlled accent (matches TrackPropertiesPanel)
const EXPR_COLOR = "#60a5fa";

/** True if any animatedProp on this track is driven by code */
function hasExpressions(track: AnimationTrack): boolean {
  return !!track.animatedProps?.some((p) => p.programmatic || !!p.codeSnippet);
}

// Per-easing-type color tokens
const EASING_COLORS: Record<
  EasingKey,
  { bg: string; border: string; text: string; activeBorder: string }
> = {
  linear: {
    bg: "rgba(148,163,184,0.15)",
    border: "rgba(148,163,184,0.35)",
    activeBorder: "#94a3b8",
    text: "#94a3b8",
  },
  spring: {
    bg: "rgba(251,191,36,0.15)",
    border: "rgba(251,191,36,0.35)",
    activeBorder: "#fbbf24",
    text: "#fbbf24",
  },
  // Power eases - blue tones
  "power1.in": {
    bg: "rgba(96,165,250,0.15)",
    border: "rgba(96,165,250,0.35)",
    activeBorder: "#60a5fa",
    text: "#60a5fa",
  },
  "power1.out": {
    bg: "rgba(59,130,246,0.15)",
    border: "rgba(59,130,246,0.35)",
    activeBorder: "#3b82f6",
    text: "#3b82f6",
  },
  "power1.inOut": {
    bg: "rgba(37,99,235,0.15)",
    border: "rgba(37,99,235,0.35)",
    activeBorder: "#2563eb",
    text: "#2563eb",
  },
  "power2.in": {
    bg: "rgba(96,165,250,0.15)",
    border: "rgba(96,165,250,0.35)",
    activeBorder: "#60a5fa",
    text: "#60a5fa",
  },
  "power2.out": {
    bg: "rgba(59,130,246,0.15)",
    border: "rgba(59,130,246,0.35)",
    activeBorder: "#3b82f6",
    text: "#3b82f6",
  },
  "power2.inOut": {
    bg: "rgba(37,99,235,0.15)",
    border: "rgba(37,99,235,0.35)",
    activeBorder: "#2563eb",
    text: "#2563eb",
  },
  "power3.in": {
    bg: "rgba(96,165,250,0.15)",
    border: "rgba(96,165,250,0.35)",
    activeBorder: "#60a5fa",
    text: "#60a5fa",
  },
  "power3.out": {
    bg: "rgba(59,130,246,0.15)",
    border: "rgba(59,130,246,0.35)",
    activeBorder: "#3b82f6",
    text: "#3b82f6",
  },
  "power3.inOut": {
    bg: "rgba(37,99,235,0.15)",
    border: "rgba(37,99,235,0.35)",
    activeBorder: "#2563eb",
    text: "#2563eb",
  },
  "power4.in": {
    bg: "rgba(96,165,250,0.15)",
    border: "rgba(96,165,250,0.35)",
    activeBorder: "#60a5fa",
    text: "#60a5fa",
  },
  "power4.out": {
    bg: "rgba(59,130,246,0.15)",
    border: "rgba(59,130,246,0.35)",
    activeBorder: "#3b82f6",
    text: "#3b82f6",
  },
  "power4.inOut": {
    bg: "rgba(37,99,235,0.15)",
    border: "rgba(37,99,235,0.35)",
    activeBorder: "#2563eb",
    text: "#2563eb",
  },
  // Back - purple tones
  "back.in": {
    bg: "rgba(167,139,250,0.15)",
    border: "rgba(167,139,250,0.35)",
    activeBorder: "#a78bfa",
    text: "#a78bfa",
  },
  "back.out": {
    bg: "rgba(139,92,246,0.15)",
    border: "rgba(139,92,246,0.35)",
    activeBorder: "#8b5cf6",
    text: "#8b5cf6",
  },
  "back.inOut": {
    bg: "rgba(124,58,237,0.15)",
    border: "rgba(124,58,237,0.35)",
    activeBorder: "#7c3aed",
    text: "#7c3aed",
  },
  // Bounce - green tones
  "bounce.in": {
    bg: "rgba(52,211,153,0.15)",
    border: "rgba(52,211,153,0.35)",
    activeBorder: "#34d399",
    text: "#34d399",
  },
  "bounce.out": {
    bg: "rgba(16,185,129,0.15)",
    border: "rgba(16,185,129,0.35)",
    activeBorder: "#10b981",
    text: "#10b981",
  },
  "bounce.inOut": {
    bg: "rgba(5,150,105,0.15)",
    border: "rgba(5,150,105,0.35)",
    activeBorder: "#059669",
    text: "#059669",
  },
  // Circ - cyan tones
  "circ.in": {
    bg: "rgba(34,211,238,0.15)",
    border: "rgba(34,211,238,0.35)",
    activeBorder: "#22d3ee",
    text: "#22d3ee",
  },
  "circ.out": {
    bg: "rgba(6,182,212,0.15)",
    border: "rgba(6,182,212,0.35)",
    activeBorder: "#06b6d4",
    text: "#06b6d4",
  },
  "circ.inOut": {
    bg: "rgba(8,145,178,0.15)",
    border: "rgba(8,145,178,0.35)",
    activeBorder: "#0891b2",
    text: "#0891b2",
  },
  // Elastic - pink tones
  "elastic.in": {
    bg: "rgba(244,114,182,0.15)",
    border: "rgba(244,114,182,0.35)",
    activeBorder: "#f472b6",
    text: "#f472b6",
  },
  "elastic.out": {
    bg: "rgba(236,72,153,0.15)",
    border: "rgba(236,72,153,0.35)",
    activeBorder: "#ec4899",
    text: "#ec4899",
  },
  "elastic.inOut": {
    bg: "rgba(219,39,119,0.15)",
    border: "rgba(219,39,119,0.35)",
    activeBorder: "#db2777",
    text: "#db2777",
  },
  // Expo - orange tones
  "expo.in": {
    bg: "rgba(251,146,60,0.15)",
    border: "rgba(251,146,60,0.35)",
    activeBorder: "#fb923c",
    text: "#fb923c",
  },
  "expo.out": {
    bg: "rgba(249,115,22,0.15)",
    border: "rgba(249,115,22,0.35)",
    activeBorder: "#f97316",
    text: "#f97316",
  },
  "expo.inOut": {
    bg: "rgba(234,88,12,0.15)",
    border: "rgba(234,88,12,0.35)",
    activeBorder: "#ea580c",
    text: "#ea580c",
  },
  // Sine - teal tones
  "sine.in": {
    bg: "rgba(94,234,212,0.15)",
    border: "rgba(94,234,212,0.35)",
    activeBorder: "#5eead4",
    text: "#5eead4",
  },
  "sine.out": {
    bg: "rgba(45,212,191,0.15)",
    border: "rgba(45,212,191,0.35)",
    activeBorder: "#2dd4bf",
    text: "#2dd4bf",
  },
  "sine.inOut": {
    bg: "rgba(20,184,166,0.15)",
    border: "rgba(20,184,166,0.35)",
    activeBorder: "#14b8a6",
    text: "#14b8a6",
  },
};

const DEFAULT_EASING_COLOR = EASING_COLORS.linear;

// IconCamera track styling (blue accent)
const CAMERA_COLOR = "#60a5fa";

// Cursor track styling (purple accent)
const CURSOR_COLOR = "#a855f7";

// ─── RangeBar ────────────────────────────────────────────────────────────────
// AE/C4D-style navigator strip at the bottom of the bar area.
// Left ▶ and right ◀ triangle handles define the visible window.
// Drag the center region to pan. Double-click to reset to full view.

interface RangeBarProps {
  viewStart: number;
  viewEnd: number;
  durationInFrames: number;
  onViewChange: (start: number, end: number) => void;
}

function RangeBar({
  viewStart,
  viewEnd,
  durationInFrames,
  onViewChange,
}: RangeBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const MIN_WINDOW = Math.max(1, Math.round(durationInFrames * 0.05));

  const startPct = (viewStart / durationInFrames) * 100;
  const endPct = (viewEnd / durationInFrames) * 100;

  const HANDLE_W = 10;

  const startRangeDrag = (
    e: React.MouseEvent,
    mode: "start" | "end" | "pan",
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const startX = e.clientX;
    const initStart = viewStart;
    const initEnd = viewEnd;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const frameDelta = Math.round((delta / rect.width) * durationInFrames);

      let newStart = initStart;
      let newEnd = initEnd;

      if (mode === "start") {
        newStart = Math.max(
          0,
          Math.min(initEnd - MIN_WINDOW, initStart + frameDelta),
        );
      } else if (mode === "end") {
        newEnd = Math.max(
          initStart + MIN_WINDOW,
          Math.min(durationInFrames, initEnd + frameDelta),
        );
      } else {
        const dur = initEnd - initStart;
        newStart = Math.max(
          0,
          Math.min(durationInFrames - dur, initStart + frameDelta),
        );
        newEnd = newStart + dur;
      }

      onViewChange(newStart, newEnd);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const isZoomed = viewStart > 0 || viewEnd < durationInFrames;
  const HANDLE_COLOR = isZoomed
    ? "rgba(139,92,246,0.85)"
    : "rgba(148,163,184,0.65)";
  const RANGE_COLOR = isZoomed
    ? "rgba(139,92,246,0.15)"
    : "rgba(148,163,184,0.12)";
  const BG_COLOR = "rgba(0,0,0,0.20)";

  return (
    <div
      ref={containerRef}
      className="w-full h-full select-none relative"
      onDoubleClick={(e) => {
        e.stopPropagation();
        onViewChange(0, durationInFrames);
      }}
    >
      {/* Background track */}
      <div
        className="absolute inset-0 rounded-sm"
        style={{ backgroundColor: BG_COLOR }}
      />

      {/* Active range highlight */}
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: `${startPct}%`,
          width: `${endPct - startPct}%`,
          backgroundColor: RANGE_COLOR,
          cursor: "grab",
        }}
        onMouseDown={(e) => startRangeDrag(e, "pan")}
      />

      {/* Left handle — ▶ (inward-pointing right) */}
      <div
        className="absolute top-0 bottom-0 flex items-center justify-center cursor-ew-resize z-10"
        style={{
          left: `${startPct}%`,
          width: HANDLE_W,
          transform: "translateX(-50%)",
        }}
        onMouseDown={(e) => startRangeDrag(e, "start")}
      >
        <div
          style={{
            width: 0,
            height: 0,
            borderTop: "4px solid transparent",
            borderBottom: "4px solid transparent",
            borderLeft: `6px solid ${HANDLE_COLOR}`,
          }}
        />
      </div>

      {/* Right handle — ◀ (inward-pointing left) */}
      <div
        className="absolute top-0 bottom-0 flex items-center justify-center cursor-ew-resize z-10"
        style={{
          left: `${endPct}%`,
          width: HANDLE_W,
          transform: "translateX(-50%)",
        }}
        onMouseDown={(e) => startRangeDrag(e, "end")}
      >
        <div
          style={{
            width: 0,
            height: 0,
            borderTop: "4px solid transparent",
            borderBottom: "4px solid transparent",
            borderRight: `6px solid ${HANDLE_COLOR}`,
          }}
        />
      </div>

      {/* Zoom indicator — shows when not at full view */}
      {isZoomed && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span
            className="text-[7px] font-mono tracking-widest select-none uppercase"
            style={{ color: "rgba(139,92,246,0.4)" }}
          >
            zoom
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Timeline ────────────────────────────────────────────────────────────────

export function Timeline({
  currentFrame,
  durationInFrames,
  fps,
  onSeek,
  tracks = [],
  selectedTrackId = null,
  onSelectTrack = () => {},
  onUpdateTrack = () => {},
  onDeleteTrack,
  viewStart,
  viewEnd,
  onViewChange: handleViewChange,
  onCameraKeyframeClick,
  isPlaying = false,
}: TimelineProps) {
  const barAreaRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const keyframeDragRef = useRef<KeyframeDragState | null>(null);
  const selectionBoxJustCompletedRef = useRef(false);
  const isScrubbingRef = useRef(false);

  // Store original state for keyframe conflict undo (replaces window-based storage)
  const conflictUndoStateRef = useRef<{
    trackId: string;
    originalAnimatedProps: any;
  } | null>(null);

  // Local selection state per PRD
  const [selectedKeyframes, setSelectedKeyframes] = useState<
    Map<string, Set<number>>
  >(new Map());
  const [keyframeConflict, setKeyframeConflict] =
    useState<KeyframeConflict | null>(null);
  const [selectionBox, setSelectionBox] = useState<{
    trackId: string;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    trackId: string;
    x: number;
    y: number;
  } | null>(null);

  const viewDuration = Math.max(1, viewEnd - viewStart);
  const viewSeconds = viewDuration / fps;
  const viewStartSeconds = viewStart / fps;
  const viewEndSeconds = viewEnd / fps;

  /** Convert a frame number to a % position within the current view window */
  const toViewPct = useCallback(
    (frame: number) => frameToViewPct(frame, viewStart, viewDuration),
    [viewStart, viewDuration],
  );

  const totalSeconds = durationInFrames / fps;

  // Helper to check if a keyframe is selected
  const isKeyframeSelected = useCallback(
    (trackId: string, frame: number): boolean => {
      const trackSelection = selectedKeyframes.get(trackId);
      return trackSelection ? trackSelection.has(frame) : false;
    },
    [selectedKeyframes],
  );

  // ─── Ruler tick logic (adapts to zoom level) ────────────────────────────
  const getTickInterval = (seconds: number) => {
    if (seconds <= 1) return 0.1;
    if (seconds <= 3) return 0.5;
    if (seconds <= 10) return 1;
    if (seconds <= 30) return 2;
    if (seconds <= 60) return 5;
    return 10;
  };

  const tickInterval = getTickInterval(viewSeconds);
  const firstTick = Math.ceil(viewStartSeconds / tickInterval) * tickInterval;
  const ticks: number[] = [];
  for (
    let t = firstTick;
    t <= viewEndSeconds + 0.0001;
    t = parseFloat((t + tickInterval).toFixed(6))
  ) {
    ticks.push(t);
  }

  /** Formats a frame count as seconds with 1 decimal place — always consistent */
  const fmtSec = (frames: number) => `${(frames / fps).toFixed(1)}s`;

  const formatTickLabel = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const frac = seconds % 1;
    if (m > 0) return `${m}:${s.toString().padStart(2, "0")}`;
    if (frac > 0) return `${s}.${Math.round(frac * 10)}s`;
    return `${s}s`;
  };

  // ─── Bar-area scrubbing with global mouse tracking ──────────────────────────
  const handleBarAreaMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Check if clicking on a track bar - handle track selection
      const barEl = (e.target as Element).closest(".track-bar");
      if (barEl) {
        if (isDraggingRef.current) return;
        const trackId = barEl.getAttribute("data-track-id");
        if (!trackId) return;
        onSelectTrack(trackId === selectedTrackId ? null : trackId);
        return;
      }

      // Don't start scrubbing when clicking the range bar strip
      if ((e.target as Element).closest(".range-bar-zone")) return;

      // Don't start scrubbing if already dragging something else
      if (isDraggingRef.current) return;

      // Start scrubbing
      const el = barAreaRef.current;
      if (!el) return;

      e.preventDefault();
      isScrubbingRef.current = true;

      const rect = el.getBoundingClientRect();

      // Seek immediately on mousedown
      const frame = clientXToFrame(e.clientX, rect, viewStart, viewDuration);
      onSeek(frame);

      const onMouseMove = (ev: MouseEvent) => {
        if (!isScrubbingRef.current) return;

        // Update seek position based on mouse X, ignoring Y movement
        const el = barAreaRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const frame = clientXToFrame(ev.clientX, rect, viewStart, viewDuration);
        onSeek(frame);
      };

      const onMouseUp = () => {
        isScrubbingRef.current = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [viewStart, viewDuration, onSeek, onSelectTrack, selectedTrackId],
  );

  // ─── Track bar drag / resize ─────────────────────────────────────────────
  const startDrag = useCallback(
    (e: React.MouseEvent, track: AnimationTrack, mode: DragMode) => {
      e.preventDefault();
      const el = barAreaRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      isDraggingRef.current = false;

      const dragState: DragState = {
        trackId: track.id,
        mode,
        startX: e.clientX,
        initialStart: track.startFrame,
        initialEnd: track.endFrame,
        barAreaWidth: rect.width,
      };

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - dragState.startX;
        if (Math.abs(delta) > 2) isDraggingRef.current = true;

        // Map pixel delta to frame delta relative to the zoomed view
        const frameDelta = pxDeltaToFrameDelta(
          delta,
          dragState.barAreaWidth,
          viewDuration,
        );

        let newStart = dragState.initialStart;
        let newEnd = dragState.initialEnd;

        if (dragState.mode === "move") {
          const dur = dragState.initialEnd - dragState.initialStart;
          newStart = Math.max(
            0,
            Math.min(
              durationInFrames - dur,
              dragState.initialStart + frameDelta,
            ),
          );
          newEnd = newStart + dur;
        } else if (dragState.mode === "resize-start") {
          newStart = Math.max(
            0,
            Math.min(
              dragState.initialEnd - 1,
              dragState.initialStart + frameDelta,
            ),
          );
        } else {
          newEnd = Math.max(
            dragState.initialStart + 1,
            Math.min(durationInFrames, dragState.initialEnd + frameDelta),
          );
        }

        onUpdateTrack(dragState.trackId, {
          startFrame: newStart,
          endFrame: newEnd,
        });
      };

      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 0);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [durationInFrames, viewDuration, onUpdateTrack],
  );

  const selectedTrack = tracks.find((t) => t.id === selectedTrackId);

  // Playhead is only shown when the current frame falls within the view window
  const playheadVisible = currentFrame >= viewStart && currentFrame <= viewEnd;
  const playheadPct = toViewPct(currentFrame);

  // Delete key handler for removing selected keyframes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        // Check if any keyframes are selected
        if (selectedKeyframes.size === 0) return;

        e.preventDefault();

        // Remove all selected keyframes from their respective tracks
        selectedKeyframes.forEach((frames, trackId) => {
          if (frames.size === 0) return;

          const track = tracks.find((t) => t.id === trackId);
          if (!track || !track.animatedProps) return;

          // Remove all selected frames from all properties
          const updatedProps = track.animatedProps.map((prop) => {
            if (!prop.keyframes) return prop;

            const newKeyframes = prop.keyframes.filter(
              (kf) => !frames.has(kf.frame),
            );

            return {
              ...prop,
              keyframes: newKeyframes.length > 0 ? newKeyframes : undefined,
            };
          });

          onUpdateTrack(trackId, { animatedProps: updatedProps });
        });

        // Clear selection after deleting
        setSelectedKeyframes(new Map());
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedKeyframes, tracks, onUpdateTrack]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;

    const handleClick = () => setContextMenu(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [contextMenu]);

  // Clear track handler - removes all keyframes but keeps the track
  const handleClearTrack = useCallback(
    (trackId: string) => {
      const track = tracks.find((t) => t.id === trackId);
      if (!track) return;

      // Clear all keyframes from all properties
      const clearedProps = track.animatedProps?.map((prop) => ({
        ...prop,
        keyframes: [],
      }));

      onUpdateTrack(trackId, { animatedProps: clearedProps });
      setContextMenu(null);
    },
    [tracks, onUpdateTrack],
  );

  // Delete track handler
  const handleDeleteTrack = useCallback(
    (trackId: string) => {
      if (onDeleteTrack) {
        onDeleteTrack(trackId);
      }
      setContextMenu(null);
    },
    [onDeleteTrack],
  );

  return (
    <div className="w-full bg-card/60 border border-border border-t-0 rounded-b-xl overflow-hidden select-none">
      <div className="flex h-full overflow-hidden">
        {/* ── Label column ──────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 flex flex-col border-r border-border/40 bg-card/30"
          style={{ width: LABEL_WIDTH }}
        >
          {/* Ruler header placeholder */}
          <div
            className="border-b border-border flex items-center justify-between px-2.5"
            style={{ height: RULER_HEIGHT }}
          >
            <span className="text-[9px] text-muted-foreground/25 font-mono uppercase tracking-widest">
              Track
            </span>
          </div>

          {/* Range bar header placeholder */}
          <div
            className="border-b border-border flex items-center px-2.5 flex-shrink-0"
            style={{ height: RANGE_BAR_HEIGHT + 4 }}
          >
            <span className="text-[9px] text-muted-foreground/25 font-mono uppercase tracking-widest">
              View
            </span>
          </div>

          {/* Scrollable track labels */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {/* Animation track labels */}
            {tracks.map((track) => {
              const isSelected = selectedTrackId === track.id;
              const colors =
                EASING_COLORS[track.easing] ?? DEFAULT_EASING_COLOR;
              const isExpr = hasExpressions(track);
              const isCamera = track.id === "camera";
              const isCursor = track.id === "cursor";
              const isKeyframeTrack = track.startFrame === track.endFrame;

              return (
                <div
                  key={track.id}
                  className="flex items-center gap-1.5 px-2.5 cursor-default"
                  style={{ height: TRACK_HEIGHT }}
                  title={track.label}
                  onContextMenu={(e) => {
                    // Only show context menu for camera and cursor tracks
                    if (!isCamera && !isCursor) return;
                    e.preventDefault();
                    setContextMenu({
                      trackId: track.id,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  {isCamera ? (
                    <IconCamera
                      className="flex-shrink-0"
                      size={12}
                      style={{
                        color: isSelected ? CAMERA_COLOR : `${CAMERA_COLOR}99`,
                        transition: "color 0.15s ease",
                      }}
                    />
                  ) : isCursor ? (
                    <IconMouse
                      className="flex-shrink-0"
                      size={12}
                      style={{
                        color: isSelected ? CURSOR_COLOR : `${CURSOR_COLOR}99`,
                        transition: "color 0.15s ease",
                      }}
                    />
                  ) : isExpr ? (
                    <span
                      className="text-[7px] font-mono font-bold px-1 py-px rounded flex-shrink-0 uppercase tracking-wider leading-none"
                      style={{
                        backgroundColor: `${EXPR_COLOR}${isSelected ? "30" : "18"}`,
                        color: isSelected ? EXPR_COLOR : `${EXPR_COLOR}99`,
                        transition:
                          "background-color 0.15s ease, color 0.15s ease",
                      }}
                    >
                      fx
                    </span>
                  ) : isKeyframeTrack ? (
                    <div
                      className="w-2 h-2 rotate-45 flex-shrink-0 transition-opacity duration-150"
                      style={{
                        backgroundColor: colors.text,
                        opacity: isSelected ? 1 : 0.5,
                      }}
                    />
                  ) : (
                    <div
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-opacity duration-150"
                      style={{
                        backgroundColor: colors.text,
                        opacity: isSelected ? 1 : 0.5,
                      }}
                    />
                  )}
                  <span
                    className={cn(
                      "text-[10px] transition-colors duration-150 min-w-0",
                      isSelected ? "" : "text-muted-foreground/55",
                    )}
                    style={{
                      color: isSelected
                        ? isCamera
                          ? CAMERA_COLOR
                          : isCursor
                            ? CURSOR_COLOR
                            : isExpr
                              ? EXPR_COLOR
                              : colors.text
                        : undefined,
                      // Allow the label to shrink/wrap rather than hard-truncate
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {track.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Bar area (ruler + range bar + tracks + playhead) ─────────── */}
        <div
          ref={barAreaRef}
          className="flex-1 flex flex-col relative cursor-pointer overflow-hidden"
          onMouseDown={handleBarAreaMouseDown}
        >
          {/* Time ruler — shows ticks within the current view window */}
          <div
            className="relative w-full border-b border-border flex-shrink-0"
            style={{ height: RULER_HEIGHT }}
          >
            {ticks.map((sec) => {
              const pct = ((sec - viewStartSeconds) / viewSeconds) * 100;
              return (
                <div
                  key={sec}
                  className="absolute top-0 flex flex-col items-center"
                  style={{ left: `${pct}%` }}
                >
                  <div className="w-px h-2.5 bg-border" />
                  <span className="text-[9px] text-muted-foreground/50 font-mono mt-0.5 -translate-x-1/2">
                    {formatTickLabel(sec)}
                  </span>
                </div>
              );
            })}
            {ticks.slice(0, -1).map((sec) => {
              const subTick = parseFloat((sec + tickInterval / 2).toFixed(6));
              if (subTick >= viewEndSeconds) return null;
              const pct = ((subTick - viewStartSeconds) / viewSeconds) * 100;
              return (
                <div
                  key={`sub-${sec}`}
                  className="absolute top-0 w-px h-1.5 bg-border/40"
                  style={{ left: `${pct}%` }}
                />
              );
            })}
          </div>

          {/* ── Range navigator bar ──────────────────────────────────── */}
          <div
            className="range-bar-zone relative flex-shrink-0"
            style={{ height: RANGE_BAR_HEIGHT + 4 }}
          >
            <RangeBar
              viewStart={viewStart}
              viewEnd={viewEnd}
              durationInFrames={durationInFrames}
              onViewChange={handleViewChange}
            />
          </div>

          {/* Scrollable tracks area */}
          <div className="flex-1 overflow-y-auto scrollbar-thin relative">
            {/* ── Animation track rows ──────────────────────────────────── */}
            {tracks.map((track) => {
              const isSelected = selectedTrackId === track.id;
              const colors =
                EASING_COLORS[track.easing] ?? DEFAULT_EASING_COLOR;
              const isExpr = hasExpressions(track);
              const isCamera = track.id === "camera";
              const isCursor = track.id === "cursor";
              const leftPct = toViewPct(track.startFrame);
              const widthPct = toViewPct(track.endFrame) - leftPct;

              // Collect all keyframe frames for camera/cursor tracks
              const allKeyframeFrames = new Set<number>();
              if (isCamera || isCursor) {
                track.animatedProps?.forEach((prop) => {
                  prop.keyframes?.forEach((kf) =>
                    allKeyframeFrames.add(kf.frame),
                  );
                });
              }

              // Camera/Cursor track: only show keyframes, no track bar
              if (isCamera || isCursor) {
                const trackColor = isCamera ? CAMERA_COLOR : CURSOR_COLOR;

                return (
                  <div
                    key={track.id}
                    className="relative w-full"
                    style={{ height: TRACK_HEIGHT }}
                    onMouseDown={(e) => {
                      if (isPlaying) return;
                      // Only start box selection if clicking directly on track (not a keyframe)
                      if (e.target !== e.currentTarget) return;

                      e.preventDefault();
                      e.stopPropagation();

                      const el = barAreaRef.current;
                      if (!el) return;
                      const rect = el.getBoundingClientRect();
                      const startX = e.clientX - rect.left;
                      const startY = e.clientY;

                      let hasMoved = false;

                      // Initialize selection box
                      setSelectionBox({
                        trackId: track.id,
                        startX,
                        startY,
                        currentX: startX,
                        currentY: startY,
                      });

                      const handleMove = (ev: MouseEvent) => {
                        const currentX = ev.clientX - rect.left;
                        const currentY = ev.clientY;

                        // Check if mouse has moved significantly (3px threshold)
                        const deltaX = Math.abs(currentX - startX);
                        const deltaY = Math.abs(currentY - startY);
                        if (deltaX > 3 || deltaY > 3) {
                          hasMoved = true;
                        }

                        // Update selection box position
                        setSelectionBox((prev) =>
                          prev
                            ? {
                                ...prev,
                                currentX,
                                currentY,
                              }
                            : null,
                        );

                        // Calculate which keyframes are in the box
                        const boxStartPct =
                          Math.min(startX / rect.width, currentX / rect.width) *
                          100;
                        const boxEndPct =
                          Math.max(startX / rect.width, currentX / rect.width) *
                          100;

                        const framesInBox = new Set<number>();
                        allKeyframeFrames.forEach((f) => {
                          const framePct = toViewPct(f);
                          if (
                            framePct >= boxStartPct &&
                            framePct <= boxEndPct
                          ) {
                            framesInBox.add(f);
                          }
                        });

                        // Update selection continuously during drag
                        setSelectedKeyframes((prev) => {
                          const next = new Map(prev);
                          next.set(track.id, framesInBox);
                          return next;
                        });
                      };

                      const handleUp = () => {
                        window.removeEventListener("mousemove", handleMove);
                        window.removeEventListener("mouseup", handleUp);
                        setSelectionBox(null);

                        // If we had a selection box drag, prevent the next onClick from clearing
                        if (hasMoved) {
                          selectionBoxJustCompletedRef.current = true;
                          // Reset after a short delay (after onClick would have fired)
                          setTimeout(() => {
                            selectionBoxJustCompletedRef.current = false;
                          }, 10);
                        }
                      };

                      window.addEventListener("mousemove", handleMove);
                      window.addEventListener("mouseup", handleUp);
                    }}
                    onClick={(e) => {
                      // Clear selection when clicking empty area (unless box selection just completed)
                      if (
                        e.target === e.currentTarget &&
                        !selectionBoxJustCompletedRef.current
                      ) {
                        setSelectedKeyframes(new Map());
                      }
                    }}
                  >
                    <div className="absolute inset-x-0 bottom-0 h-px bg-border/20" />

                    {/* Selection box rendering */}
                    {selectionBox &&
                      selectionBox.trackId === track.id &&
                      barAreaRef.current &&
                      (() => {
                        const rect = barAreaRef.current.getBoundingClientRect();
                        const left = Math.min(
                          selectionBox.startX,
                          selectionBox.currentX,
                        );
                        const width = Math.abs(
                          selectionBox.currentX - selectionBox.startX,
                        );

                        return (
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: `${(left / rect.width) * 100}%`,
                              width: `${(width / rect.width) * 100}%`,
                              top: 0,
                              bottom: 0,
                              backgroundColor: `${trackColor}1a`, // 10% opacity fill
                              border: `1px dashed ${trackColor}99`, // 60% opacity dashed border
                              borderRadius: 2,
                            }}
                          />
                        );
                      })()}

                    {/* Keyframe markers only */}
                    {Array.from(allKeyframeFrames).map((frame) => {
                      const kfPct = toViewPct(frame);
                      if (kfPct < 0 || kfPct > 100) return null;
                      const isCurrentKeyframe = frame === currentFrame;

                      // Determine cursor keyframe style based on which properties changed
                      let cursorStyle:
                        | "position"
                        | "type"
                        | "both"
                        | "clickStart"
                        | "clickEnd" = "position";
                      if (isCursor) {
                        const xProp = track.animatedProps?.find(
                          (p) => p.property === "x",
                        );
                        const yProp = track.animatedProps?.find(
                          (p) => p.property === "y",
                        );
                        const typeProp = track.animatedProps?.find(
                          (p) => p.property === "type",
                        );
                        const clickProp = track.animatedProps?.find(
                          (p) => p.property === "isClicking",
                        );

                        const hasPositionKf =
                          xProp?.keyframes?.some((kf) => kf.frame === frame) ||
                          yProp?.keyframes?.some((kf) => kf.frame === frame);
                        const hasTypeKf = typeProp?.keyframes?.some(
                          (kf) => kf.frame === frame,
                        );
                        const clickKf = clickProp?.keyframes?.find(
                          (kf) => kf.frame === frame,
                        );

                        // Click keyframes get their own distinct style
                        if (clickKf) {
                          cursorStyle =
                            clickKf.value === "1" ? "clickStart" : "clickEnd";
                        } else if (hasPositionKf && hasTypeKf) {
                          cursorStyle = "both";
                        } else if (hasTypeKf) {
                          cursorStyle = "type";
                        } else {
                          cursorStyle = "position";
                        }
                      }

                      const keyframeColor = isCurrentKeyframe
                        ? "#ffffff"
                        : isCursor
                          ? CURSOR_COLOR
                          : CAMERA_COLOR;
                      const selected = isKeyframeSelected(track.id, frame);

                      return (
                        <div
                          key={frame}
                          data-keyframe="true"
                          className={cn(
                            "absolute top-1/2 -translate-y-1/2 group",
                            isPlaying
                              ? "cursor-not-allowed opacity-50"
                              : "cursor-grab active:cursor-grabbing",
                          )}
                          style={{
                            left: `${kfPct}%`,
                            // Extended clickable area with padding on both sides
                            transform: "translateY(-50%) translateX(-50%)",
                            width: "24px", // Wider clickable area (3× the 8px diamond)
                            height: "24px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            zIndex: selected ? 30 : 20, // Selected keyframes on top
                          }}
                          onMouseDown={(e) => {
                            if (isPlaying) return;
                            e.preventDefault();
                            e.stopPropagation();

                            // Check if this keyframe is already in the selection
                            const isAlreadySelected = isKeyframeSelected(
                              track.id,
                              frame,
                            );

                            // Determine which frames we'll be dragging
                            // If already selected, drag all selected frames; otherwise just this one
                            const framesToDrag = isAlreadySelected
                              ? selectedKeyframes.get(track.id) ||
                                new Set([frame])
                              : new Set([frame]);
                            const selectedFrames = Array.from(framesToDrag);

                            // Update selection if needed (for visual feedback)
                            if (!isAlreadySelected) {
                              setSelectedKeyframes(
                                new Map([[track.id, new Set([frame])]]),
                              );
                            }

                            // If track is camera or cursor, notify sidebar to open controls
                            if (isCamera && onCameraKeyframeClick) {
                              onCameraKeyframeClick("camera");
                            } else if (isCursor && onCameraKeyframeClick) {
                              onCameraKeyframeClick("cursor");
                            }

                            const startX = e.clientX;
                            const startY = e.clientY;
                            let isDragging = false;

                            const el = barAreaRef.current;
                            if (!el) return;
                            const rect = el.getBoundingClientRect();

                            // Save original state for undo in case of conflict
                            conflictUndoStateRef.current = {
                              trackId: track.id,
                              originalAnimatedProps: track.animatedProps,
                            };

                            // Store original positions of all selected keyframes
                            const originalFrames = new Map<number, number>();
                            selectedFrames.forEach((f) =>
                              originalFrames.set(f, f),
                            );

                            keyframeDragRef.current = {
                              originalFrame: frame,
                              currentFrame: frame,
                              startX,
                              barAreaWidth: rect.width,
                              movingKeys: selectedFrames.map(
                                (f) => `${track.id}:${f}`,
                              ),
                              originalFrames,
                            };

                            const handleMove = (ev: MouseEvent) => {
                              if (!keyframeDragRef.current) return;

                              // Check if moved significantly (3px threshold)
                              const dist = Math.sqrt(
                                Math.pow(ev.clientX - startX, 2) +
                                  Math.pow(ev.clientY - startY, 2),
                              );
                              if (dist > 3) {
                                isDragging = true;
                              }

                              // Calculate delta in pixels, convert to frames
                              const deltaX =
                                ev.clientX - keyframeDragRef.current.startX;
                              const frameChange = pxDeltaToFrameDelta(
                                deltaX,
                                keyframeDragRef.current.barAreaWidth,
                                viewDuration,
                              );

                              // Calculate new positions for all selected keyframes
                              const newPositions = new Map<number, number>();
                              let minNewFrame = Infinity;
                              let maxNewFrame = -Infinity;

                              selectedFrames.forEach((origFrame) => {
                                const newFrame = clampFrame(
                                  origFrame + frameChange,
                                  durationInFrames,
                                );
                                newPositions.set(origFrame, newFrame);
                                minNewFrame = Math.min(minNewFrame, newFrame);
                                maxNewFrame = Math.max(maxNewFrame, newFrame);
                              });

                              // Move ALL selected keyframes
                              if (track.animatedProps) {
                                const updatedProps = track.animatedProps.map(
                                  (prop) => {
                                    if (!prop.keyframes) return prop;

                                    const updatedKeyframes = prop.keyframes.map(
                                      (kf) => {
                                        const newFrame = newPositions.get(
                                          kf.frame,
                                        );
                                        return newFrame !== undefined
                                          ? { ...kf, frame: newFrame }
                                          : kf;
                                      },
                                    );

                                    return {
                                      ...prop,
                                      keyframes: updatedKeyframes,
                                    };
                                  },
                                );

                                onUpdateTrack(track.id, {
                                  animatedProps: updatedProps,
                                });
                              }

                              // Update current frame for the dragged keyframe
                              const newFrame = newPositions.get(
                                keyframeDragRef.current.originalFrame,
                              );
                              if (newFrame !== undefined) {
                                keyframeDragRef.current.currentFrame = newFrame;
                                // Seek playhead to follow the dragged keyframe
                                onSeek(newFrame);
                              }
                            };

                            const handleUp = () => {
                              window.removeEventListener(
                                "mousemove",
                                handleMove,
                              );
                              window.removeEventListener("mouseup", handleUp);

                              if (!keyframeDragRef.current) return;

                              const finalFrame =
                                keyframeDragRef.current.currentFrame;

                              if (!isDragging) {
                                // It was just a click - already handled selection above
                                onSeek(frame);
                                if (isCamera && onCameraKeyframeClick) {
                                  onCameraKeyframeClick("camera");
                                } else if (isCursor && onCameraKeyframeClick) {
                                  onCameraKeyframeClick("cursor");
                                }
                              } else {
                                // Calculate delta for all keyframes
                                const deltaX = 0; // We're at final position
                                const frameChange =
                                  finalFrame -
                                  keyframeDragRef.current.originalFrame;

                                // Build set of all new positions
                                const newFrameSet = new Set<number>();
                                selectedFrames.forEach((origFrame) => {
                                  const newPos = clampFrame(
                                    origFrame + frameChange,
                                    durationInFrames,
                                  );
                                  newFrameSet.add(newPos);
                                });

                                // Check for conflicts: any of the moved keyframes overlap with non-selected keyframes
                                if (track.animatedProps) {
                                  for (const prop of track.animatedProps) {
                                    if (prop.keyframes) {
                                      // Get all keyframe positions that are NOT being moved
                                      const staticFrames = prop.keyframes
                                        .filter(
                                          (kf) =>
                                            !selectedFrames.includes(kf.frame),
                                        )
                                        .map((kf) => kf.frame);

                                      // Check if any new position conflicts with a static keyframe
                                      for (const newPos of newFrameSet) {
                                        if (staticFrames.includes(newPos)) {
                                          // Conflict detected - show modal
                                          setKeyframeConflict({
                                            trackId: track.id,
                                            newFrame: newPos,
                                            originalFrame:
                                              keyframeDragRef.current
                                                .originalFrame,
                                            conflictingFrame: newPos,
                                          });
                                          keyframeDragRef.current = null;
                                          return; // Don't finalize - let modal handle it
                                        }
                                      }
                                    }
                                  }
                                }

                                // Update selection to reflect new positions
                                setSelectedKeyframes((prev) => {
                                  const next = new Map(prev);
                                  next.set(track.id, newFrameSet);
                                  return next;
                                });

                                // No conflict - success!
                                conflictUndoStateRef.current = null;
                              }

                              keyframeDragRef.current = null;
                            };

                            window.addEventListener("mousemove", handleMove);
                            window.addEventListener("mouseup", handleUp);
                          }}
                          title={
                            isPlaying
                              ? "Pause to select keyframe"
                              : `Drag to reposition • Click to select`
                          }
                        >
                          <div
                            className={cn(
                              "w-2 h-2 rotate-45 transition-transform relative",
                              !isPlaying && "group-hover:scale-125",
                            )}
                            style={{
                              // Different styles for cursor keyframes based on what changed
                              backgroundColor: selected
                                ? "#ffffff" // White fill for selected keyframes
                                : isCursor &&
                                    (cursorStyle === "clickStart" ||
                                      cursorStyle === "clickEnd")
                                  ? "#facc15" // Yellow for click keyframes
                                  : isCursor && cursorStyle === "type"
                                    ? "transparent"
                                    : keyframeColor,
                              border:
                                isCursor && cursorStyle === "type" && !selected
                                  ? `1.5px solid ${keyframeColor}`
                                  : isCursor &&
                                      cursorStyle === "both" &&
                                      !selected
                                    ? `1.5px solid #c084fc` // Brighter purple border for both
                                    : "none",
                              opacity:
                                isCursor && cursorStyle === "clickEnd"
                                  ? 0.4 // Semi-transparent for click end
                                  : 1, // Solid for everything else (including clickStart)
                              boxShadow: selected
                                ? `0 0 0 2px #ffffffcc, 0 0 8px #ffffff99` // White outline + glow for selected
                                : isCursor &&
                                    (cursorStyle === "clickStart" ||
                                      cursorStyle === "clickEnd")
                                  ? `0 0 ${isCurrentKeyframe ? 6 : 4}px #facc15${isCurrentKeyframe ? "cc" : "88"}` // Yellow glow for click keyframes
                                  : isCursor && cursorStyle === "type"
                                    ? `0 0 ${isCurrentKeyframe ? 6 : 4}px ${keyframeColor}${isCurrentKeyframe ? "88" : "66"}`
                                    : isCursor && cursorStyle === "both"
                                      ? `0 0 ${isCurrentKeyframe ? 8 : 6}px #c084fc${isCurrentKeyframe ? "cc" : "88"}`
                                      : `0 0 ${isCurrentKeyframe ? 6 : 4}px ${keyframeColor}${isCurrentKeyframe ? "cc" : "88"}`,
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              }

              // Keyframe-style track (instant state change - startFrame === endFrame)
              // These render as diamond markers instead of duration bars
              // Used for: tab switches, modal toggles, instant state changes
              // See AGENTS.md: "Keyframe-Style Tracks" section
              const isKeyframeTrack = track.startFrame === track.endFrame;

              if (isKeyframeTrack) {
                const keyframePos = toViewPct(track.startFrame);
                const keyframeColor = isExpr ? EXPR_COLOR : colors.text;
                const keyframeFrame = track.startFrame;

                // Check if this keyframe is selected
                const selectedFrames =
                  selectedKeyframes.get(track.id) || new Set<number>();
                const keyframeSelected = selectedFrames.has(keyframeFrame);

                return (
                  <div
                    key={track.id}
                    className="relative w-full"
                    style={{ height: TRACK_HEIGHT }}
                    onMouseDown={(e) => {
                      if (isPlaying) return;
                      // Only start box selection if clicking directly on track (not the keyframe)
                      if (e.target !== e.currentTarget) return;

                      e.preventDefault();
                      e.stopPropagation();

                      const el = barAreaRef.current;
                      if (!el) return;
                      const rect = el.getBoundingClientRect();
                      const startX = e.clientX - rect.left;
                      const startY = e.clientY;

                      let hasMoved = false;

                      // Initialize selection box
                      setSelectionBox({
                        trackId: track.id,
                        startX,
                        startY,
                        currentX: startX,
                        currentY: startY,
                      });

                      const handleMove = (ev: MouseEvent) => {
                        const currentX = ev.clientX - rect.left;
                        const currentY = ev.clientY;

                        // Check if mouse has moved significantly (3px threshold)
                        const deltaX = Math.abs(currentX - startX);
                        const deltaY = Math.abs(currentY - startY);
                        if (deltaX > 3 || deltaY > 3) {
                          hasMoved = true;
                        }

                        // Update selection box position
                        setSelectionBox((prev) =>
                          prev
                            ? {
                                ...prev,
                                currentX,
                                currentY,
                              }
                            : null,
                        );

                        // Calculate which keyframes are in the box
                        const boxStartPct =
                          Math.min(startX / rect.width, currentX / rect.width) *
                          100;
                        const boxEndPct =
                          Math.max(startX / rect.width, currentX / rect.width) *
                          100;

                        const framesInBox = new Set<number>();
                        const framePct = toViewPct(keyframeFrame);
                        if (framePct >= boxStartPct && framePct <= boxEndPct) {
                          framesInBox.add(keyframeFrame);
                        }

                        // Update selection continuously during drag
                        setSelectedKeyframes((prev) => {
                          const next = new Map(prev);
                          next.set(track.id, framesInBox);
                          return next;
                        });
                      };

                      const handleUp = () => {
                        window.removeEventListener("mousemove", handleMove);
                        window.removeEventListener("mouseup", handleUp);
                        setSelectionBox(null);

                        // If we had a selection box drag, prevent the next onClick from clearing
                        if (hasMoved) {
                          selectionBoxJustCompletedRef.current = true;
                          // Reset after a short delay (after onClick would have fired)
                          setTimeout(() => {
                            selectionBoxJustCompletedRef.current = false;
                          }, 10);
                        }
                      };

                      window.addEventListener("mousemove", handleMove);
                      window.addEventListener("mouseup", handleUp);
                    }}
                    onClick={(e) => {
                      // Clear selection when clicking empty area (unless box selection just completed)
                      if (
                        e.target === e.currentTarget &&
                        !selectionBoxJustCompletedRef.current
                      ) {
                        setSelectedKeyframes(new Map());
                      }
                    }}
                  >
                    <div className="absolute inset-x-0 bottom-0 h-px bg-border/20" />

                    {/* Selection box rendering */}
                    {selectionBox &&
                      selectionBox.trackId === track.id &&
                      barAreaRef.current &&
                      (() => {
                        const rect = barAreaRef.current.getBoundingClientRect();
                        const left = Math.min(
                          selectionBox.startX,
                          selectionBox.currentX,
                        );
                        const width = Math.abs(
                          selectionBox.currentX - selectionBox.startX,
                        );

                        return (
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left,
                              top: 0,
                              width,
                              height: TRACK_HEIGHT,
                              backgroundColor: "rgba(99, 102, 241, 0.15)",
                              border: "1px solid rgba(99, 102, 241, 0.4)",
                              borderRadius: "4px",
                            }}
                          />
                        );
                      })()}

                    {/* Keyframe diamond marker */}
                    <div
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 -translate-x-1/2",
                        "w-2 h-2 rotate-45 cursor-pointer transition-all",
                        !isPlaying && "hover:scale-125",
                      )}
                      style={{
                        left: `${keyframePos}%`,
                        backgroundColor: keyframeSelected
                          ? "#ffffff"
                          : keyframeColor,
                        border: keyframeSelected ? "none" : undefined,
                        boxShadow: keyframeSelected
                          ? `0 0 0 2px #ffffffcc, 0 0 8px #ffffff99`
                          : `0 0 4px ${keyframeColor}88`,
                      }}
                      onMouseDown={(e) => {
                        if (isPlaying) return;
                        e.preventDefault();
                        e.stopPropagation();

                        const el = barAreaRef.current;
                        if (!el) return;
                        const rect = el.getBoundingClientRect();
                        const startX = e.clientX;
                        let isDragging = false;

                        // Click selects the keyframe
                        if (!keyframeSelected) {
                          setSelectedKeyframes((prev) => {
                            const next = new Map(prev);
                            next.set(track.id, new Set([keyframeFrame]));
                            return next;
                          });
                        }

                        const handleMove = (ev: MouseEvent) => {
                          const dist = Math.abs(ev.clientX - startX);
                          if (dist > 3) {
                            isDragging = true;
                            const deltaX = ev.clientX - startX;
                            const frameChange = pxDeltaToFrameDelta(
                              deltaX,
                              rect.width,
                              viewDuration,
                            );
                            const newFrame = clampFrame(
                              track.startFrame + frameChange,
                              durationInFrames,
                            );

                            // Update both start and end to keep it as a keyframe
                            onUpdateTrack(track.id, {
                              startFrame: newFrame,
                              endFrame: newFrame,
                            });

                            // Update selection to reflect new position
                            setSelectedKeyframes((prev) => {
                              const next = new Map(prev);
                              next.set(track.id, new Set([newFrame]));
                              return next;
                            });
                          }
                        };

                        const handleUp = () => {
                          window.removeEventListener("mousemove", handleMove);
                          window.removeEventListener("mouseup", handleUp);

                          if (!isDragging) {
                            // Just a click - select track and seek
                            onSelectTrack(track.id);
                            onSeek(track.startFrame);
                          }
                        };

                        window.addEventListener("mousemove", handleMove);
                        window.addEventListener("mouseup", handleUp);
                      }}
                    />
                  </div>
                );
              }

              // Regular animation tracks (with duration)
              return (
                <div
                  key={track.id}
                  className="relative w-full"
                  style={{ height: TRACK_HEIGHT }}
                >
                  <div className="absolute inset-x-0 bottom-0 h-px bg-border/20" />

                  <div
                    className="track-bar absolute inset-y-1.5 rounded cursor-grab active:cursor-grabbing"
                    data-track-id={track.id}
                    style={{
                      left: `${leftPct}%`,
                      width: `${Math.max(widthPct, 0.5)}%`,
                      minWidth: 12,
                      backgroundColor: colors.bg,
                      border: `1px solid ${
                        isSelected ? colors.activeBorder : colors.border
                      }`,
                      opacity: isSelected ? 1 : 0.65,
                      transition: "opacity 0.15s ease, border-color 0.15s ease",
                      boxShadow: isSelected
                        ? `0 0 0 1px ${colors.activeBorder}22, 0 2px 8px ${colors.activeBorder}20`
                        : "none",
                    }}
                    onMouseDown={(e) => {
                      startDrag(e, track, "move");
                    }}
                  >
                    {/* Left resize handle */}
                    <div
                      className="resize-handle absolute left-0 top-0 bottom-0 cursor-ew-resize z-10 flex items-center justify-center"
                      style={{ width: 8 }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        startDrag(e, track, "resize-start");
                      }}
                    >
                      <div
                        className="w-px h-3 rounded-full"
                        style={{
                          backgroundColor: colors.text,
                          opacity: 0.5,
                        }}
                      />
                    </div>

                    {/* Time range label */}
                    <div className="absolute inset-0 flex items-center justify-center px-2 pointer-events-none overflow-hidden">
                      <span
                        className="text-[8px] font-mono whitespace-nowrap"
                        style={{
                          color: colors.text,
                          opacity: isSelected ? 0.9 : 0.6,
                        }}
                      >
                        {fmtSec(track.startFrame)}–{fmtSec(track.endFrame)}
                      </span>
                    </div>

                    {/* Right resize handle */}
                    <div
                      className="resize-handle absolute right-0 top-0 bottom-0 cursor-ew-resize z-10 flex items-center justify-center"
                      style={{ width: 8 }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        startDrag(e, track, "resize-end");
                      }}
                    >
                      <div
                        className="w-px h-3 rounded-full"
                        style={{
                          backgroundColor: colors.text,
                          opacity: 0.5,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Playhead ────────────────────────────────────────────── */}
          {playheadVisible && (
            <div
              className="absolute z-20 pointer-events-none"
              style={{
                left: `${playheadPct}%`,
                // Span from range bar to bottom of tracks
                top: RANGE_BAR_HEIGHT + 4,
                bottom: 0,
              }}
            >
              <div className="absolute inset-y-0 w-px bg-foreground/65 -translate-x-px" />
              <div className="absolute top-0 -translate-x-1/2 w-2 h-3 bg-foreground rounded-b-sm" />
            </div>
          )}
        </div>
      </div>

      {/* ── Keyframe Conflict Resolution Modal ──────────────────────────── */}
      {keyframeConflict && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => {
            // Clicking backdrop = undo
            const conflictState = conflictUndoStateRef.current;
            if (
              conflictState &&
              conflictState.trackId === keyframeConflict.trackId
            ) {
              onUpdateTrack(conflictState.trackId, {
                animatedProps: conflictState.originalAnimatedProps,
              });
              conflictUndoStateRef.current = null;
            }
            setKeyframeConflict(null);
          }}
        >
          <div
            className="bg-card border border-border rounded-lg p-6 max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <IconAlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold mb-1">Keyframe overlap</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Moving the keyframe(s) would create an overlap at frame{" "}
                  <span className="font-mono font-medium text-foreground">
                    {keyframeConflict.newFrame}
                  </span>
                  .
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => {
                  // Replace existing keyframes using Map-based deduplication
                  const targetTrack = tracks.find(
                    (t) => t.id === keyframeConflict.trackId,
                  );
                  if (targetTrack?.animatedProps) {
                    const updatedProps = targetTrack.animatedProps.map(
                      (prop) => {
                        if (!prop.keyframes) return prop;

                        // Group keyframes by frame number
                        const frameMap = new Map<
                          number,
                          (typeof prop.keyframes)[0]
                        >();
                        prop.keyframes.forEach((kf) => {
                          // Later keyframes overwrite earlier ones at the same frame
                          frameMap.set(kf.frame, kf);
                        });

                        // Convert back to array
                        const updatedKeyframes = Array.from(frameMap.values());
                        return { ...prop, keyframes: updatedKeyframes };
                      },
                    );
                    onUpdateTrack(keyframeConflict.trackId, {
                      animatedProps: updatedProps,
                    });
                  }
                  conflictUndoStateRef.current = null;
                  setKeyframeConflict(null);
                }}
                className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                Replace Existing Keyframes
              </button>

              <button
                onClick={() => {
                  // Undo - restore from saved state
                  const conflictState = conflictUndoStateRef.current;
                  if (
                    conflictState &&
                    conflictState.trackId === keyframeConflict.trackId
                  ) {
                    onUpdateTrack(conflictState.trackId, {
                      animatedProps: conflictState.originalAnimatedProps,
                    });
                    conflictUndoStateRef.current = null;
                  }
                  setKeyframeConflict(null);
                }}
                className="w-full px-4 py-2 bg-secondary text-foreground rounded-lg text-xs font-medium hover:bg-secondary/80 transition-colors"
              >
                Undo Move
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Context Menu for Track Management ──────────────────────────── */}
      {contextMenu &&
        (() => {
          const trackName =
            contextMenu.trackId === "camera" ? "Camera" : "Cursor";

          // Estimate menu height (header ~36px + 2 options ~28px each + padding ~8px = ~100px)
          const estimatedMenuHeight = 100;
          const estimatedMenuWidth = 160;
          const padding = 8; // Keep menu away from edges

          // Calculate position to prevent overflow
          let left = contextMenu.x;
          let top = contextMenu.y;

          // Prevent right edge overflow
          if (left + estimatedMenuWidth > window.innerWidth - padding) {
            left = window.innerWidth - estimatedMenuWidth - padding;
          }

          // Prevent bottom edge overflow - position above click if needed
          if (top + estimatedMenuHeight > window.innerHeight - padding) {
            top = contextMenu.y - estimatedMenuHeight;
          }

          // Prevent top edge overflow (in case mouse is very near top)
          if (top < padding) {
            top = padding;
          }

          return (
            <div
              className="fixed bg-card border border-border rounded-lg shadow-xl z-50 min-w-[160px] overflow-hidden"
              style={{
                left,
                top,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-3 py-2 bg-secondary/30 border-b border-border">
                <div className="text-xs font-medium text-foreground">
                  {trackName} Track
                </div>
              </div>

              {/* Options */}
              <div className="py-1">
                <button
                  onClick={() => handleClearTrack(contextMenu.trackId)}
                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-secondary transition-colors flex items-center gap-2 text-foreground/80 hover:text-foreground"
                >
                  <IconRotate className="w-3.5 h-3.5 text-muted-foreground" />
                  Clear track
                </button>
                <button
                  onClick={() => handleDeleteTrack(contextMenu.trackId)}
                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-destructive/10 transition-colors flex items-center gap-2 text-foreground/80 hover:text-destructive"
                >
                  <IconTrash className="w-3.5 h-3.5 text-muted-foreground" />
                  Delete track
                </button>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
