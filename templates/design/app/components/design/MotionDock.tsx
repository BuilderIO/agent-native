// i18n-raw-literal-disable-file — new Design Studio panel; UI strings are localized when this feature is finalized in the follow-up PR.
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

import type {
  MotionTrack,
  MotionKeyframe,
  MotionEase,
  MotionPropertyPreset,
} from "@shared/motion-timeline";
import {
  MOTION_PROPERTY_PRESETS,
  createMotionTrackFromPreset,
  hasTrackFor,
  sampleMotionKeyframesAt,
  sortMotionKeyframes,
  upsertMotionKeyframeAtTime,
} from "@shared/motion-timeline";
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconPlayerStop,
  IconCheck,
  IconDiamond,
  IconChevronDown,
  IconChevronRight,
  IconPlus,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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

/** Named easing presets for the keyframe editor. */
const EASE_PRESETS: { label: string; value: MotionEase }[] = [
  { label: "Linear", value: "linear" },
  { label: "Ease", value: "ease" },
  { label: "Ease In", value: "ease-in" },
  { label: "Ease Out", value: "ease-out" },
  { label: "Ease In/Out", value: "ease-in-out" },
  { label: "Spring", value: "cubic-bezier(0.34,1.56,0.64,1)" },
];

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
  canvasIframeRef,
  applying = false,
  autoKeyframe: autoKeyframeProp,
  onAutoKeyframeChange,
  playhead: playheadProp,
  onPlayheadChange,
  livePlayheadRef,
  selectedTarget = null,
}: MotionDockProps) {
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

    const tick = (now: number) => {
      if (!playStartRef.current) return;
      const elapsed = now - playStartRef.current.wallMs;
      const t = Math.min(1, playStartRef.current.startT + elapsed / durationMs);
      setPlayheadLocal(t);
      sendPreview(t);
      if (t < 1) {
        playRafRef.current = requestAnimationFrame(tick);
      } else {
        stopPlayback();
      }
    };
    playRafRef.current = requestAnimationFrame(tick);
  }, [durationMs, playhead, sendPreview, setPlayheadLocal, stopPlayback]);

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
      // Seed the new keyframe with the track's interpolated value at the
      // playhead (what the preview currently shows) — a hardcoded "0" is
      // invalid CSS for transform/filter/color tracks and snaps the preview.
      const sampled = sampleMotionKeyframesAt(
        track.keyframes,
        playhead,
        defaultEase,
      );
      const newKf: MotionKeyframe = {
        t: playhead,
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
    [defaultEase, playhead, updateTrack],
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
          `A "${preset.property}" track already exists for ${label}. Edit its keyframes in the timeline instead.`,
        );
        return;
      }

      const seeded = createMotionTrackFromPreset(nodeId, preset, defaultEase);
      const newTrack: MotionDockTrack = { ...seeded, label };
      onTracksChange([...tracks, newTrack]);
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

  // ── Ruler tick marks ──────────────────────────────────────────────────────
  function rulerTicks(): { t: number; label: string }[] {
    const count = 10;
    return Array.from({ length: count + 1 }, (_, i) => {
      const t = i / count;
      const ms = Math.round(t * durationMs);
      const s = (ms / 1000).toFixed(1);
      return { t, label: `${s}s` };
    });
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
        aria-label="Motion dock"
        aria-hidden={!isOpen ? true : undefined}
        className={cn(
          "design-motion-dock absolute inset-x-0 bottom-0 z-40 flex min-h-0 transform-gpu flex-col overflow-hidden border-t bg-background select-none",
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
            aria-label="Collapse motion dock"
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
                  aria-label={playing ? "Pause" : "Play"}
                >
                  {playing ? (
                    <IconPlayerPause className="size-3.5" />
                  ) : (
                    <IconPlayerPlay className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {playing ? "Pause" : "Play"}
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
                  aria-label="Reset playhead"
                >
                  <IconPlayerStop className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Reset</TooltipContent>
            </Tooltip>

            {/* Duration */}
            <div className="flex items-center gap-1 ml-1">
              <span className="text-[10px] text-muted-foreground">
                Duration
              </span>
              <Input
                type="number"
                min={50}
                step={50}
                value={durationInput}
                onChange={(e) => setDurationInput(e.target.value)}
                onBlur={() => {
                  const ms = parseInt(durationInput, 10);
                  if (!isNaN(ms) && ms >= 50) {
                    onDurationChange?.(ms);
                  } else {
                    setDurationInput(String(durationMs));
                  }
                }}
                className="h-5 w-16 px-1 !text-[11px] md:!text-[11px]"
                aria-label="Duration in ms"
              />
              <span className="text-[10px] text-muted-foreground">ms</span>
            </div>

            {/* Add track — the "create first track" entry point. */}
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
                    aria-label="Toggle auto-keyframe"
                    aria-pressed={autoKeyframe}
                  >
                    <IconBolt className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Auto-keyframe</TooltipContent>
              </Tooltip>

              {applying ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      role="status"
                      aria-label="Saving motion"
                      className="flex size-6 items-center justify-center rounded text-muted-foreground"
                    >
                      <IconRefresh className="size-3 animate-spin" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">Saving motion</TooltipContent>
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
                      Animate{" "}
                      <span className="font-medium text-foreground/80">
                        {selectedTarget.label}
                      </span>
                      . Pick a property to add the first track.
                    </p>
                    <AddTrackMenu
                      selectedTarget={selectedTarget}
                      onCreateTrack={createTrack}
                      variant="cta"
                    />
                  </>
                ) : (
                  <p className="!text-[11px] text-muted-foreground/70 leading-snug">
                    Select an element on the canvas, then add a track to animate
                    it.
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
                  onDeleteKeyframe={deleteKeyframe}
                  onMoveKeyframe={moveKeyframe}
                  onMoveKeyframeEnd={moveKeyframeEnd}
                  onEaseKeyframe={easeKeyframe}
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
 * Property-preset dropdown that creates a new motion track for the selected
 * element. Disabled (with a hint) when nothing is selected, which is the only
 * state where a first track cannot be created.
 */
function AddTrackMenu({
  selectedTarget,
  onCreateTrack,
  variant = "toolbar",
}: AddTrackMenuProps) {
  const disabled = !selectedTarget;
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
        Add track
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
        Add track
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
          Select an element on the canvas first
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 p-1">
        <DropdownMenuLabel className="truncate px-2 py-1 text-[10px] font-medium leading-none text-muted-foreground">
          Animate “{selectedTarget.label}”
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-1" />
        {MOTION_PROPERTY_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={`${preset.property}-${preset.label}`}
            className="h-7 px-2 text-[12px] leading-none"
            onSelect={() => onCreateTrack(preset)}
          >
            {preset.label}
          </DropdownMenuItem>
        ))}
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
}

function LayerGroup({
  layer,
  expanded,
  onToggleExpand,
  onAddKeyframe,
}: LayerGroupProps) {
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

      {/* Property sub-rows */}
      {expanded &&
        layer.tracks.map((track) => (
          <div
            key={`${track.targetNodeId}-${track.property}`}
            className="group flex items-center gap-1 pl-5 pr-2 hover:bg-accent/20"
            style={{ height: ROW_HEIGHT }}
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
                  aria-label="Add keyframe"
                >
                  <IconPlus className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                Add keyframe at playhead
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
  onDeleteKeyframe: (track: MotionDockTrack, index: number) => void;
  onMoveKeyframe: (track: MotionDockTrack, index: number, newT: number) => void;
  onMoveKeyframeEnd: (track: MotionDockTrack) => void;
  onEaseKeyframe: (
    track: MotionDockTrack,
    index: number,
    ease: MotionEase,
  ) => void;
}

function LayerTrackRows({
  layer,
  expanded,
  playhead: _playhead,
  onDeleteKeyframe,
  onMoveKeyframe,
  onMoveKeyframeEnd,
  onEaseKeyframe,
}: LayerTrackRowsProps) {
  return (
    <>
      {/* Layer header spacer row */}
      <div
        className="relative border-b border-border/40"
        style={{ height: ROW_HEIGHT }}
      />

      {/* Property track rows */}
      {expanded &&
        layer.tracks.map((track) => (
          <TrackRow
            key={`${track.targetNodeId}-${track.property}`}
            track={track}
            onDeleteKeyframe={(index) => onDeleteKeyframe(track, index)}
            onMoveKeyframe={(index, newT) => onMoveKeyframe(track, index, newT)}
            onMoveKeyframeEnd={() => onMoveKeyframeEnd(track)}
            onEaseKeyframe={(index, ease) => onEaseKeyframe(track, index, ease)}
          />
        ))}
    </>
  );
}

interface TrackRowProps {
  track: MotionDockTrack;
  onDeleteKeyframe: (index: number) => void;
  onMoveKeyframe: (index: number, newT: number) => void;
  onMoveKeyframeEnd: () => void;
  onEaseKeyframe: (index: number, ease: MotionEase) => void;
}

function TrackRow({
  track,
  onDeleteKeyframe,
  onMoveKeyframe,
  onMoveKeyframeEnd,
  onEaseKeyframe,
}: TrackRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
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
      dragging.current = {
        index,
        startX: e.clientX,
        startT: kf.t,
        moved: false,
      };
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current || !rowRef.current) return;
      const rect = rowRef.current.getBoundingClientRect();
      const dx = e.clientX - dragging.current.startX;
      const dt = dx / rect.width;
      const newT = Math.max(0, Math.min(1, dragging.current.startT + dt));
      dragging.current.moved = true;
      onMoveKeyframe(dragging.current.index, newT);
    },
    [onMoveKeyframe],
  );

  const handlePointerUp = useCallback(() => {
    const wasMoved = dragging.current?.moved === true;
    dragging.current = null;
    // Only re-sort (and re-mark dirty) when the keyframe actually moved — a
    // plain click on a diamond must not trigger an autosave.
    if (wasMoved) onMoveKeyframeEnd();
  }, [onMoveKeyframeEnd]);

  return (
    <div
      ref={rowRef}
      className="relative border-b border-border/30"
      style={{ height: ROW_HEIGHT }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Track baseline */}
      <div className="absolute inset-y-1/2 left-0 right-0 h-px bg-border/50" />

      {/* Keyframe diamonds */}
      {track.keyframes.map((kf, i) => (
        <KeyframeDiamond
          key={i}
          kf={kf}
          onPointerDown={(e) => handleDiamondPointerDown(e, i, kf)}
          onDelete={() => onDeleteKeyframe(i)}
          onEaseChange={(ease) => onEaseKeyframe(i, ease)}
        />
      ))}
    </div>
  );
}

interface KeyframeDiamondProps {
  kf: MotionKeyframe;
  onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onDelete: () => void;
  onEaseChange: (ease: MotionEase) => void;
}

function KeyframeDiamond({
  kf,
  onPointerDown,
  onDelete,
  onEaseChange,
}: KeyframeDiamondProps) {
  const [hovered, setHovered] = useState(false);
  const currentEase = kf.ease ?? "ease";
  const currentPreset = EASE_PRESETS.find(
    (preset) => preset.value === currentEase,
  );

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 group"
      style={{ left: `${kf.t * 100}%` }}
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
            aria-label={`Keyframe at ${Math.round(kf.t * 100)}%`}
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
            {Math.round(kf.t * 100)}% — {kf.value} —{" "}
            {currentPreset?.label ?? currentEase}
          </span>
          <button
            type="button"
            className="ml-1 text-destructive hover:text-destructive/80"
            onClick={onDelete}
            aria-label="Delete keyframe"
          >
            <IconTrash className="size-3" />
          </button>
        </TooltipContent>
      </Tooltip>

      {/* Easing picker — appears under the diamond on hover. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="absolute left-1/2 top-full flex size-3 -translate-x-1/2 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label={`Change easing (currently ${currentPreset?.label ?? currentEase})`}
          >
            <IconChevronDown className="size-2.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40 p-1">
          <DropdownMenuLabel className="px-2 py-1 text-[10px] font-medium leading-none text-muted-foreground">
            Easing
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="my-1" />
          {EASE_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.value}
              className="h-7 px-2 text-[12px] leading-none"
              onSelect={() => onEaseChange(preset.value)}
            >
              <IconCheck
                className={cn(
                  "mr-1 size-3",
                  preset.value === currentEase ? "opacity-100" : "opacity-0",
                )}
              />
              {preset.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
