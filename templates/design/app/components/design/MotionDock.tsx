/**
 * MotionDock — bottom motion timeline dock for the Design Studio (§6.3).
 *
 * Matches the motion artboard at
 * https://plan.agent-native.com/plans/plan-88dc4a09fb0c46bc:
 * - Full-width dock beneath the canvas when opened from the Layers footer.
 * - Left sidebar: animated layer rows with property sub-rows.
 * - Center: time ruler + diamond keyframes on a track grid.
 * - Playhead: draggable; scrubbing sends a preview-only `motion-preview`
 *   postMessage to the canvas iframe — NEVER writes to DB.
 * - Top toolbar: play/pause, duration input, auto-keyframe toggle, autosave.
 *
 * Track and duration edits notify the parent; the parent persists through
 * `apply-motion-edit`. Scrubbing/playback stays preview-only.
 *
 * All times are normalised to [0, 1] internally; the ruler maps them to px.
 */

import { useT } from "@agent-native/core/client";
import {
  MOTION_CURVE_PRESETS,
  MOTION_SPRING_DEFAULT_BOUNCE,
  MOTION_SPRING_PRESETS,
  parseSpringToken,
  sampleSpring,
  springToken,
} from "@shared/motion-easing";
import type {
  MotionTrack,
  MotionKeyframe,
  MotionEase,
  MotionPlaybackMode,
  MotionPropertyPreset,
} from "@shared/motion-timeline";
import {
  MOTION_DEFAULT_PLAYBACK_MODE,
  MOTION_PROPERTY_PRESETS,
  createMotionTrackFromPreset,
  getMotionTrackTiming,
  hasTrackFor,
  readTimelinePlaybackMode,
  sampleMotionKeyframesAt,
  sortMotionKeyframes,
  timelineTimeToTrackTime,
  upsertMotionKeyframeAtTime,
  withTimelinePlaybackMode,
} from "@shared/motion-timeline";
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconPlayerStop,
  IconArrowsLeftRight,
  IconCheck,
  IconDiamond,
  IconDiamondFilled,
  IconChevronDown,
  IconChevronRight,
  IconPlus,
  IconRepeat,
  IconRepeatOnce,
  IconTrash,
  IconRefresh,
  IconBolt,
  IconLayersSubtract,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent as ReactTransitionEvent,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const RULER_HEIGHT = 24; // px
const ROW_HEIGHT = 32; // px
const LAYER_SIDEBAR_WIDTH = 200; // px
const PLAYHEAD_WIDTH = 2; // px
const MIN_DOCK_HEIGHT = 160; // px
const DEFAULT_DOCK_HEIGHT = 280; // px

/**
 * Playback-mode cycling order + chrome, matching Figma Motion's cycling
 * toolbar button (Loop / Once / Ping-pong).
 */
const PLAYBACK_MODES: {
  mode: MotionPlaybackMode;
  labelKey: "loop" | "once" | "pingPong";
  Icon: typeof IconRepeat;
}[] = [
  { mode: "loop", labelKey: "loop", Icon: IconRepeat },
  { mode: "once", labelKey: "once", Icon: IconRepeatOnce },
  { mode: "ping-pong", labelKey: "pingPong", Icon: IconArrowsLeftRight },
];

/**
 * Row-identity key for a track. Uses the unit-separator delimiter (same
 * convention as apply-motion-edit's motionTrackKey) so distinct
 * (nodeId, property) pairs can never collide.
 */
function trackKey(track: MotionTrack): string {
  return `${track.targetNodeId}\u001f${track.property}`;
}

/** Compact ruler tick label: "250ms" under a second, "1.5s" above. */
function formatMsTick(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(2).replace(/\.?0+$/, "");
  return `${s}s`;
}

/**
 * Whether committing on this key should also suppress the blur handler's own
 * commit. Enter/Escape both trigger an explicit `.blur()` call right after
 * committing so the field visually defocuses; without this guard, that
 * synchronous blur re-invokes the (still stale, same-render) commit callback
 * a second time in the same tick — a harmless-looking no-op for identical
 * values, but it double-fires side effects like `onPlayheadChange` /
 * `onDurationChange` and the preview postMessage. Mirrors
 * `propInputKeyRequiresBlurGuard` in edit-panel/panel-primitives.tsx (the
 * same bug class, fixed there for style-property fields).
 */
export function motionFieldKeyRequiresBlurGuard(key: string): boolean {
  return key === "Enter" || key === "Escape";
}

/** Human label for an ease value: preset name when recognised, else raw. */
function easeLabel(
  ease: MotionEase | undefined,
  t: (key: string) => string,
): string {
  if (ease === undefined) return t("designEditor.motion.defaultEase");
  const curve = MOTION_CURVE_PRESETS.find((preset) => preset.value === ease);
  if (curve) return curve.label;
  const springPreset = MOTION_SPRING_PRESETS.find(
    (preset) => preset.value === ease,
  );
  if (springPreset) return springPreset.label;
  if (parseSpringToken(String(ease))) {
    return t("designEditor.motion.customSpring");
  }
  if (/^cubic-bezier\(/.test(String(ease))) {
    return t("designEditor.motion.customBezier");
  }
  return String(ease);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MotionDockTrack extends MotionTrack {
  /** Human-readable label derived from data-agent-native-layer-name or nodeId. */
  label: string;
}

export interface MotionDockProps {
  /** Tracks to display. Each track maps to one layer row. */
  tracks: MotionDockTrack[];
  /** Total animation duration in milliseconds. */
  durationMs: number;
  /** Default easing applied to keyframes that omit ease. */
  defaultEase?: MotionEase;
  /** Controlled open state. */
  open?: boolean;
  /** Called when the user toggles the dock open/closed. */
  onOpenChange?: (open: boolean) => void;
  /** Called after the close transform finishes. */
  onExitComplete?: () => void;
  /** Called when a track is modified (add/move/delete keyframe or change value). */
  onTracksChange?: (tracks: MotionDockTrack[]) => void;
  /** Called when durationMs is edited. */
  onDurationChange?: (ms: number) => void;
  /**
   * Controlled playback mode (Loop / Once / Ping-pong). When omitted, the
   * dock reads the mode stamped in `tracks` (timelinePlaybackMode on the
   * first track) and persists changes by re-stamping the tracks through
   * `onTracksChange` — no extra parent wiring needed.
   */
  playbackMode?: MotionPlaybackMode;
  /** Called when the playback-mode cycling button changes the mode. */
  onPlaybackModeChange?: (mode: MotionPlaybackMode) => void;
  /**
   * Reference to the canvas iframe element. Used to send preview postMessages.
   * If not provided, preview messages are skipped (no crash).
   */
  canvasIframeRef?: React.RefObject<HTMLIFrameElement | null>;
  /** Whether the parent autosave mutation is in flight. */
  applying?: boolean;
  /** Controlled auto-keyframe state. */
  autoKeyframe?: boolean;
  /** Called when the auto-keyframe toggle changes. */
  onAutoKeyframeChange?: (enabled: boolean) => void;
  /** Controlled playhead position, normalized to [0, 1]. */
  playhead?: number;
  /**
   * Called when the playhead position COMMITS (pause/stop, scrub end, reset)
   * — deliberately not on every rAF tick/scrub frame, so the parent is never
   * re-rendered at 60fps. Continuous preview stays inside the dock.
   */
  onPlayheadChange?: (t: number) => void;
  /**
   * Parent-owned mirror of the LIVE playhead position, updated on every rAF
   * tick and scrub frame (not just at commit points). The dock only notifies
   * the parent's state at commit points to avoid 60fps re-renders, but
   * auto-keyframe needs the true current position — an inspector edit made
   * mid-playback must key at where the playhead actually is, not at the last
   * committed time. Writing to a ref keeps that value fresh without
   * re-rendering the editor. Cleared back to the committed value on
   * pause/stop/scrub-end so a later read outside playback isn't stale.
   */
  livePlayheadRef?: React.MutableRefObject<number | null>;
  /**
   * The currently-selected canvas element, if any. Required to create the FIRST
   * track for a layer: the picker animates this node's
   * `data-agent-native-node-id`. `null` when nothing is selected — the create
   * affordance is then disabled with a hint to select an element.
   */
  selectedTarget?: { nodeId: string; label: string } | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MotionDock({
  tracks,
  durationMs,
  defaultEase = "ease",
  open: openProp,
  onOpenChange,
  onExitComplete,
  onTracksChange,
  onDurationChange,
  playbackMode: playbackModeProp,
  onPlaybackModeChange,
  canvasIframeRef,
  applying = false,
  autoKeyframe: autoKeyframeProp,
  onAutoKeyframeChange,
  playhead: playheadProp,
  onPlayheadChange,
  livePlayheadRef,
  selectedTarget = null,
}: MotionDockProps) {
  const t = useT();

  // Controlled / uncontrolled open state.
  const [openInternal, setOpenInternal] = useState(false);
  const isOpen = openProp !== undefined ? openProp : openInternal;
  const setOpen = useCallback(
    (v: boolean) => {
      setOpenInternal(v);
      onOpenChange?.(v);
    },
    [onOpenChange],
  );

  // Playhead position: normalised [0, 1]. High-frequency updates (rAF playback
  // ticks, ruler scrubbing) stay INTERNAL to the dock; the parent is only
  // notified at commit points (pause/stop, scrub end, reset) so a 60fps
  // playhead never re-renders the whole editor page.
  const [playhead, setPlayhead] = useState(playheadProp ?? 0);
  const playheadRef = useRef(playheadProp ?? 0);
  const [playing, setPlaying] = useState(false);
  const playRafRef = useRef<number | null>(null);
  const playStartRef = useRef<{ wallMs: number; startT: number } | null>(null);
  useEffect(() => {
    if (playheadProp === undefined) return;
    const clamped = Math.max(0, Math.min(1, playheadProp));
    playheadRef.current = clamped;
    // Keep the live-playhead mirror seeded with the committed position so a
    // read outside playback/scrub returns the current time, not a stale one.
    if (livePlayheadRef) livePlayheadRef.current = clamped;
    setPlayhead(clamped);
  }, [livePlayheadRef, playheadProp]);

  // Auto-keyframe mode: inspector/style edits create keyframes at the playhead.
  const [autoKeyframeInternal, setAutoKeyframeInternal] = useState(false);
  const autoKeyframe = autoKeyframeProp ?? autoKeyframeInternal;
  const setAutoKeyframe = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const resolved =
        typeof next === "function"
          ? (next as (current: boolean) => boolean)(autoKeyframe)
          : next;
      setAutoKeyframeInternal(resolved);
      onAutoKeyframeChange?.(resolved);
    },
    [autoKeyframe, onAutoKeyframeChange],
  );

  // Playback mode (Loop / Once / Ping-pong). Controlled by the parent when
  // provided; otherwise read from the stamp persisted in the tracks JSON.
  // Cycling the button re-stamps the tracks through onTracksChange, so the
  // mode persists via the parent's existing autosave without extra wiring.
  const [playbackModeInternal, setPlaybackModeInternal] =
    useState<MotionPlaybackMode | null>(null);
  const playbackMode: MotionPlaybackMode =
    playbackModeProp ??
    readTimelinePlaybackMode(tracks) ??
    playbackModeInternal ??
    MOTION_DEFAULT_PLAYBACK_MODE;
  const cyclePlaybackMode = useCallback(() => {
    const index = PLAYBACK_MODES.findIndex((m) => m.mode === playbackMode);
    const next = PLAYBACK_MODES[(index + 1) % PLAYBACK_MODES.length].mode;
    setPlaybackModeInternal(next);
    onPlaybackModeChange?.(next);
    if (onTracksChange && tracks.length > 0) {
      onTracksChange(withTimelinePlaybackMode(tracks, next));
    }
  }, [onPlaybackModeChange, onTracksChange, playbackMode, tracks]);

  // Selected property row — the target of the toolbar's add-keyframe ◆
  // button (Figma keys the selected track at the playhead).
  const [selectedTrackKey, setSelectedTrackKey] = useState<string | null>(null);
  const selectedTrack =
    tracks.find((track) => trackKey(track) === selectedTrackKey) ?? null;

  // Current-time field draft (null = displaying the live playhead).
  const [timeDraft, setTimeDraft] = useState<string | null>(null);
  // See motionFieldKeyRequiresBlurGuard: set right before an Enter-triggered
  // `.blur()` so the blur handler that fires in the same synchronous tick
  // skips its own commit instead of double-invoking commitTimeDraft.
  const skipNextTimeBlurCommitRef = useRef(false);
  // Same guard for the duration field's Enter -> blur -> onBlur-commit path.
  const skipNextDurationBlurCommitRef = useRef(false);
  /** Internal high-frequency playhead update — does NOT notify the parent. */
  const setPlayheadLocal = useCallback(
    (next: number) => {
      playheadRef.current = next;
      // Mirror the LIVE position into the parent-owned ref so auto-keyframe
      // reads the true current playhead during playback/scrub, not the last
      // committed time. Updating a ref never re-renders, so this stays cheap
      // at 60fps.
      if (livePlayheadRef) livePlayheadRef.current = next;
      setPlayhead(next);
    },
    [livePlayheadRef],
  );
  /** Commit the current playhead to the parent (pause, scrub end, reset). */
  const commitPlayhead = useCallback(() => {
    if (livePlayheadRef) livePlayheadRef.current = playheadRef.current;
    onPlayheadChange?.(playheadRef.current);
  }, [livePlayheadRef, onPlayheadChange]);

  // Dock height (resizable via the top drag handle).
  const [dockHeight, setDockHeight] = useState(DEFAULT_DOCK_HEIGHT);
  const [isResizingDock, setIsResizingDock] = useState(false);
  const resizingRef = useRef(false);
  const resizeStartRef = useRef<{ y: number; h: number } | null>(null);

  const handleDockTransitionEnd = useCallback(
    (event: ReactTransitionEvent<HTMLDivElement>) => {
      if (event.currentTarget !== event.target) return;
      if (event.propertyName !== "height") return;
      if (!isOpen) onExitComplete?.();
    },
    [isOpen, onExitComplete],
  );

  // Expanded layers in the sidebar.
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    () => new Set(tracks.map((t) => t.targetNodeId)),
  );

  useEffect(() => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      for (const track of tracks) next.add(track.targetNodeId);
      return next.size === current.size ? current : next;
    });
  }, [tracks]);

  // Ruler / track area ref for pointer math.
  const trackAreaRef = useRef<HTMLDivElement>(null);

  // Local duration input state.
  const [durationInput, setDurationInput] = useState(String(durationMs));
  useEffect(() => {
    setDurationInput(String(durationMs));
  }, [durationMs]);

  // ── Preview postMessage ──────────────────────────────────────────────────
  const sendPreview = useCallback(
    (t: number) => {
      const iframe = canvasIframeRef?.current;
      if (!iframe?.contentWindow) return;
      try {
        iframe.contentWindow.postMessage(
          { type: "motion-preview", t, durationMs },
          "*",
        );
      } catch {
        // Best-effort preview; never throw.
      }
    },
    [canvasIframeRef, durationMs],
  );

  // ── Playback ─────────────────────────────────────────────────────────────
  const stopPlayback = useCallback(() => {
    if (playRafRef.current !== null) {
      cancelAnimationFrame(playRafRef.current);
      playRafRef.current = null;
    }
    playStartRef.current = null;
    setPlaying(false);
    // Pause/stop is a commit point: hand the final position to the parent.
    commitPlayhead();
  }, [commitPlayhead]);

  const startPlayback = useCallback(() => {
    stopPlayback();
    const startT = playhead >= 1 ? 0 : playhead;
    playStartRef.current = { wallMs: performance.now(), startT };
    setPlaying(true);

    // Loop and ping-pong run until explicitly paused; once stops at the end
    // (matching the compiled CSS's animation-iteration-count / -direction).
    const tick = (now: number) => {
      if (!playStartRef.current) return;
      const elapsed = now - playStartRef.current.wallMs;
      const progressed = playStartRef.current.startT + elapsed / durationMs;
      let t: number;
      let done = false;
      if (playbackMode === "loop") {
        t = progressed % 1;
      } else if (playbackMode === "ping-pong") {
        const phase = progressed % 2;
        t = phase <= 1 ? phase : 2 - phase;
      } else {
        t = Math.min(1, progressed);
        done = progressed >= 1;
      }
      setPlayheadLocal(t);
      sendPreview(t);
      if (!done) {
        playRafRef.current = requestAnimationFrame(tick);
      } else {
        stopPlayback();
      }
    };
    playRafRef.current = requestAnimationFrame(tick);
  }, [
    durationMs,
    playbackMode,
    playhead,
    sendPreview,
    setPlayheadLocal,
    stopPlayback,
  ]);

  useEffect(() => {
    return () => {
      if (playRafRef.current !== null) cancelAnimationFrame(playRafRef.current);
    };
  }, []);

  // ── Playhead drag ─────────────────────────────────────────────────────────
  const isDraggingPlayhead = useRef(false);

  const handleRulerPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!trackAreaRef.current) return;
      isDraggingPlayhead.current = true;
      stopPlayback();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const rect = trackAreaRef.current.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      setPlayheadLocal(t);
      sendPreview(t);
    },
    [sendPreview, setPlayheadLocal, stopPlayback],
  );

  const handleRulerPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!isDraggingPlayhead.current || !trackAreaRef.current) return;
      const rect = trackAreaRef.current.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      setPlayheadLocal(t);
      sendPreview(t);
    },
    [sendPreview, setPlayheadLocal],
  );

  const handleRulerPointerUp = useCallback(() => {
    if (!isDraggingPlayhead.current) return;
    isDraggingPlayhead.current = false;
    // Scrub end is a commit point.
    commitPlayhead();
  }, [commitPlayhead]);

  // ── Dock resize drag ─────────────────────────────────────────────────────
  const handleResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      resizingRef.current = true;
      setIsResizingDock(true);
      resizeStartRef.current = { y: e.clientY, h: dockHeight };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [dockHeight],
  );

  const handleResizePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!resizingRef.current || !resizeStartRef.current) return;
      const delta = resizeStartRef.current.y - e.clientY;
      setDockHeight(
        Math.max(MIN_DOCK_HEIGHT, resizeStartRef.current.h + delta),
      );
    },
    [],
  );

  const handleResizePointerUp = useCallback(() => {
    resizingRef.current = false;
    setIsResizingDock(false);
    resizeStartRef.current = null;
  }, []);

  // ── Keyframe helpers ─────────────────────────────────────────────────────
  const updateTrack = useCallback(
    (
      nodeId: string,
      property: string,
      updater: (track: MotionDockTrack) => MotionDockTrack,
    ) => {
      if (!onTracksChange) return;
      onTracksChange(
        tracks.map((tr) =>
          tr.targetNodeId === nodeId && tr.property === property
            ? updater(tr)
            : tr,
        ),
      );
    },
    [tracks, onTracksChange],
  );

  const addKeyframe = useCallback(
    (track: MotionDockTrack) => {
      // Map the timeline playhead into the track's own span (tracks may be
      // offset/scaled via delayMs/durationMs), then seed the new keyframe
      // with the track's interpolated value at that local time (what the
      // preview currently shows) — a hardcoded "0" is invalid CSS for
      // transform/filter/color tracks and snaps the preview.
      const localT = timelineTimeToTrackTime(
        track,
        playhead * durationMs,
        durationMs,
      );
      const sampled = sampleMotionKeyframesAt(
        track.keyframes,
        localT,
        defaultEase,
      );
      const newKf: MotionKeyframe = {
        t: localT,
        value: sampled || "0",
        ease: defaultEase,
      };
      updateTrack(track.targetNodeId, track.property, (tr) => ({
        ...tr,
        // Epsilon replace-at-time: adding at (nearly) the same playhead
        // position replaces the existing stop instead of stacking an
        // invisible duplicate diamond.
        keyframes: upsertMotionKeyframeAtTime(tr.keyframes, newKf),
      }));
    },
    [defaultEase, durationMs, playhead, updateTrack],
  );

  // ── Create a brand-new track (the "first track" path) ──────────────────────
  // This is the entry point that turns the dock from a dead end into a working
  // editor: with an element selected and no track yet, the user picks a property
  // preset and we seed a two-keyframe track. The parent autosaves that valid
  // track into managed CSS. Idempotent per (nodeId, property) — picking the same
  // property twice just re-expands the existing track instead of duplicating.
  const createTrack = useCallback(
    (preset: MotionPropertyPreset) => {
      if (!onTracksChange || !selectedTarget) return;
      const { nodeId, label } = selectedTarget;

      // Always expand the target layer so the new track row is visible.
      setExpandedNodeIds((prev) => {
        const next = new Set(prev);
        next.add(nodeId);
        return next;
      });

      if (hasTrackFor(tracks, nodeId, preset.property)) {
        // Track already exists — do not duplicate; the expand above surfaces
        // it, and an explicit notice explains why nothing new appeared (two
        // presets can target the same property, e.g. slide + scale are both
        // "transform").
        toast.info(
          t("designEditor.motion.trackExists", {
            property: preset.property,
            label,
          }),
        );
        return;
      }

      const seeded = createMotionTrackFromPreset(nodeId, preset, defaultEase);
      const newTrack: MotionDockTrack = { ...seeded, label };
      // Figma parity: brand-new timelines default to Loop. Existing
      // timelines keep whatever mode is already stamped/resolved.
      const nextTracks =
        tracks.length === 0
          ? withTimelinePlaybackMode([newTrack], "loop")
          : [...tracks, newTrack];
      onTracksChange(nextTracks);
      setSelectedTrackKey(trackKey(newTrack));
    },
    [defaultEase, onTracksChange, selectedTarget, tracks],
  );

  const deleteKeyframe = useCallback(
    (track: MotionDockTrack, index: number) => {
      if (!onTracksChange) return;
      if (track.keyframes.length <= 1) {
        // Deleting the last keyframe removes the whole track: a 0-keyframe
        // track cannot compile and is rejected by apply-motion-edit, which
        // would brick every subsequent autosave with no UI to recover.
        onTracksChange(
          tracks.filter(
            (tr) =>
              !(
                tr.targetNodeId === track.targetNodeId &&
                tr.property === track.property
              ),
          ),
        );
        return;
      }
      updateTrack(track.targetNodeId, track.property, (tr) => ({
        ...tr,
        keyframes: tr.keyframes.filter((_, i) => i !== index),
      }));
    },
    [onTracksChange, tracks, updateTrack],
  );

  const moveKeyframe = useCallback(
    (track: MotionDockTrack, index: number, newT: number) => {
      updateTrack(track.targetNodeId, track.property, (tr) => ({
        ...tr,
        keyframes: tr.keyframes.map((kf, i) =>
          i === index ? { ...kf, t: newT } : kf,
        ),
      }));
    },
    [updateTrack],
  );

  // Re-sort a track's keyframes once a drag finishes. Sorting DURING the drag
  // would reshuffle the dragged keyframe's index mid-gesture; the preview
  // bridge and compiler sort defensively, so drag-time order is safe.
  const moveKeyframeEnd = useCallback(
    (track: MotionDockTrack) => {
      updateTrack(track.targetNodeId, track.property, (tr) => ({
        ...tr,
        keyframes: sortMotionKeyframes(tr.keyframes),
      }));
    },
    [updateTrack],
  );

  const easeKeyframe = useCallback(
    (track: MotionDockTrack, index: number, ease: MotionEase) => {
      updateTrack(track.targetNodeId, track.property, (tr) => ({
        ...tr,
        keyframes: tr.keyframes.map((kf, i) =>
          i === index ? { ...kf, ease } : kf,
        ),
      }));
    },
    [updateTrack],
  );

  // ── Layer span-bar gestures (drag to offset, edge-drag to scale) ─────────
  // Given the layer's NEW span, remap every track of that layer
  // proportionally from the OLD span so per-track relative offsets survive.
  const updateLayerSpan = useCallback(
    (nodeId: string, nextSpan: { startMs: number; durationMs: number }) => {
      if (!onTracksChange) return;
      const timingsByKey = new Map<
        string,
        { startMs: number; endMs: number; durationMs: number }
      >();
      for (const tr of tracks) {
        if (tr.targetNodeId === nodeId) {
          timingsByKey.set(trackKey(tr), getMotionTrackTiming(tr, durationMs));
        }
      }
      if (timingsByKey.size === 0) return;
      const timings = [...timingsByKey.values()];
      const spanStart = Math.min(...timings.map((t) => t.startMs));
      const spanEnd = Math.max(...timings.map((t) => t.endMs));
      const spanDur = Math.max(1, spanEnd - spanStart);
      const factor = Math.max(0.01, nextSpan.durationMs / spanDur);
      onTracksChange(
        tracks.map((tr) => {
          const timing = timingsByKey.get(trackKey(tr));
          if (!timing) return tr;
          const startMs = Math.max(
            0,
            Math.round(
              nextSpan.startMs + (timing.startMs - spanStart) * factor,
            ),
          );
          const trackDur = Math.max(20, Math.round(timing.durationMs * factor));
          const out: MotionDockTrack = { ...tr };
          if (startMs > 0) out.delayMs = startMs;
          else delete out.delayMs;
          if (trackDur !== durationMs) out.durationMs = trackDur;
          else delete out.durationMs;
          return out;
        }),
      );
    },
    [durationMs, onTracksChange, tracks],
  );

  // ── Current-time field ────────────────────────────────────────────────────
  const commitTimeDraft = useCallback(() => {
    if (timeDraft === null) return;
    const ms = parseInt(timeDraft, 10);
    setTimeDraft(null);
    if (isNaN(ms)) return;
    const t = Math.max(0, Math.min(1, ms / durationMs));
    stopPlayback();
    setPlayheadLocal(t);
    commitPlayhead();
    sendPreview(t);
  }, [
    commitPlayhead,
    durationMs,
    sendPreview,
    setPlayheadLocal,
    stopPlayback,
    timeDraft,
  ]);

  // ── Duration field ────────────────────────────────────────────────────────
  const commitDurationDraft = useCallback(() => {
    const ms = parseInt(durationInput, 10);
    if (!isNaN(ms) && ms >= 50) {
      onDurationChange?.(ms);
    } else {
      setDurationInput(String(durationMs));
    }
  }, [durationInput, durationMs, onDurationChange]);

  // ── Space plays/pauses while the dock has focus (Figma parity) ───────────
  const handleDockKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) {
        return;
      }
      e.preventDefault();
      if (playing) stopPlayback();
      else startPlayback();
    },
    [playing, startPlayback, stopPlayback],
  );

  // ── Ruler tick marks (ms, nice steps — Figma-style ms ruler) ─────────────
  function rulerTicks(): { t: number; label: string }[] {
    const NICE_STEPS = [
      10, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000,
    ];
    // Plain loop (rather than Array#find with an inline arrow function) so a
    // `<=` comparison never sits directly after a `>` character — the i18n
    // raw-literal guard's regex heuristic treats `>...<` runs as JSX text.
    let step = Math.ceil(durationMs / 10);
    for (const candidate of NICE_STEPS) {
      if (durationMs / candidate <= 10) {
        step = candidate;
        break;
      }
    }
    const ticks: { t: number; label: string }[] = [];
    for (let ms = 0; ms <= durationMs; ms += step) {
      ticks.push({ t: ms / durationMs, label: formatMsTick(ms) });
    }
    return ticks;
  }

  // ── Group tracks by layer (nodeId) ────────────────────────────────────────
  type LayerGroup = {
    nodeId: string;
    label: string;
    tracks: MotionDockTrack[];
  };
  const layers: LayerGroup[] = tracks.reduce<LayerGroup[]>((acc, track) => {
    const existing = acc.find((g) => g.nodeId === track.targetNodeId);
    if (existing) {
      existing.tracks.push(track);
    } else {
      acc.push({
        nodeId: track.targetNodeId,
        label: track.label,
        tracks: [track],
      });
    }
    return acc;
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        "design-motion-dock-space relative shrink-0 overflow-visible",
        isResizingDock && "design-motion-dock-resizing",
      )}
      onTransitionEnd={handleDockTransitionEnd}
      style={{ height: isOpen ? dockHeight : 0 }}
    >
      <div
        aria-label={t("designEditor.motion.dockLabel")}
        aria-hidden={!isOpen ? true : undefined}
        // Focusable so Space can play/pause while the dock is focused
        // (Figma parity); -1 keeps it out of the tab order.
        tabIndex={-1}
        onKeyDown={handleDockKeyDown}
        className={cn(
          "design-motion-dock absolute inset-x-0 bottom-0 z-40 flex min-h-0 transform-gpu flex-col overflow-hidden border-t bg-background outline-none select-none",
          isOpen
            ? "translate-y-0 border-border opacity-100"
            : "translate-y-full border-transparent pointer-events-none",
        )}
        style={{ height: dockHeight }}
      >
        {/* Resize handle */}
        <div
          className="absolute -top-1 left-0 right-0 h-2 cursor-ns-resize z-10"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
        />

        {/* Dock toolbar */}
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
          {/* Collapse toggle. The rail owns the visible Motion label. */}
          <button
            type="button"
            className="-ml-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
            onClick={() => setOpen(false)}
            aria-label={t("designEditor.motion.collapseDock")}
          >
            <IconChevronDown className="size-3.5" />
          </button>

          <>
            {/* Play / Pause */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  onClick={playing ? stopPlayback : startPlayback}
                  aria-label={
                    playing
                      ? t("designEditor.motion.pause")
                      : t("designEditor.motion.play")
                  }
                >
                  {playing ? (
                    <IconPlayerPause className="size-3.5" />
                  ) : (
                    <IconPlayerPlay className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {playing
                  ? t("designEditor.motion.pause")
                  : t("designEditor.motion.play")}
              </TooltipContent>
            </Tooltip>

            {/* Stop / reset */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  onClick={() => {
                    stopPlayback();
                    setPlayheadLocal(0);
                    commitPlayhead();
                    sendPreview(0);
                  }}
                  aria-label={t("designEditor.motion.resetPlayhead")}
                >
                  <IconPlayerStop className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {t("designEditor.motion.reset")}
              </TooltipContent>
            </Tooltip>

            {/* Add keyframe at playhead (selected property row) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0"
                    disabled={!selectedTrack}
                    onClick={() => {
                      if (selectedTrack) addKeyframe(selectedTrack);
                    }}
                    aria-label={t("designEditor.motion.addKeyframeAtPlayhead")}
                  >
                    <IconDiamondFilled className="size-3" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {selectedTrack
                  ? t("designEditor.motion.addKeyframeAtPlayheadForProperty", {
                      property: selectedTrack.property,
                    })
                  : t("designEditor.motion.selectPropertyRowFirst")}
              </TooltipContent>
            </Tooltip>

            {/* Current time (ms) — click to jump the playhead */}
            <div className="flex items-center gap-1 ml-1">
              <Input
                type="number"
                min={0}
                max={durationMs}
                step={10}
                value={timeDraft ?? String(Math.round(playhead * durationMs))}
                onFocus={() =>
                  setTimeDraft(String(Math.round(playhead * durationMs)))
                }
                onChange={(e) => setTimeDraft(e.target.value)}
                onBlur={() => {
                  if (skipNextTimeBlurCommitRef.current) {
                    skipNextTimeBlurCommitRef.current = false;
                    return;
                  }
                  commitTimeDraft();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitTimeDraft();
                    // Without this, the blur triggered below re-enters
                    // commitTimeDraft() a second time in the same
                    // synchronous tick (see motionFieldKeyRequiresBlurGuard).
                    skipNextTimeBlurCommitRef.current =
                      motionFieldKeyRequiresBlurGuard(e.key);
                    (e.target as HTMLInputElement).blur();
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    // Cancel the in-progress edit — revert to displaying the
                    // live playhead instead of committing the draft.
                    setTimeDraft(null);
                    skipNextTimeBlurCommitRef.current =
                      motionFieldKeyRequiresBlurGuard(e.key);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="h-5 w-14 px-1 !text-[11px] md:!text-[11px]"
                aria-label={t("designEditor.motion.currentTimeMs")}
              />
              <span className="text-[10px] text-muted-foreground">/</span>
            </div>

            {/* Duration */}
            <div className="flex items-center gap-1 ml-1">
              <span className="text-[10px] text-muted-foreground">
                {t("designEditor.motion.duration")}
              </span>
              <Input
                type="number"
                min={50}
                step={50}
                value={durationInput}
                onChange={(e) => setDurationInput(e.target.value)}
                onBlur={() => {
                  if (skipNextDurationBlurCommitRef.current) {
                    skipNextDurationBlurCommitRef.current = false;
                    return;
                  }
                  commitDurationDraft();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitDurationDraft();
                    // Same double-commit guard as the current-time field —
                    // see motionFieldKeyRequiresBlurGuard.
                    skipNextDurationBlurCommitRef.current =
                      motionFieldKeyRequiresBlurGuard(e.key);
                    (e.target as HTMLInputElement).blur();
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    // Cancel the in-progress edit — revert to the last
                    // committed duration instead of persisting the draft.
                    setDurationInput(String(durationMs));
                    skipNextDurationBlurCommitRef.current =
                      motionFieldKeyRequiresBlurGuard(e.key);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="h-5 w-16 px-1 !text-[11px] md:!text-[11px]"
                aria-label={t("designEditor.motion.durationMs")}
              />
              <span className="text-[10px] text-muted-foreground">ms</span>
            </div>

            {/* Playback mode — cycling button (Loop / Once / Ping-pong) */}
            {(() => {
              const current =
                PLAYBACK_MODES.find((m) => m.mode === playbackMode) ??
                PLAYBACK_MODES[0];
              const ModeIcon = current.Icon;
              const modeLabel = t(`designEditor.motion.${current.labelKey}`);
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0"
                      onClick={cyclePlaybackMode}
                      aria-label={t("designEditor.motion.playbackMode", {
                        mode: modeLabel,
                      })}
                    >
                      <ModeIcon className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {t("designEditor.motion.playback", { mode: modeLabel })}
                  </TooltipContent>
                </Tooltip>
              );
            })()}

            {/* Add motion — the "create first track" entry point. */}
            <div className="ml-2">
              <AddTrackMenu
                selectedTarget={selectedTarget}
                onCreateTrack={createTrack}
              />
            </div>

            <div className="ml-auto flex items-center gap-1">
              {/* Auto-keyframe toggle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={autoKeyframe ? "secondary" : "ghost"}
                    size="icon"
                    className={cn(
                      "size-6 shrink-0",
                      autoKeyframe && "text-primary",
                    )}
                    onClick={() => setAutoKeyframe((v) => !v)}
                    aria-label={t("designEditor.motion.toggleAutoKeyframe")}
                    aria-pressed={autoKeyframe}
                  >
                    <IconBolt className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {t("designEditor.motion.autoKeyframe")}
                </TooltipContent>
              </Tooltip>

              {applying ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      role="status"
                      aria-label={t("designEditor.motion.savingMotion")}
                      className="flex size-6 items-center justify-center rounded text-muted-foreground"
                    >
                      <IconRefresh className="size-3 animate-spin" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {t("designEditor.motion.savingMotion")}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </>
        </div>

        {/* Dock body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Layer sidebar */}
          <div
            className="flex flex-col shrink-0 border-r border-border overflow-y-auto"
            style={{ width: LAYER_SIDEBAR_WIDTH }}
          >
            {/* Ruler spacer */}
            <div
              style={{ height: RULER_HEIGHT }}
              className="border-b border-border"
            />

            {layers.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-4 py-6">
                <IconLayersSubtract className="size-5 text-muted-foreground/40" />
                {selectedTarget ? (
                  <>
                    <p className="!text-[11px] text-muted-foreground/70 leading-snug">
                      {t("designEditor.motion.emptyStateAnimate")}{" "}
                      <span className="font-medium text-foreground/80">
                        {selectedTarget.label}
                      </span>
                      {t("designEditor.motion.emptyStatePickProperty")}
                    </p>
                    <AddTrackMenu
                      selectedTarget={selectedTarget}
                      onCreateTrack={createTrack}
                      variant="cta"
                    />
                  </>
                ) : (
                  <p className="!text-[11px] text-muted-foreground/70 leading-snug">
                    {t("designEditor.motion.emptyStateNoSelection")}
                  </p>
                )}
              </div>
            ) : (
              layers.map((layer) => (
                <LayerGroup
                  key={layer.nodeId}
                  layer={layer}
                  expanded={expandedNodeIds.has(layer.nodeId)}
                  onToggleExpand={() =>
                    setExpandedNodeIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(layer.nodeId)) next.delete(layer.nodeId);
                      else next.add(layer.nodeId);
                      return next;
                    })
                  }
                  onAddKeyframe={(track) => addKeyframe(track)}
                  selectedTrackKey={selectedTrackKey}
                  onSelectTrack={(track) =>
                    setSelectedTrackKey(trackKey(track))
                  }
                />
              ))
            )}
          </div>

          {/* Timeline / track area */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Ruler + playhead drag */}
            <div
              ref={trackAreaRef}
              className="relative shrink-0 border-b border-border cursor-col-resize"
              style={{ height: RULER_HEIGHT }}
              onPointerDown={handleRulerPointerDown}
              onPointerMove={handleRulerPointerMove}
              onPointerUp={handleRulerPointerUp}
            >
              {/* Tick marks */}
              {rulerTicks().map(({ t, label }) => (
                <div
                  key={t}
                  className="absolute top-0 flex flex-col items-center pointer-events-none"
                  style={{ left: `${t * 100}%`, transform: "translateX(-50%)" }}
                >
                  <span className="text-[9px] text-muted-foreground/60 leading-none mt-1">
                    {label}
                  </span>
                  <div className="w-px h-2 bg-border mt-0.5" />
                </div>
              ))}

              {/* Playhead */}
              <PlayheadLine t={playhead} height={RULER_HEIGHT} inRuler />
            </div>

            {/* Track rows with keyframe diamonds */}
            <div className="relative flex-1 overflow-y-auto">
              {layers.map((layer) => (
                <LayerTrackRows
                  key={layer.nodeId}
                  layer={layer}
                  expanded={expandedNodeIds.has(layer.nodeId)}
                  playhead={playhead}
                  timelineDurationMs={durationMs}
                  defaultEase={defaultEase}
                  selectedTrackKey={selectedTrackKey}
                  onSelectTrack={(track) =>
                    setSelectedTrackKey(trackKey(track))
                  }
                  onDeleteKeyframe={deleteKeyframe}
                  onMoveKeyframe={moveKeyframe}
                  onMoveKeyframeEnd={moveKeyframeEnd}
                  onEaseKeyframe={easeKeyframe}
                  onLayerSpanChange={updateLayerSpan}
                />
              ))}

              {/* Playhead across track rows */}
              <PlayheadLine
                t={playhead}
                height={layers.reduce(
                  (sum, layer) =>
                    sum +
                    ROW_HEIGHT +
                    (expandedNodeIds.has(layer.nodeId)
                      ? layer.tracks.length * ROW_HEIGHT
                      : 0),
                  0,
                )}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

interface AddTrackMenuProps {
  selectedTarget: { nodeId: string; label: string } | null;
  onCreateTrack: (preset: MotionPropertyPreset) => void;
  /** "toolbar" (compact button) or "cta" (prominent empty-state button). */
  variant?: "toolbar" | "cta";
}

/**
 * "Add motion" dropdown — creates a new motion track for the selected
 * element. Matches Figma Motion's submenu verbatim: Position / Scale /
 * Rotation / Opacity directly, with the remaining keyframeable properties
 * under a "More" submenu (Corner radius, Fill, Stroke paint, Stroke weight,
 * Drop shadow). Disabled (with a hint) when nothing is selected, which is
 * the only state where a first track cannot be created.
 */
function AddTrackMenu({
  selectedTarget,
  onCreateTrack,
  variant = "toolbar",
}: AddTrackMenuProps) {
  const t = useT();
  const disabled = !selectedTarget;
  const addMotionLabel = t("designEditor.motion.addMotion");
  const trigger =
    variant === "cta" ? (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-7 gap-1 !text-[11px]"
        disabled={disabled}
      >
        <IconPlus className="size-3.5" />
        {addMotionLabel}
      </Button>
    ) : (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 gap-1 px-2 !text-[11px]"
        disabled={disabled}
      >
        <IconPlus className="size-3.5" />
        {addMotionLabel}
      </Button>
    );

  // When disabled, render a tooltip-wrapped static button instead of a menu so
  // the user learns they need a selection first.
  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{trigger}</span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {t("designEditor.motion.selectElementFirst")}
        </TooltipContent>
      </Tooltip>
    );
  }

  const primaryPresets = MOTION_PROPERTY_PRESETS.filter(
    (preset) => preset.group === "primary",
  );
  const morePresets = MOTION_PROPERTY_PRESETS.filter(
    (preset) => preset.group === "more",
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 p-1">
        <DropdownMenuLabel className="truncate px-2 py-1 text-[10px] font-medium leading-none text-muted-foreground">
          {t("designEditor.motion.animateLayer", {
            label: selectedTarget.label,
          })}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-1" />
        {primaryPresets.map((preset) => (
          <DropdownMenuItem
            key={`${preset.property}-${preset.label}`}
            className="h-7 px-2 text-[12px] leading-none"
            onSelect={() => onCreateTrack(preset)}
          >
            {preset.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="h-7 px-2 text-[12px] leading-none">
            {t("designEditor.motion.more")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44 p-1">
            {morePresets.map((preset) => (
              <DropdownMenuItem
                key={`${preset.property}-${preset.label}`}
                className="h-7 px-2 text-[12px] leading-none"
                onSelect={() => onCreateTrack(preset)}
              >
                {preset.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface PlayheadLineProps {
  t: number;
  height: number;
  inRuler?: boolean;
}

function PlayheadLine({ t, height, inRuler }: PlayheadLineProps) {
  return (
    <div
      className={cn(
        "absolute top-0 pointer-events-none z-10",
        inRuler ? "bg-primary/80" : "bg-primary/60",
      )}
      style={{
        left: `${t * 100}%`,
        width: PLAYHEAD_WIDTH,
        height,
        transform: "translateX(-50%)",
      }}
    >
      {inRuler && (
        <div className="absolute -top-0 left-1/2 -translate-x-1/2 size-2 rounded-sm bg-primary" />
      )}
    </div>
  );
}

interface LayerGroupProps {
  layer: { nodeId: string; label: string; tracks: MotionDockTrack[] };
  expanded: boolean;
  onToggleExpand: () => void;
  onAddKeyframe: (track: MotionDockTrack) => void;
  /** Key of the selected property row (toolbar ◆ target). */
  selectedTrackKey: string | null;
  onSelectTrack: (track: MotionDockTrack) => void;
}

function LayerGroup({
  layer,
  expanded,
  onToggleExpand,
  onAddKeyframe,
  selectedTrackKey,
  onSelectTrack,
}: LayerGroupProps) {
  const t = useT();
  return (
    <>
      {/* Layer header row */}
      <div
        className="flex items-center gap-1 px-2 hover:bg-accent/40 cursor-pointer"
        style={{ height: ROW_HEIGHT }}
        onClick={onToggleExpand}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggleExpand();
        }}
        aria-expanded={expanded}
      >
        <span className="shrink-0 text-muted-foreground">
          {expanded ? (
            <IconChevronDown className="size-3" />
          ) : (
            <IconChevronRight className="size-3" />
          )}
        </span>
        <span
          className="flex-1 truncate !text-[11px] font-medium"
          title={layer.label}
        >
          {layer.label}
        </span>
      </div>

      {/* Property sub-rows — click to select (toolbar ◆ keys the selection) */}
      {expanded &&
        layer.tracks.map((track) => (
          <div
            key={`${track.targetNodeId}-${track.property}`}
            className={cn(
              "group flex items-center gap-1 pl-5 pr-2 cursor-pointer hover:bg-accent/20",
              trackKey(track) === selectedTrackKey && "bg-accent/40",
            )}
            style={{ height: ROW_HEIGHT }}
            role="button"
            tabIndex={0}
            onClick={() => onSelectTrack(track)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelectTrack(track);
            }}
            aria-pressed={trackKey(track) === selectedTrackKey}
          >
            <IconDiamond className="size-2.5 shrink-0 text-primary/70" />
            <span className="flex-1 truncate text-[10px] text-muted-foreground">
              {track.property}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5 shrink-0 opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddKeyframe(track);
                  }}
                  aria-label={t("designEditor.motion.addKeyframe")}
                >
                  <IconPlus className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {t("designEditor.motion.addKeyframeAtPlayhead")}
              </TooltipContent>
            </Tooltip>
          </div>
        ))}
    </>
  );
}

interface LayerTrackRowsProps {
  layer: { nodeId: string; label: string; tracks: MotionDockTrack[] };
  expanded: boolean;
  playhead: number;
  timelineDurationMs: number;
  defaultEase: MotionEase;
  selectedTrackKey: string | null;
  onSelectTrack: (track: MotionDockTrack) => void;
  onDeleteKeyframe: (track: MotionDockTrack, index: number) => void;
  onMoveKeyframe: (track: MotionDockTrack, index: number, newT: number) => void;
  onMoveKeyframeEnd: (track: MotionDockTrack) => void;
  onEaseKeyframe: (
    track: MotionDockTrack,
    index: number,
    ease: MotionEase,
  ) => void;
  /** Layer span-bar gesture commit: drag to offset, edge-drag to scale. */
  onLayerSpanChange: (
    nodeId: string,
    span: { startMs: number; durationMs: number },
  ) => void;
}

function LayerTrackRows({
  layer,
  expanded,
  playhead: _playhead,
  timelineDurationMs,
  defaultEase,
  selectedTrackKey,
  onSelectTrack,
  onDeleteKeyframe,
  onMoveKeyframe,
  onMoveKeyframeEnd,
  onEaseKeyframe,
  onLayerSpanChange,
}: LayerTrackRowsProps) {
  // Layer span = earliest track start … latest track end (Figma's parent
  // layer bar). Dragging it offsets every track; edge handles scale them.
  const timings = layer.tracks.map((track) =>
    getMotionTrackTiming(track, timelineDurationMs),
  );
  const spanStartMs =
    timings.length > 0 ? Math.min(...timings.map((t) => t.startMs)) : 0;
  const spanEndMs =
    timings.length > 0
      ? Math.max(...timings.map((t) => t.endMs))
      : timelineDurationMs;

  return (
    <>
      {/* Layer header row: the draggable span bar */}
      <div
        className="relative border-b border-border/40"
        style={{ height: ROW_HEIGHT }}
      >
        {layer.tracks.length > 0 && (
          <LayerSpanBar
            spanStartMs={spanStartMs}
            spanEndMs={spanEndMs}
            timelineDurationMs={timelineDurationMs}
            label={layer.label}
            onSpanChange={(span) => onLayerSpanChange(layer.nodeId, span)}
          />
        )}
      </div>

      {/* Property track rows */}
      {expanded &&
        layer.tracks.map((track) => (
          <TrackRow
            key={`${track.targetNodeId}-${track.property}`}
            track={track}
            timelineDurationMs={timelineDurationMs}
            defaultEase={defaultEase}
            selected={trackKey(track) === selectedTrackKey}
            onSelect={() => onSelectTrack(track)}
            onDeleteKeyframe={(index) => onDeleteKeyframe(track, index)}
            onMoveKeyframe={(index, newT) => onMoveKeyframe(track, index, newT)}
            onMoveKeyframeEnd={() => onMoveKeyframeEnd(track)}
            onEaseKeyframe={(index, ease) => onEaseKeyframe(track, index, ease)}
          />
        ))}
    </>
  );
}

// ─── Layer span bar (drag = offset, edge-drag = scale) ────────────────────────

interface LayerSpanBarProps {
  spanStartMs: number;
  spanEndMs: number;
  timelineDurationMs: number;
  label: string;
  onSpanChange: (span: { startMs: number; durationMs: number }) => void;
}

function LayerSpanBar({
  spanStartMs,
  spanEndMs,
  timelineDurationMs,
  label,
  onSpanChange,
}: LayerSpanBarProps) {
  const t = useT();
  const barRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    kind: "move" | "left" | "right";
    startX: number;
    startMs: number;
    durMs: number;
    pxPerMs: number;
  } | null>(null);

  const beginGesture = useCallback(
    (e: ReactPointerEvent<HTMLElement>, kind: "move" | "left" | "right") => {
      const row = barRef.current?.parentElement;
      if (!row) return;
      e.stopPropagation();
      const rect = row.getBoundingClientRect();
      if (rect.width <= 0) return;
      gesture.current = {
        kind,
        startX: e.clientX,
        startMs: spanStartMs,
        durMs: Math.max(1, spanEndMs - spanStartMs),
        pxPerMs: rect.width / timelineDurationMs,
      };
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [spanEndMs, spanStartMs, timelineDurationMs],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g) return;
      const deltaMs = (e.clientX - g.startX) / g.pxPerMs;
      if (g.kind === "move") {
        const maxStart = Math.max(0, timelineDurationMs - g.durMs);
        const startMs = Math.min(Math.max(0, g.startMs + deltaMs), maxStart);
        onSpanChange({ startMs, durationMs: g.durMs });
      } else if (g.kind === "right") {
        const durationMs = Math.max(
          50,
          Math.min(g.durMs + deltaMs, timelineDurationMs - g.startMs),
        );
        onSpanChange({ startMs: g.startMs, durationMs });
      } else {
        const endMs = g.startMs + g.durMs;
        const startMs = Math.max(0, Math.min(g.startMs + deltaMs, endMs - 50));
        onSpanChange({ startMs, durationMs: endMs - startMs });
      }
    },
    [onSpanChange, timelineDurationMs],
  );

  const endGesture = useCallback(() => {
    gesture.current = null;
  }, []);

  const leftPct = (spanStartMs / timelineDurationMs) * 100;
  const widthPct = Math.max(
    0.5,
    ((spanEndMs - spanStartMs) / timelineDurationMs) * 100,
  );

  return (
    <div
      ref={barRef}
      className="group absolute top-1/2 h-4 -translate-y-1/2 cursor-grab active:cursor-grabbing rounded-sm bg-primary/20 hover:bg-primary/30 border border-primary/40"
      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      onPointerDown={(e) => beginGesture(e, "move")}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      role="slider"
      aria-label={t("designEditor.motion.layerAnimationSpan", { label })}
      aria-valuemin={0}
      aria-valuemax={timelineDurationMs}
      aria-valuenow={Math.round(spanStartMs)}
      aria-valuetext={`${Math.round(spanStartMs)}ms – ${Math.round(spanEndMs)}ms`}
      tabIndex={-1}
    >
      {/* Edge handles: scale the layer's animations */}
      <div
        className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-sm bg-primary/50 opacity-0 group-hover:opacity-100"
        onPointerDown={(e) => beginGesture(e, "left")}
      />
      <div
        className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-sm bg-primary/50 opacity-0 group-hover:opacity-100"
        onPointerDown={(e) => beginGesture(e, "right")}
      />
    </div>
  );
}

interface TrackRowProps {
  track: MotionDockTrack;
  timelineDurationMs: number;
  defaultEase: MotionEase;
  selected: boolean;
  onSelect: () => void;
  onDeleteKeyframe: (index: number) => void;
  onMoveKeyframe: (index: number, newT: number) => void;
  onMoveKeyframeEnd: () => void;
  onEaseKeyframe: (index: number, ease: MotionEase) => void;
}

function TrackRow({
  track,
  timelineDurationMs,
  defaultEase,
  selected,
  onSelect,
  onDeleteKeyframe,
  onMoveKeyframe,
  onMoveKeyframeEnd,
  onEaseKeyframe,
}: TrackRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  // The track's own span within the timeline (delayMs/durationMs offsets).
  // Keyframe t is normalised to THIS span; positions on the ruler are
  // (startMs + t * span) / timelineDurationMs.
  const timing = getMotionTrackTiming(track, timelineDurationMs);
  const fractionFor = (kfT: number) =>
    (timing.startMs + kfT * timing.durationMs) / timelineDurationMs;

  // Identify the dragged keyframe by its INDEX in track.keyframes, not object
  // identity: the parent replaces keyframe objects on every move (immutable
  // update), so a captured object reference goes stale after the first move
  // and every subsequent pointermove would match nothing (frozen keyframe).
  const dragging = useRef<{
    index: number;
    startX: number;
    startT: number;
    moved: boolean;
  } | null>(null);

  const handleDiamondPointerDown = useCallback(
    (
      e: ReactPointerEvent<SVGSVGElement>,
      index: number,
      kf: MotionKeyframe,
    ) => {
      e.stopPropagation();
      onSelect();
      dragging.current = {
        index,
        startX: e.clientX,
        startT: kf.t,
        moved: false,
      };
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [onSelect],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current || !rowRef.current) return;
      const rect = rowRef.current.getBoundingClientRect();
      const dx = e.clientX - dragging.current.startX;
      // Pixel delta → timeline fraction → track-local time delta.
      const dt = (dx / rect.width) * (timelineDurationMs / timing.durationMs);
      const newT = Math.max(0, Math.min(1, dragging.current.startT + dt));
      dragging.current.moved = true;
      onMoveKeyframe(dragging.current.index, newT);
    },
    [onMoveKeyframe, timelineDurationMs, timing.durationMs],
  );

  const handlePointerUp = useCallback(() => {
    const wasMoved = dragging.current?.moved === true;
    dragging.current = null;
    // Only re-sort (and re-mark dirty) when the keyframe actually moved — a
    // plain click on a diamond must not trigger an autosave.
    if (wasMoved) onMoveKeyframeEnd();
  }, [onMoveKeyframeEnd]);

  // Segments connect consecutive keyframes; clicking one opens the easing
  // panel for the transition (stored on the LEAVING keyframe, CSS-style).
  const orderedIndices = track.keyframes
    .map((kf, index) => ({ t: kf.t, index }))
    .sort((a, b) => a.t - b.t)
    .map((entry) => entry.index);

  return (
    <div
      ref={rowRef}
      className={cn(
        "relative border-b border-border/30",
        selected && "bg-accent/20",
      )}
      style={{ height: ROW_HEIGHT }}
      onClick={onSelect}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Track baseline */}
      <div className="absolute inset-y-1/2 left-0 right-0 h-px bg-border/50" />

      {/* Easing segments between consecutive keyframes */}
      {orderedIndices.slice(0, -1).map((kfIndex, order) => {
        const from = track.keyframes[kfIndex];
        const to = track.keyframes[orderedIndices[order + 1]];
        if (!from || !to) return null;
        const left = fractionFor(from.t);
        const width = Math.max(0, fractionFor(to.t) - left);
        return (
          <EasingSegment
            key={`segment-${kfIndex}`}
            left={left}
            width={width}
            ease={from.ease}
            defaultEase={defaultEase}
            onEaseChange={(ease) => onEaseKeyframe(kfIndex, ease)}
          />
        );
      })}

      {/* Keyframe diamonds */}
      {track.keyframes.map((kf, i) => (
        <KeyframeDiamond
          key={i}
          kf={kf}
          leftFraction={fractionFor(kf.t)}
          timeMs={Math.round(timing.startMs + kf.t * timing.durationMs)}
          onPointerDown={(e) => handleDiamondPointerDown(e, i, kf)}
          onDelete={() => onDeleteKeyframe(i)}
        />
      ))}
    </div>
  );
}

interface KeyframeDiamondProps {
  kf: MotionKeyframe;
  /** Horizontal position as a fraction of the whole timeline (offset-aware). */
  leftFraction: number;
  /** Absolute keyframe time on the timeline, ms (for the tooltip). */
  timeMs: number;
  onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onDelete: () => void;
}

/**
 * Draggable keyframe diamond. Easing is edited on the SEGMENT between two
 * diamonds (click the connecting bar), matching Figma Motion.
 */
function KeyframeDiamond({
  kf,
  leftFraction,
  timeMs,
  onPointerDown,
  onDelete,
}: KeyframeDiamondProps) {
  const t = useT();
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 group"
      style={{ left: `${leftFraction * 100}%` }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <svg
            width={10}
            height={10}
            viewBox="0 0 10 10"
            className="cursor-grab active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            aria-label={t("designEditor.motion.keyframeAt", { ms: timeMs })}
          >
            <rect
              x={1}
              y={1}
              width={8}
              height={8}
              rx={1}
              transform="rotate(45 5 5)"
              className={cn(
                "transition-colors",
                hovered
                  ? "fill-primary stroke-primary-foreground"
                  : "fill-primary/70 stroke-primary/30",
              )}
              strokeWidth={1}
            />
          </svg>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="flex items-center gap-1 text-[10px]"
        >
          <span>
            {timeMs}ms — {kf.value}
          </span>
          <button
            type="button"
            className="ml-1 text-destructive hover:text-destructive/80"
            onClick={onDelete}
            aria-label={t("designEditor.motion.deleteKeyframe")}
          >
            <IconTrash className="size-3" />
          </button>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// ─── Segment easing (click the connector between two keyframes) ──────────────

interface EasingSegmentProps {
  /** Left edge as a fraction of the timeline. */
  left: number;
  /** Width as a fraction of the timeline. */
  width: number;
  /** The LEAVING keyframe's ease (undefined = timeline default). */
  ease: MotionEase | undefined;
  defaultEase: MotionEase;
  onEaseChange: (ease: MotionEase) => void;
}

/**
 * The clickable bar between two keyframe diamonds. Opens the easing panel
 * (Curve / Spring tabs) for the transition into the next keyframe — matching
 * Figma Motion's "click the connecting line" flow.
 */
function EasingSegment({
  left,
  width,
  ease,
  defaultEase,
  onEaseChange,
}: EasingSegmentProps) {
  const t = useT();
  const effective = ease ?? defaultEase;
  const effectiveLabel = easeLabel(effective, t);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="absolute top-1/2 h-1.5 -translate-y-1/2 cursor-pointer rounded-full bg-primary/25 hover:bg-primary/50 data-[state=open]:bg-primary/60"
          style={{
            left: `${left * 100}%`,
            width: `${width * 100}%`,
            minWidth: 8,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={t("designEditor.motion.segmentEasing", {
            ease: effectiveLabel,
          })}
          title={effectiveLabel}
        />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-60 p-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <EasingPanel ease={effective} onChange={onEaseChange} />
      </PopoverContent>
    </Popover>
  );
}

// ─── Easing panel (Curve / Spring tabs) ───────────────────────────────────────

interface EasingPanelProps {
  ease: MotionEase;
  onChange: (ease: MotionEase) => void;
}

/**
 * Figma-Motion-parity easing editor:
 * - Curve tab: Hold, Linear, Ease in/out variants, back curves, and Custom
 *   bezier with editable x1,y1,x2,y2 + a draggable curve editor.
 * - Spring tab: Gentle / Quick / Bouncy / Slow presets and Custom spring
 *   with a single Bounce control (0–1, default 0.25).
 */
function EasingPanel({ ease, onChange }: EasingPanelProps) {
  const t = useT();
  const easeStr = String(ease);
  const spring = parseSpringToken(easeStr);
  const [tab, setTab] = useState<"curve" | "spring">(
    spring ? "spring" : "curve",
  );

  const isCurvePreset = MOTION_CURVE_PRESETS.some(
    (preset) => preset.value === easeStr,
  );
  const bezierMatch = /^cubic-bezier\(([^)]+)\)$/.exec(easeStr);
  const bezierPoints: [number, number, number, number] = (() => {
    if (bezierMatch) {
      const parts = bezierMatch[1].split(",").map((part) => parseFloat(part));
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        return [parts[0], parts[1], parts[2], parts[3]];
      }
    }
    return [0.42, 0, 0.58, 1];
  })();
  const isCustomBezier = bezierMatch !== null && !isCurvePreset;

  const springPreset = MOTION_SPRING_PRESETS.find(
    (preset) => preset.value === easeStr,
  );
  const isCustomSpring = spring !== null && !springPreset;
  const bounce = spring?.bounce ?? MOTION_SPRING_DEFAULT_BOUNCE;
  const settle = spring?.settle ?? 1;

  const itemClass = (active: boolean) =>
    cn(
      "flex h-6 w-full cursor-pointer items-center gap-1 rounded px-2 text-left text-[11px] leading-none hover:bg-accent",
      active && "font-medium",
    );
  const checkClass = (active: boolean) =>
    cn("size-3 shrink-0", active ? "opacity-100" : "opacity-0");

  return (
    <div className="flex flex-col gap-2">
      {/* Pill tab switch: Curve | Spring */}
      <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
        {(
          [
            ["curve", t("designEditor.motion.curveTab")],
            ["spring", t("designEditor.motion.springTab")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={cn(
              "flex-1 cursor-pointer rounded px-2 py-1 text-[11px] leading-none",
              tab === key
                ? "bg-background font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "curve" ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col">
            {MOTION_CURVE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={itemClass(preset.value === easeStr)}
                onClick={() => onChange(preset.value)}
              >
                <IconCheck className={checkClass(preset.value === easeStr)} />
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className={itemClass(isCustomBezier)}
              onClick={() =>
                onChange(
                  `cubic-bezier(${bezierPoints
                    .map((n) => Math.round(n * 100) / 100)
                    .join(", ")})`,
                )
              }
            >
              <IconCheck className={checkClass(isCustomBezier)} />
              {t("designEditor.motion.customBezier")}
            </button>
          </div>
          {isCustomBezier && (
            <CurveEditor
              value={bezierPoints}
              onChange={(points) =>
                onChange(
                  `cubic-bezier(${points
                    .map((n) => Math.round(n * 100) / 100)
                    .join(", ")})`,
                )
              }
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col">
            {MOTION_SPRING_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={itemClass(preset.value === easeStr)}
                onClick={() => onChange(preset.value)}
              >
                <IconCheck className={checkClass(preset.value === easeStr)} />
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className={itemClass(isCustomSpring)}
              onClick={() =>
                onChange(
                  springToken({
                    bounce: MOTION_SPRING_DEFAULT_BOUNCE,
                    settle: 1,
                  }),
                )
              }
            >
              <IconCheck className={checkClass(isCustomSpring)} />
              {t("designEditor.motion.customSpring")}
            </button>
          </div>
          {isCustomSpring && (
            <div className="flex flex-col gap-1 px-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {t("designEditor.motion.bounce")}
                </span>
                <span className="text-[10px] tabular-nums">
                  {bounce.toFixed(2)}
                </span>
              </div>
              <Slider
                value={[bounce]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={(values) =>
                  onChange(springToken({ bounce: values[0] ?? bounce, settle }))
                }
                aria-label={t("designEditor.motion.bounce")}
              />
            </div>
          )}
          {spring !== null && (
            <SpringCurvePreview bounce={bounce} settle={settle} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Custom bezier curve editor (draggable control points) ────────────────────

const CURVE_W = 216;
const CURVE_H = 132;
const CURVE_PAD = 10;
// Vertical view range: y ∈ [-0.25, 1.25] so overshoot handles stay visible.
const CURVE_Y_MIN = -0.25;
const CURVE_Y_MAX = 1.25;

interface CurveEditorProps {
  value: [number, number, number, number];
  onChange: (value: [number, number, number, number]) => void;
}

/** Format a bezier control-point axis value for display (2 decimal places). */
export function formatCurveAxisValue(n: number): string {
  return String(Math.round(n * 100) / 100);
}

interface CurveNumberFieldProps {
  label: string;
  value: number;
  onChange: (n: number) => void;
}

/**
 * One x1/y1/x2/y2 control-point number field in the bezier CurveEditor.
 * Keeps its own draft string instead of being fully controlled by
 * `formatCurveAxisValue(value)` so a user can type an in-progress value
 * ("-", "0.", "1.5") without the field snapping back to the last-committed,
 * rounded value on every keystroke. A prior version bound `value` directly to
 * the rounded prop: typing "0" then "." called onChange(0) (parseFloat("0.")
 * is a finite 0), which re-rendered the field back to "0" and silently
 * dropped the "." the instant it was typed — decimals (and a bare "-" before
 * a negative number) could never be entered. Mirrors the `focusedRef` resync
 * guard in edit-panel/panel-primitives.tsx's LengthField (same "mid-edit prop
 * stomp" bug class fixed there for style-property fields).
 */
function CurveNumberField({ label, value, onChange }: CurveNumberFieldProps) {
  const [draft, setDraft] = useState(() => formatCurveAxisValue(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(formatCurveAxisValue(value));
  }, [value]);

  return (
    <label className="flex flex-col items-stretch gap-0.5">
      <span className="text-center text-[9px] text-muted-foreground">
        {label}
      </span>
      <Input
        type="number"
        step={0.01}
        value={draft}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => {
          focusedRef.current = false;
          // Snap back to the canonical rounded string — clears any
          // unparsed/partial trailing input ("-", "1.") left over from typing.
          setDraft(formatCurveAxisValue(value));
        }}
        className="h-5 px-1 !text-[10px] md:!text-[10px]"
        aria-label={label}
      />
    </label>
  );
}

function CurveEditor({ value, onChange }: CurveEditorProps) {
  const t = useT();
  const [x1, y1, x2, y2] = value;
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingHandle = useRef<1 | 2 | null>(null);

  const xPx = (x: number) => CURVE_PAD + x * (CURVE_W - 2 * CURVE_PAD);
  const yPx = (y: number) =>
    CURVE_PAD +
    ((CURVE_Y_MAX - y) / (CURVE_Y_MAX - CURVE_Y_MIN)) *
      (CURVE_H - 2 * CURVE_PAD);

  const fromEvent = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const px = ((e.clientX - rect.left) / rect.width) * CURVE_W;
    const py = ((e.clientY - rect.top) / rect.height) * CURVE_H;
    // CSS requires x control points in [0, 1]; y may overshoot.
    const x = Math.max(
      0,
      Math.min(1, (px - CURVE_PAD) / (CURVE_W - 2 * CURVE_PAD)),
    );
    const y =
      CURVE_Y_MAX -
      ((py - CURVE_PAD) / (CURVE_H - 2 * CURVE_PAD)) *
        (CURVE_Y_MAX - CURVE_Y_MIN);
    return [x, Math.max(-1, Math.min(2, y))] as const;
  };

  const handleMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingHandle.current) return;
    const point = fromEvent(e);
    if (!point) return;
    onChange(
      draggingHandle.current === 1
        ? [point[0], point[1], x2, y2]
        : [x1, y1, point[0], point[1]],
    );
  };

  const numberField = (
    label: string,
    fieldValue: number,
    apply: (n: number) => [number, number, number, number],
  ) => (
    <CurveNumberField
      label={label}
      value={fieldValue}
      onChange={(n) => onChange(apply(n))}
    />
  );

  return (
    <div className="flex flex-col gap-1">
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${CURVE_W} ${CURVE_H}`}
        className="rounded border border-border bg-muted/40 touch-none"
        onPointerMove={handleMove}
        onPointerUp={() => (draggingHandle.current = null)}
        onPointerCancel={() => (draggingHandle.current = null)}
        role="application"
        aria-label={t("designEditor.motion.bezierCurveEditor")}
      >
        {/* Unit box (0..1) */}
        <rect
          x={xPx(0)}
          y={yPx(1)}
          width={xPx(1) - xPx(0)}
          height={yPx(0) - yPx(1)}
          className="fill-transparent stroke-border"
          strokeDasharray="3 3"
        />
        {/* Handle arms */}
        <line
          x1={xPx(0)}
          y1={yPx(0)}
          x2={xPx(Math.max(0, Math.min(1, x1)))}
          y2={yPx(y1)}
          className="stroke-primary/50"
        />
        <line
          x1={xPx(1)}
          y1={yPx(1)}
          x2={xPx(Math.max(0, Math.min(1, x2)))}
          y2={yPx(y2)}
          className="stroke-primary/50"
        />
        {/* The curve itself */}
        <path
          d={`M ${xPx(0)} ${yPx(0)} C ${xPx(Math.max(0, Math.min(1, x1)))} ${yPx(y1)}, ${xPx(Math.max(0, Math.min(1, x2)))} ${yPx(y2)}, ${xPx(1)} ${yPx(1)}`}
          className="fill-none stroke-primary"
          strokeWidth={1.5}
        />
        {/* Draggable control points */}
        <circle
          cx={xPx(Math.max(0, Math.min(1, x1)))}
          cy={yPx(y1)}
          r={5}
          className="cursor-grab fill-primary stroke-background active:cursor-grabbing"
          onPointerDown={(e) => {
            draggingHandle.current = 1;
            (e.target as Element).setPointerCapture(e.pointerId);
          }}
        />
        <circle
          cx={xPx(Math.max(0, Math.min(1, x2)))}
          cy={yPx(y2)}
          r={5}
          className="cursor-grab fill-primary stroke-background active:cursor-grabbing"
          onPointerDown={(e) => {
            draggingHandle.current = 2;
            (e.target as Element).setPointerCapture(e.pointerId);
          }}
        />
      </svg>
      <div className="grid grid-cols-4 gap-1">
        {numberField("x1", x1, (n) => [
          Math.max(0, Math.min(1, n)),
          y1,
          x2,
          y2,
        ])}
        {numberField("y1", y1, (n) => [x1, n, x2, y2])}
        {numberField("x2", x2, (n) => [
          x1,
          y1,
          Math.max(0, Math.min(1, n)),
          y2,
        ])}
        {numberField("y2", y2, (n) => [x1, y1, x2, n])}
      </div>
    </div>
  );
}

// ─── Spring curve preview ─────────────────────────────────────────────────────

function SpringCurvePreview({
  bounce,
  settle,
}: {
  bounce: number;
  settle: number;
}) {
  const t = useT();
  const points: string[] = [];
  const samples = 72;
  for (let i = 0; i <= samples; i++) {
    const x = i / samples;
    const y = sampleSpring({ bounce, settle }, x);
    points.push(
      `${(CURVE_PAD + x * (CURVE_W - 2 * CURVE_PAD)).toFixed(1)},${(
        CURVE_PAD +
        ((CURVE_Y_MAX - y) / (CURVE_Y_MAX - CURVE_Y_MIN)) *
          (CURVE_H - 2 * CURVE_PAD)
      ).toFixed(1)}`,
    );
  }
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${CURVE_W} ${CURVE_H}`}
      className="rounded border border-border bg-muted/40"
      aria-label={t("designEditor.motion.springCurvePreview")}
      role="img"
    >
      <line
        x1={CURVE_PAD}
        y1={
          CURVE_PAD +
          ((CURVE_Y_MAX - 1) / (CURVE_Y_MAX - CURVE_Y_MIN)) *
            (CURVE_H - 2 * CURVE_PAD)
        }
        x2={CURVE_W - CURVE_PAD}
        y2={
          CURVE_PAD +
          ((CURVE_Y_MAX - 1) / (CURVE_Y_MAX - CURVE_Y_MIN)) *
            (CURVE_H - 2 * CURVE_PAD)
        }
        className="stroke-border"
        strokeDasharray="3 3"
      />
      <polyline
        points={points.join(" ")}
        className="fill-none stroke-primary"
        strokeWidth={1.5}
      />
    </svg>
  );
}
