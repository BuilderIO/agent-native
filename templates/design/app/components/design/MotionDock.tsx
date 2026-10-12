import { useT } from "@agent-native/core/client/i18n";
import type { MotionAudioClip } from "@shared/motion-code";
import {
  MOTION_CURVE_PRESETS,
  MOTION_SPRING_DEFAULT_BOUNCE,
  MOTION_SPRING_PRESETS,
  motionEaseVariableId,
  parseSpringToken,
  sampleSpring,
  springToken,
} from "@shared/motion-easing";
import type { MotionEasingVariable } from "@shared/motion-easing";
import type {
  MotionNativeStyleInstance,
  MotionNativeStyleKey,
} from "@shared/motion-native-style";
import type {
  MotionTrack,
  MotionKeyframe,
  MotionEase,
  MotionPlaybackMode,
  MotionPropertyPreset,
} from "@shared/motion-timeline";
import {
  MOTION_DEFAULT_PLAYBACK_MODE,
  MOTION_KEYFRAME_TIME_EPSILON,
  MOTION_TIMELINE_MAX_DURATION_MS,
  MOTION_PROPERTY_PRESETS,
  getMotionTrackTiming,
  hasPreviousMotionKeyframe,
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
  IconArrowsLeftRight,
  IconDiamond,
  IconDiamondFilled,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconDots,
  IconPlus,
  IconRepeat,
  IconRepeatOnce,
  IconTrash,
  IconRefresh,
  IconLayersSubtract,
  IconArrowsMove,
  IconCircleHalf,
  IconResize,
  IconRotate,
  IconScale,
  IconTypography,
  IconVectorBezier2,
  IconEye,
  IconEyeOff,
  IconAdjustmentsHorizontal,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent as ReactTransitionEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import type { MotionAnimationStyle } from "@/pages/design-editor/motion-animation-style";

import { MotionAudioTracks } from "./MotionAudioTracks";
import { MotionEasingPicker } from "./MotionNativeStyleEditor";

const EMPTY_MOTION_AUDIO_CLIPS: MotionAudioClip[] = [];

const RULER_HEIGHT = 48;
const ROW_HEIGHT = 24;
const LAYER_SIDEBAR_WIDTH = 241;
const PLAYHEAD_WIDTH = 2;
const MIN_DOCK_HEIGHT = 160;
const DEFAULT_DOCK_HEIGHT = 200;
const MOTION_DOCK_HEIGHT_VARIABLE = "--design-motion-dock-height";
const TIMELINE_START_INSET_PX = 18;
const TIMELINE_CONTROL_RAIL_WIDTH = 161;
const TIMELINE_SCRUBBER_LEFT_PX = -4;
const TIMELINE_SCRUBBER_HORIZONTAL_INSET_PX = 44;
const TIMELINE_PIXELS_PER_MS_AT_DEFAULT_ZOOM = 1.4333;
const RULER_MAJOR_TICK_SPACING_PX = 140;
const INITIAL_RULER_VIEWPORT_WIDTH_PX = 1200;
const MIN_TIMELINE_ZOOM_FACTOR = 1;
const MAX_TIMELINE_ZOOM_FACTOR = 4;
const MIN_TIMELINE_ZOOM_LEVEL = 0;
const MAX_TIMELINE_ZOOM_LEVEL = 1;
const DEFAULT_TIMELINE_ZOOM_LEVEL = 0.62;
const FIGMA_ZOOM_EXPONENT = 5.62;
const KEYFRAME_SNAP_THRESHOLD_PX = 8;
const MARQUEE_START_THRESHOLD_PX = 3;

type MotionTimeUnit = "ms" | "s";

export function formatMotionTimeValue(
  ms: number,
  unit: MotionTimeUnit,
): string {
  if (unit === "ms") return String(Math.round(ms)).padStart(4, "0");
  return String(Math.round((ms / 1000) * 100) / 100);
}

export function parseMotionTimeValue(
  value: string,
  unit: MotionTimeUnit,
): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(unit === "s" ? parsed * 1000 : parsed);
}

export function motionTimelineContentWidth(zoom: number): string {
  const clamped = Math.max(
    MIN_TIMELINE_ZOOM_FACTOR,
    Math.min(MAX_TIMELINE_ZOOM_FACTOR, zoom),
  );
  return `${clamped * 100}%`;
}

export function motionZoomScale(level: number): number {
  const clamped = Math.max(
    MIN_TIMELINE_ZOOM_LEVEL,
    Math.min(MAX_TIMELINE_ZOOM_LEVEL, level),
  );
  return Math.exp(
    FIGMA_ZOOM_EXPONENT * (clamped - DEFAULT_TIMELINE_ZOOM_LEVEL),
  );
}

export function getMotionDockPrimaryPresets(
  t: (key: string) => string,
): MotionPropertyPreset[] {
  const standardPresets = MOTION_PROPERTY_PRESETS.filter(
    (preset) => preset.group === "primary",
  );
  const opacityIndex = standardPresets.findIndex(
    (preset) => preset.property === "opacity",
  );
  const sizePreset: MotionPropertyPreset = {
    property: "size",
    label: t("designEditor.motion.size"),
    group: "primary",
    additionalProperties: ["width", "height"],
  };

  return [
    ...standardPresets.slice(0, opacityIndex),
    sizePreset,
    ...standardPresets.slice(opacityIndex),
  ];
}

export function getMotionDockPrimaryStyles(
  t: (key: string) => string,
): MotionAnimationStyle[] {
  return getMotionDockPrimaryPresets(t).map((preset) => ({
    label: preset.label,
    kind:
      preset.additionalProperties ||
      preset.property === "translate" ||
      preset.property === "scale"
        ? "composite"
        : "individual",
    preset,
  }));
}

const PLAYBACK_MODES: {
  mode: MotionPlaybackMode;
  labelKey: "loop" | "once" | "pingPong";
  Icon: typeof IconRepeat;
}[] = [
  { mode: "once", labelKey: "once", Icon: IconRepeatOnce },
  { mode: "loop", labelKey: "loop", Icon: IconRepeat },
  { mode: "ping-pong", labelKey: "pingPong", Icon: IconArrowsLeftRight },
];

function trackKey(track: MotionTrack): string {
  return `${track.targetNodeId}\u001f${track.property}`;
}

function keyframeSelectionKey(track: MotionTrack, t: number): string {
  return JSON.stringify([trackKey(track), t]);
}

function motionTrackDisplayLabel(
  property: string,
  t: (key: string) => string,
  isTextAnimation = false,
): string {
  if (isTextAnimation) {
    const textProperty = property.startsWith("text:")
      ? property.slice("text:".length)
      : property;
    return `${t("designEditor.motion.text")} · ${t(`designEditor.motion.textAnimation.properties.${textProperty}`)}`;
  }
  switch (property) {
    case "translate":
      return t("editPanel.labels.position");
    case "scale":
      return t("designEditor.motion.textAnimation.properties.scale");
    case "rotate":
      return t("editPanel.labels.rotation");
    case "opacity":
      return t("editPanel.labels.opacity");
    case "width":
    case "height":
      return t("editPanel.labels.size");
    default:
      return property;
  }
}

const NATIVE_STYLE_LABEL_KEYS: Record<MotionNativeStyleKey, string> = {
  TextStagger: "text",
  Position: "position",
  Scale: "scale",
  Rotation: "rotation",
  Size: "size",
  Opacity: "opacity",
  Path: "path",
};

function nativeStyleIdentityKey(
  instance: MotionNativeStyleInstance,
  index: number,
): string {
  return `${instance.styleKey}\u001f${instance.targetNodeId}\u001f${index}`;
}

function nativeStyleDisplayLabel(
  instance: MotionNativeStyleInstance,
  t: (key: string) => string,
): string {
  const named = t(instance.nameKey);
  if (named && named !== instance.nameKey) return named;
  return t(
    `designEditor.motion.animationStyles.${NATIVE_STYLE_LABEL_KEYS[instance.styleKey]}`,
  );
}

function nativeStyleTiming(
  instance: MotionNativeStyleInstance,
): { startMs: number; endMs: number; delayMs: number } | null {
  const delaySeconds = instance.props.delay;
  const delayMs = typeof delaySeconds === "number" ? delaySeconds * 1000 : 0;
  const startMs = instance.timelineOffset * 1000 + delayMs;
  const durationMs = instance.duration * 1000;
  const endMs = startMs + durationMs;
  if (
    !Number.isFinite(instance.timelineOffset) ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(durationMs) ||
    instance.timelineOffset < 0 ||
    delayMs < 0 ||
    startMs < 0 ||
    durationMs <= 0 ||
    endMs > 120_000
  ) {
    return null;
  }
  return { startMs, endMs, delayMs };
}

function isRunnableNativeStyle(styleKey: MotionNativeStyleKey): boolean {
  return true;
}

export function formatMotionRulerTick(ms: number): string {
  if (ms === 0) return "0s";
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(2).replace(/\.?0+$/, "");
  return `${s}s`;
}

export function motionFieldKeyRequiresBlurGuard(key: string): boolean {
  return key === "Enter" || key === "Escape";
}

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

export interface MotionDockTrack extends MotionTrack {
  label: string;
  isTextAnimation?: boolean;
}

interface MotionDockNativeStyleEntry {
  instance: MotionNativeStyleInstance;
  index: number;
  key: string;
}

interface MotionKeyframeDragTarget {
  trackKey: string;
  index: number;
  startT: number;
  startTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
}

export interface MotionDockLiveState {
  previewing: boolean;
  selectedTrackId: string | null;
  selectedKeyframeIds: string[];
}

export interface MotionDockProps {
  tracks: MotionDockTrack[];
  audioClips?: MotionAudioClip[];
  onAudioClipsChange?: (clips: MotionAudioClip[]) => void;
  nativeStyles?: MotionNativeStyleInstance[];
  easingVariables?: MotionEasingVariable[];
  onEasingVariablesChange?: (variables: MotionEasingVariable[]) => void;
  layerLabels?: ReadonlyMap<string, string>;
  durationMs: number;
  defaultEase?: MotionEase;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onExitComplete?: () => void;
  onTracksChange?: (tracks: MotionDockTrack[]) => void;
  onNativeStyleChange?: (
    instance: MotionNativeStyleInstance,
    index: number,
  ) => void;
  onNativeStyleSpanChange?: (
    instance: MotionNativeStyleInstance,
    index: number,
    span: { startMs: number; durationMs: number },
  ) => void;
  onNativeStyleRemove?: (
    instance: MotionNativeStyleInstance,
    index: number,
  ) => void;
  onDurationChange?: (ms: number) => void;
  playbackMode?: MotionPlaybackMode;
  onPlaybackModeChange?: (mode: MotionPlaybackMode) => void;
  canvasIframeRef?: React.RefObject<HTMLIFrameElement | null>;
  applying?: boolean;
  readOnly?: boolean;
  autoKeyframe?: boolean;
  onAutoKeyframeChange?: (enabled: boolean) => void;
  playhead?: number;
  onPlayheadChange?: (t: number) => void;
  livePlayheadRef?: React.MutableRefObject<number | null>;
  onLiveStateChange?: (state: MotionDockLiveState) => void;
  selectedTarget?: { nodeId: string; label: string } | null;
  layerSidebarInset?: number;
  hiddenLayerIds?: ReadonlySet<string>;
  onToggleLayerHidden?: (nodeId: string, hidden: boolean) => void;
}

export function MotionDock({
  tracks,
  audioClips = EMPTY_MOTION_AUDIO_CLIPS,
  onAudioClipsChange,
  nativeStyles = [],
  easingVariables = [],
  onEasingVariablesChange,
  layerLabels,
  durationMs,
  defaultEase = "ease",
  open: openProp,
  onOpenChange,
  onExitComplete,
  onTracksChange,
  onNativeStyleChange,
  onNativeStyleSpanChange,
  onNativeStyleRemove,
  onDurationChange,
  playbackMode: playbackModeProp,
  onPlaybackModeChange,
  canvasIframeRef,
  applying = false,
  readOnly = false,
  autoKeyframe: autoKeyframeProp,
  onAutoKeyframeChange,
  playhead: playheadProp,
  onPlayheadChange,
  livePlayheadRef,
  onLiveStateChange,
  selectedTarget = null,
  layerSidebarInset = 0,
  hiddenLayerIds,
  onToggleLayerHidden,
}: MotionDockProps) {
  const t = useT();

  const [openInternal, setOpenInternal] = useState(false);
  const isOpen = openProp !== undefined ? openProp : openInternal;
  const setOpen = useCallback(
    (v: boolean) => {
      setOpenInternal(v);
      onOpenChange?.(v);
    },
    [onOpenChange],
  );

  const [playhead, setPlayhead] = useState(playheadProp ?? 0);
  const playheadRef = useRef(playheadProp ?? 0);
  const [playing, setPlaying] = useState(false);
  const audioPlayingRef = useRef(false);
  const playRafRef = useRef<number | null>(null);
  const playStartRef = useRef<{ wallMs: number; startT: number } | null>(null);
  useEffect(() => {
    if (playheadProp === undefined) return;
    const clamped = Math.max(0, Math.min(1, playheadProp));
    playheadRef.current = clamped;
    if (livePlayheadRef) livePlayheadRef.current = clamped;
    setPlayhead(clamped);
  }, [livePlayheadRef, playheadProp]);

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

  const [playbackModeInternal, setPlaybackModeInternal] =
    useState<MotionPlaybackMode | null>(null);
  const playbackMode: MotionPlaybackMode =
    playbackModeProp ??
    readTimelinePlaybackMode(tracks) ??
    playbackModeInternal ??
    MOTION_DEFAULT_PLAYBACK_MODE;
  const playbackModeRef = useRef(playbackMode);
  useLayoutEffect(() => {
    playbackModeRef.current = playbackMode;
  }, [playbackMode]);
  const cyclePlaybackMode = useCallback(() => {
    if (readOnly) return;
    const index = PLAYBACK_MODES.findIndex((m) => m.mode === playbackMode);
    const next = PLAYBACK_MODES[(index + 1) % PLAYBACK_MODES.length].mode;
    setPlaybackModeInternal(next);
    onPlaybackModeChange?.(next);
    if (onTracksChange && tracks.length > 0) {
      onTracksChange(withTimelinePlaybackMode(tracks, next));
    }
  }, [onPlaybackModeChange, onTracksChange, playbackMode, readOnly, tracks]);

  const [selectedTrackKey, setSelectedTrackKey] = useState<string | null>(() =>
    tracks.length > 0 ? trackKey(tracks[tracks.length - 1]) : null,
  );
  const [selectedNativeStyleKey, setSelectedNativeStyleKey] = useState<
    string | null
  >(null);
  const [selectedKeyframeKeys, setSelectedKeyframeKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const previousTrackKeysRef = useRef(
    new Set(tracks.map((track) => trackKey(track))),
  );
  useEffect(() => {
    const previousTrackKeys = previousTrackKeysRef.current;
    const addedTrack = tracks.find(
      (track) => !previousTrackKeys.has(trackKey(track)),
    );
    previousTrackKeysRef.current = new Set(
      tracks.map((track) => trackKey(track)),
    );
    if (addedTrack) setSelectedTrackKey(trackKey(addedTrack));
  }, [tracks]);
  const previousNativeStyleKeysRef = useRef(
    new Set(
      nativeStyles.map((instance, index) =>
        nativeStyleIdentityKey(instance, index),
      ),
    ),
  );
  useEffect(() => {
    const previousKeys = previousNativeStyleKeysRef.current;
    const entries = nativeStyles.map((instance, index) => ({
      key: nativeStyleIdentityKey(instance, index),
    }));
    const nextKeys = new Set(entries.map(({ key }) => key));
    let addedKey: string | null = null;
    for (const { key } of entries) {
      if (!previousKeys.has(key)) addedKey = key;
    }
    previousNativeStyleKeysRef.current = nextKeys;
    if (addedKey) {
      setSelectedNativeStyleKey(addedKey);
    } else {
      setSelectedNativeStyleKey((selected) =>
        selected && nextKeys.has(selected) ? selected : null,
      );
    }
  }, [nativeStyles]);
  const selectedTrack =
    tracks.find((track) => trackKey(track) === selectedTrackKey) ?? null;
  useEffect(() => {
    const availableKeyframes = new Set(
      tracks.flatMap((track) =>
        track.keyframes.map((keyframe) =>
          keyframeSelectionKey(track, keyframe.t),
        ),
      ),
    );
    setSelectedKeyframeKeys((selected) => {
      const next = new Set(
        [...selected].filter((key) => availableKeyframes.has(key)),
      );
      return next.size === selected.size ? selected : next;
    });
  }, [tracks]);
  useEffect(() => {
    onLiveStateChange?.({
      previewing: playing,
      selectedTrackId: selectedTrack ? selectedTrackKey : null,
      selectedKeyframeIds: [...selectedKeyframeKeys].sort(),
    });
  }, [
    onLiveStateChange,
    playing,
    selectedKeyframeKeys,
    selectedTrack,
    selectedTrackKey,
  ]);
  const selectTrack = useCallback((track: MotionDockTrack) => {
    setSelectedTrackKey(trackKey(track));
    setSelectedKeyframeKeys(new Set());
  }, []);
  const selectLayerKeyframes = useCallback(
    (layer: { nodeId: string; label: string; tracks: MotionDockTrack[] }) => {
      const firstTrack = layer.tracks[0];
      if (firstTrack) setSelectedTrackKey(trackKey(firstTrack));
      setSelectedKeyframeKeys(
        new Set(
          layer.tracks.flatMap((track) =>
            track.keyframes.map((keyframe) =>
              keyframeSelectionKey(track, keyframe.t),
            ),
          ),
        ),
      );
    },
    [],
  );
  const selectKeyframe = useCallback(
    (track: MotionDockTrack, t: number, extendSelection: boolean) => {
      const key = keyframeSelectionKey(track, t);
      setSelectedTrackKey(trackKey(track));
      setSelectedKeyframeKeys((current) => {
        if (!extendSelection) {
          return current.size === 1 && current.has(key)
            ? current
            : new Set([key]);
        }
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [],
  );

  const getKeyframeDragTargets = useCallback(
    (
      anchorTrack: MotionDockTrack,
      anchorIndex: number,
      extendSelection: boolean,
    ): MotionKeyframeDragTarget[] => {
      const anchor = anchorTrack.keyframes[anchorIndex];
      if (!anchor) return [];
      const anchorKey = keyframeSelectionKey(anchorTrack, anchor.t);
      const selection = selectedKeyframeKeys.has(anchorKey)
        ? new Set(selectedKeyframeKeys)
        : extendSelection
          ? new Set([...selectedKeyframeKeys, anchorKey])
          : new Set([anchorKey]);
      const targets: MotionKeyframeDragTarget[] = [];
      const addTarget = (track: MotionDockTrack, index: number) => {
        const keyframe = track.keyframes[index];
        if (!keyframe) return;
        const timing = getMotionTrackTiming(track, durationMs);
        targets.push({
          trackKey: trackKey(track),
          index,
          startT: keyframe.t,
          startTimeMs: timing.startMs + keyframe.t * timing.durationMs,
          minTimeMs: timing.startMs,
          maxTimeMs: timing.endMs,
        });
      };

      addTarget(anchorTrack, anchorIndex);
      for (const track of tracks) {
        if (trackKey(track) === trackKey(anchorTrack)) {
          track.keyframes.forEach((keyframe, index) => {
            if (
              index !== anchorIndex &&
              selection.has(keyframeSelectionKey(track, keyframe.t))
            ) {
              addTarget(track, index);
            }
          });
          continue;
        }
        track.keyframes.forEach((keyframe, index) => {
          if (selection.has(keyframeSelectionKey(track, keyframe.t))) {
            addTarget(track, index);
          }
        });
      }
      return targets;
    },
    [durationMs, selectedKeyframeKeys, tracks],
  );

  const [timeUnit, setTimeUnit] = useState<MotionTimeUnit>("ms");
  const [timelineZoomLevel, setTimelineZoomLevel] = useState(
    DEFAULT_TIMELINE_ZOOM_LEVEL,
  );
  const [timeDraft, setTimeDraft] = useState<string | null>(null);
  const skipNextTimeBlurCommitRef = useRef(false);
  const skipNextDurationBlurCommitRef = useRef(false);
  const setPlayheadLocal = useCallback(
    (next: number) => {
      playheadRef.current = next;
      if (livePlayheadRef) livePlayheadRef.current = next;
      setPlayhead(next);
    },
    [livePlayheadRef],
  );
  const commitPlayhead = useCallback(() => {
    if (livePlayheadRef) livePlayheadRef.current = playheadRef.current;
    onPlayheadChange?.(playheadRef.current);
  }, [livePlayheadRef, onPlayheadChange]);
  const [dockHeight, setDockHeight] = useState(DEFAULT_DOCK_HEIGHT);
  useEffect(() => {
    if (!isOpen) return;
    const rootStyle = document.documentElement.style;
    const previousHeight = rootStyle.getPropertyValue(
      MOTION_DOCK_HEIGHT_VARIABLE,
    );
    const dockHeightValue = `${dockHeight}px`;
    rootStyle.setProperty(MOTION_DOCK_HEIGHT_VARIABLE, dockHeightValue);
    return () => {
      if (
        rootStyle.getPropertyValue(MOTION_DOCK_HEIGHT_VARIABLE) !==
        dockHeightValue
      ) {
        return;
      }
      if (previousHeight) {
        rootStyle.setProperty(MOTION_DOCK_HEIGHT_VARIABLE, previousHeight);
      } else {
        rootStyle.removeProperty(MOTION_DOCK_HEIGHT_VARIABLE);
      }
    };
  }, [dockHeight, isOpen]);
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

  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    () =>
      new Set([
        ...tracks.map((track) => track.targetNodeId),
        ...nativeStyles.map((style) => style.targetNodeId),
      ]),
  );
  const knownLayerNodeIdsRef = useRef(
    new Set([
      ...tracks.map((track) => track.targetNodeId),
      ...nativeStyles.map((style) => style.targetNodeId),
    ]),
  );

  useEffect(() => {
    const nextNodeIds = new Set([
      ...tracks.map((track) => track.targetNodeId),
      ...nativeStyles.map((style) => style.targetNodeId),
    ]);
    const addedNodeIds = [...nextNodeIds].filter(
      (nodeId) => !knownLayerNodeIdsRef.current.has(nodeId),
    );
    knownLayerNodeIdsRef.current = nextNodeIds;
    setExpandedNodeIds((current) => {
      const next = new Set(
        [...current].filter((nodeId) => nextNodeIds.has(nodeId)),
      );
      for (const nodeId of addedNodeIds) next.add(nodeId);
      return next.size === current.size &&
        [...current].every((id) => next.has(id))
        ? current
        : next;
    });
  }, [nativeStyles, tracks]);

  const trackAreaRef = useRef<HTMLDivElement>(null);
  const timelineViewportRef = useRef<HTMLDivElement>(null);
  const timelineZoomAnchorRef = useRef<{
    clientX: number;
    timeMs: number;
  } | null>(null);
  const trackRowsRef = useRef<HTMLDivElement>(null);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const timelineDurationDragRef = useRef<{
    pointerId: number;
    startX: number;
    startDurationMs: number;
    lastDurationMs: number;
    pixelsPerMs: number;
  } | null>(null);
  useEffect(() => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    const updateWidth = () =>
      setTimelineViewportWidth(
        Math.max(0, viewport.clientWidth - TIMELINE_CONTROL_RAIL_WIDTH),
      );
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const [marqueeRect, setMarqueeRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const marqueeDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    extendSelection: boolean;
    baseSelection: Set<string>;
    moved: boolean;
  } | null>(null);
  const suppressTrackClickRef = useRef(false);
  const spacePressedRef = useRef(false);
  const spacePannedRef = useRef(false);
  const timelinePanRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
  } | null>(null);

  const [durationInput, setDurationInput] = useState(
    formatMotionTimeValue(durationMs, timeUnit),
  );
  useEffect(() => {
    setDurationInput(formatMotionTimeValue(durationMs, timeUnit));
  }, [durationMs, timeUnit]);

  const timelinePixelsPerMs = Number(
    (
      TIMELINE_PIXELS_PER_MS_AT_DEFAULT_ZOOM *
      motionZoomScale(timelineZoomLevel)
    ).toFixed(4),
  );
  const timelineTrackWidthPx =
    Math.round(durationMs * timelinePixelsPerMs * 1000) / 1000;
  const timelineContentWidthPx = Math.max(
    0,
    timelineViewportWidth - TIMELINE_START_INSET_PX,
    timelineTrackWidthPx,
  );
  const timelineScaleDurationMs =
    timelinePixelsPerMs > 0
      ? Math.max(durationMs, timelineContentWidthPx / timelinePixelsPerMs)
      : durationMs;
  const timelineWidthStyle = `${timelineContentWidthPx}px`;

  const handleTimelineDurationPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (readOnly || !onDurationChange || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      timelineDurationDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startDurationMs: durationMs,
        lastDurationMs: durationMs,
        pixelsPerMs: timelinePixelsPerMs,
      };
      if (event.nativeEvent.isTrusted) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [durationMs, onDurationChange, readOnly, timelinePixelsPerMs],
  );
  const handleTimelineDurationPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = timelineDurationDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const nextDurationMs = Math.max(
        50,
        Math.min(
          MOTION_TIMELINE_MAX_DURATION_MS,
          Math.round(
            drag.startDurationMs +
              (event.clientX - drag.startX) / drag.pixelsPerMs,
          ),
        ),
      );
      if (nextDurationMs === drag.lastDurationMs) return;
      drag.lastDurationMs = nextDurationMs;
      onDurationChange?.(nextDurationMs);
    },
    [onDurationChange],
  );
  const handleTimelineDurationPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (timelineDurationDragRef.current?.pointerId !== event.pointerId) {
        return;
      }
      event.stopPropagation();
      timelineDurationDragRef.current = null;
    },
    [],
  );
  const handleTimelineDurationKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (readOnly || !onDurationChange) return;
      const stepMs = event.shiftKey ? 1000 : 10;
      let nextDurationMs: number | null = null;
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        nextDurationMs = durationMs - stepMs;
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        nextDurationMs = durationMs + stepMs;
      } else if (event.key === "Home") {
        nextDurationMs = 50;
      } else if (event.key === "End") {
        nextDurationMs = MOTION_TIMELINE_MAX_DURATION_MS;
      }
      if (nextDurationMs === null) return;
      event.preventDefault();
      event.stopPropagation();
      onDurationChange(
        Math.max(50, Math.min(MOTION_TIMELINE_MAX_DURATION_MS, nextDurationMs)),
      );
    },
    [durationMs, onDurationChange, readOnly],
  );

  useLayoutEffect(() => {
    const anchor = timelineZoomAnchorRef.current;
    const viewport = timelineViewportRef.current;
    if (!anchor || !viewport) return;
    timelineZoomAnchorRef.current = null;
    const viewportLeft = viewport.getBoundingClientRect().left;
    const nextScrollLeft =
      anchor.timeMs * timelinePixelsPerMs -
      (anchor.clientX - viewportLeft - TIMELINE_START_INSET_PX);
    viewport.scrollLeft = nextScrollLeft;
    setTimelineScrollLeft(viewport.scrollLeft);
  }, [timelinePixelsPerMs]);

  const sendAudioState = useCallback(
    (timelineTimeMs: number, isPlaying: boolean) => {
      const iframe = canvasIframeRef?.current;
      if (!iframe?.contentWindow) return;
      try {
        iframe.contentWindow.postMessage(
          { type: "motion-audio-state", timelineTimeMs, isPlaying },
          "*",
        );
        // coercion-ok: this iframe message only synchronizes ephemeral audio preview state.
      } catch {
        // Best-effort preview audio sync; never throw.
      }
    },
    [canvasIframeRef],
  );

  useEffect(() => {
    const iframe = canvasIframeRef?.current;
    if (!iframe) return;
    const loadClips = () => {
      try {
        iframe.contentWindow?.postMessage(
          { type: "motion-audio-load", clips: audioClips },
          "*",
        );
        // coercion-ok: the clips remain persisted in source if preview loading races the iframe.
      } catch {
        // Audio preview is best-effort; the durable clip remains in source.
      }
    };
    loadClips();
    iframe.addEventListener("load", loadClips);
    return () => iframe.removeEventListener("load", loadClips);
  }, [audioClips, canvasIframeRef]);

  useEffect(() => {
    const handleAudioError = (event: MessageEvent) => {
      if (
        event.source !== canvasIframeRef?.current?.contentWindow ||
        event.data?.type !== "motion-audio-playback-error"
      ) {
        return;
      }
      toast.error(t("designEditor.motion.playbackError"));
    };
    window.addEventListener("message", handleAudioError);
    return () => window.removeEventListener("message", handleAudioError);
  }, [canvasIframeRef, t]);

  useEffect(() => {
    if (isOpen) return;
    audioPlayingRef.current = false;
    sendAudioState(playheadRef.current * durationMs, false);
  }, [durationMs, isOpen, sendAudioState]);

  useEffect(() => {
    return () => {
      try {
        canvasIframeRef?.current?.contentWindow?.postMessage(
          { type: "motion-audio-clear" },
          "*",
        );
        // coercion-ok: clearing preview audio during iframe teardown cannot affect saved clips.
      } catch {
        // Removing the dock must not interfere with editor teardown.
      }
    };
  }, [canvasIframeRef]);

  const sendPreview = useCallback(
    (t: number) => {
      const iframe = canvasIframeRef?.current;
      if (!iframe?.contentWindow) return;
      try {
        iframe.contentWindow.postMessage(
          { type: "motion-preview", t, durationMs },
          "*",
        );
        // coercion-ok: this iframe message only updates the transient visual preview.
      } catch {
        // Best-effort preview; never throw.
      }
      sendAudioState(t * durationMs, audioPlayingRef.current);
    },
    [canvasIframeRef, durationMs, sendAudioState],
  );

  const jumpToPlayhead = useCallback(
    (next: number) => {
      if (playRafRef.current !== null) {
        cancelAnimationFrame(playRafRef.current);
        playRafRef.current = null;
      }
      playStartRef.current = null;
      setPlaying(false);
      audioPlayingRef.current = false;
      const clamped = Math.max(0, Math.min(1, next));
      setPlayheadLocal(clamped);
      commitPlayhead();
      sendPreview(clamped);
    },
    [commitPlayhead, sendPreview, setPlayheadLocal],
  );

  const stopPlayback = useCallback(() => {
    if (playRafRef.current !== null) {
      cancelAnimationFrame(playRafRef.current);
      playRafRef.current = null;
    }
    playStartRef.current = null;
    setPlaying(false);
    audioPlayingRef.current = false;
    sendAudioState(playheadRef.current * durationMs, false);
    commitPlayhead();
  }, [commitPlayhead, durationMs, sendAudioState]);

  useLayoutEffect(() => {
    if (isOpen || !playing) return;
    stopPlayback();
  }, [isOpen, playing, stopPlayback]);

  const startPlayback = useCallback(() => {
    stopPlayback();
    const startT = playhead >= 1 ? 0 : playhead;
    playStartRef.current = { wallMs: performance.now(), startT };
    setPlaying(true);
    audioPlayingRef.current = true;
    setPlayheadLocal(startT);
    sendPreview(startT);

    const tick = (now: number) => {
      if (!playStartRef.current) return;
      const elapsed = now - playStartRef.current.wallMs;
      const progressed = playStartRef.current.startT + elapsed / durationMs;
      let t: number;
      let done = false;
      if (playbackModeRef.current === "loop") {
        t = progressed % 1;
      } else if (playbackModeRef.current === "ping-pong") {
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
  }, [durationMs, playhead, sendPreview, setPlayheadLocal, stopPlayback]);

  useEffect(() => {
    return () => {
      if (playRafRef.current !== null) cancelAnimationFrame(playRafRef.current);
    };
  }, []);

  const isDraggingPlayhead = useRef(false);

  const handleRulerPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!trackAreaRef.current) return;
      isDraggingPlayhead.current = true;
      stopPlayback();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const rect = trackAreaRef.current.getBoundingClientRect();
      const timelinePosition =
        rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
      const t = Math.max(
        0,
        Math.min(1, (timelinePosition * timelineScaleDurationMs) / durationMs),
      );
      setPlayheadLocal(t);
      sendPreview(t);
    },
    [
      durationMs,
      sendPreview,
      setPlayheadLocal,
      stopPlayback,
      timelineScaleDurationMs,
    ],
  );

  const handleRulerPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!isDraggingPlayhead.current || !trackAreaRef.current) return;
      const rect = trackAreaRef.current.getBoundingClientRect();
      const timelinePosition =
        rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
      const t = Math.max(
        0,
        Math.min(1, (timelinePosition * timelineScaleDurationMs) / durationMs),
      );
      setPlayheadLocal(t);
      sendPreview(t);
    },
    [durationMs, sendPreview, setPlayheadLocal, timelineScaleDurationMs],
  );

  const handleRulerPointerUp = useCallback(() => {
    if (!isDraggingPlayhead.current) return;
    isDraggingPlayhead.current = false;
    commitPlayhead();
  }, [commitPlayhead]);

  const updateMarqueeSelection = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = marqueeDragRef.current;
      const container = trackRowsRef.current;
      if (!drag || !container) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < MARQUEE_START_THRESHOLD_PX) {
        return;
      }
      drag.moved = true;
      const left = Math.min(drag.startX, event.clientX);
      const right = Math.max(drag.startX, event.clientX);
      const top = Math.min(drag.startY, event.clientY);
      const bottom = Math.max(drag.startY, event.clientY);
      const containerRect = container.getBoundingClientRect();
      setMarqueeRect({
        left: left - containerRect.left + container.scrollLeft,
        top: top - containerRect.top + container.scrollTop,
        width: right - left,
        height: bottom - top,
      });

      const nextSelection = new Set(drag.baseSelection);
      for (const marker of container.querySelectorAll<HTMLElement>(
        "[data-motion-keyframe][data-motion-selection-key]",
      )) {
        const rect = marker.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        if (
          centerX >= left &&
          centerX <= right &&
          centerY >= top &&
          centerY <= bottom
        ) {
          const key = marker.dataset.motionSelectionKey;
          if (key) nextSelection.add(key);
        }
      }
      setSelectedKeyframeKeys(nextSelection);
    },
    [],
  );

  const handleMarqueePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as Element;
      if (
        target.closest(
          "[data-motion-keyframe], [data-motion-marquee-ignore], button, [role=slider]",
        )
      ) {
        return;
      }
      const extendSelection = event.shiftKey || event.metaKey || event.ctrlKey;
      marqueeDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        extendSelection,
        baseSelection: extendSelection
          ? new Set(selectedKeyframeKeys)
          : new Set(),
        moved: false,
      };
      if (event.nativeEvent.isTrusted) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [selectedKeyframeKeys],
  );

  const handleMarqueePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (marqueeDragRef.current?.pointerId !== event.pointerId) return;
      updateMarqueeSelection(event);
    },
    [updateMarqueeSelection],
  );

  const handleMarqueePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = marqueeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      updateMarqueeSelection(event);
      marqueeDragRef.current = null;
      setMarqueeRect(null);
      if (!drag.moved && !drag.extendSelection) {
        setSelectedKeyframeKeys(new Set());
      }
      suppressTrackClickRef.current = drag.moved;
    },
    [updateMarqueeSelection],
  );

  const handleTrackClickCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!suppressTrackClickRef.current) return;
      suppressTrackClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

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

  const updateTrack = useCallback(
    (
      nodeId: string,
      property: string,
      updater: (track: MotionDockTrack) => MotionDockTrack,
    ) => {
      if (readOnly || !onTracksChange) return;
      onTracksChange(
        tracks.map((tr) =>
          tr.targetNodeId === nodeId && tr.property === property
            ? updater(tr)
            : tr,
        ),
      );
    },
    [onTracksChange, readOnly, tracks],
  );

  const updateTrackTiming = useCallback(
    (track: MotionDockTrack, startMs: number, trackDurationMs: number) => {
      if (readOnly || !onTracksChange) return;
      const safeDuration = Math.max(
        50,
        Math.min(durationMs, Math.round(trackDurationMs)),
      );
      const safeStart = Math.max(
        0,
        Math.min(Math.round(startMs), durationMs - safeDuration),
      );
      let changed = false;
      const nextTracks = tracks.map((candidate) => {
        if (trackKey(candidate) !== trackKey(track)) return candidate;
        const nextTrack = { ...candidate };
        if (safeStart > 0) nextTrack.delayMs = safeStart;
        else delete nextTrack.delayMs;
        if (safeDuration !== durationMs - safeStart) {
          nextTrack.durationMs = safeDuration;
        } else {
          delete nextTrack.durationMs;
        }
        if (
          candidate.delayMs !== nextTrack.delayMs ||
          candidate.durationMs !== nextTrack.durationMs
        ) {
          changed = true;
          return nextTrack;
        }
        return candidate;
      });
      if (changed) onTracksChange(nextTracks);
    },
    [durationMs, onTracksChange, readOnly, tracks],
  );

  const updateTrackEase = useCallback(
    (track: MotionDockTrack, ease: MotionEase) => {
      updateTrack(track.targetNodeId, track.property, (current) => ({
        ...current,
        keyframes: current.keyframes.map((keyframe, index) =>
          index === 0 ? { ...keyframe, ease } : keyframe,
        ),
      }));
    },
    [updateTrack],
  );

  const addKeyframeAtTime = useCallback(
    (track: MotionDockTrack, timelineTimeMs: number) => {
      if (readOnly) return;
      const localT = timelineTimeToTrackTime(track, timelineTimeMs, durationMs);
      const sampled = sampleMotionKeyframesAt(
        track.keyframes,
        localT,
        defaultEase,
        easingVariables,
      );
      const newKf: MotionKeyframe = {
        t: localT,
        value: sampled || "0",
        ease: defaultEase,
      };
      updateTrack(track.targetNodeId, track.property, (tr) => ({
        ...tr,
        keyframes: upsertMotionKeyframeAtTime(tr.keyframes, newKf),
      }));
    },
    [defaultEase, durationMs, easingVariables, readOnly, updateTrack],
  );

  const deleteSelectedKeyframes = useCallback(
    (selection: ReadonlySet<string>) => {
      if (readOnly || !onTracksChange || selection.size === 0) return;
      let changed = false;
      const nextTracks = tracks.flatMap((track) => {
        const keyframes = track.keyframes.filter(
          (keyframe) => !selection.has(keyframeSelectionKey(track, keyframe.t)),
        );
        if (keyframes.length === track.keyframes.length) return [track];
        changed = true;
        return keyframes.length > 0 ? [{ ...track, keyframes }] : [];
      });
      if (changed) onTracksChange(nextTracks);
      setSelectedKeyframeKeys((current) => {
        const next = new Set([...current].filter((key) => !selection.has(key)));
        return next.size === current.size ? current : next;
      });
    },
    [onTracksChange, readOnly, tracks],
  );

  const deleteKeyframe = useCallback(
    (track: MotionDockTrack, index: number) => {
      const keyframe = track.keyframes[index];
      if (!keyframe) return;
      deleteSelectedKeyframes(
        new Set([keyframeSelectionKey(track, keyframe.t)]),
      );
    },
    [deleteSelectedKeyframes],
  );

  const toggleKeyframeAtPlayhead = useCallback(
    (track: MotionDockTrack) => {
      const localT = timelineTimeToTrackTime(
        track,
        playhead * durationMs,
        durationMs,
      );
      const existingIndex = track.keyframes.findIndex(
        (keyframe) =>
          Math.abs(keyframe.t - localT) <= MOTION_KEYFRAME_TIME_EPSILON,
      );
      if (existingIndex >= 0) {
        deleteKeyframe(track, existingIndex);
      } else {
        addKeyframeAtTime(track, playhead * durationMs);
      }
    },
    [addKeyframeAtTime, deleteKeyframe, durationMs, playhead],
  );

  const jumpToPreviousKeyframe = useCallback(
    (track: MotionDockTrack) => {
      const timing = getMotionTrackTiming(track, durationMs);
      const currentTimeMs = playhead * durationMs;
      const frameTimes = track.keyframes
        .map((keyframe) => timing.startMs + keyframe.t * timing.durationMs)
        .sort((a, b) => a - b);
      const previousTimeMs = [...frameTimes]
        .reverse()
        .find(
          (timeMs) =>
            timeMs <
            currentTimeMs - MOTION_KEYFRAME_TIME_EPSILON * timing.durationMs,
        );
      if (previousTimeMs !== undefined) {
        jumpToPlayhead(previousTimeMs / durationMs);
      }
    },
    [durationMs, jumpToPlayhead, playhead],
  );

  const toggleTrackVisibility = useCallback(
    (track: MotionDockTrack) => {
      updateTrack(track.targetNodeId, track.property, (current) => ({
        ...current,
        enabled: current.enabled === false,
      }));
    },
    [updateTrack],
  );

  const deleteTrackKeyframes = useCallback(
    (track: MotionDockTrack) => {
      if (readOnly || !onTracksChange) return;
      const removedKey = trackKey(track);
      const removedKeyframes = new Set(
        track.keyframes.map((keyframe) =>
          keyframeSelectionKey(track, keyframe.t),
        ),
      );
      onTracksChange(
        tracks.filter((candidate) => trackKey(candidate) !== removedKey),
      );
      setSelectedTrackKey((current) =>
        current === removedKey ? null : current,
      );
      setSelectedKeyframeKeys((current) => {
        const next = new Set(
          [...current].filter((key) => !removedKeyframes.has(key)),
        );
        return next.size === current.size ? current : next;
      });
    },
    [onTracksChange, readOnly, tracks],
  );

  const moveKeyframes = useCallback(
    (
      targets: MotionKeyframeDragTarget[],
      requestedDeltaMs: number,
      snapToTargets: boolean,
    ) => {
      if (readOnly || !onTracksChange || targets.length === 0) return;
      const minDeltaMs = Math.max(
        ...targets.map((target) => target.minTimeMs - target.startTimeMs),
      );
      const maxDeltaMs = Math.min(
        ...targets.map((target) => target.maxTimeMs - target.startTimeMs),
      );
      let deltaMs = Math.max(
        minDeltaMs,
        Math.min(maxDeltaMs, requestedDeltaMs),
      );

      const anchor = targets[0]!;
      const rulerWidth =
        trackAreaRef.current?.getBoundingClientRect().width ?? 0;
      const snapThresholdMs =
        rulerWidth > 0
          ? (KEYFRAME_SNAP_THRESHOLD_PX / rulerWidth) * durationMs
          : 0;
      if (snapToTargets && snapThresholdMs > 0) {
        const movedIndices = new Set(
          targets.map((target) => `${target.trackKey}\u001f${target.index}`),
        );
        const anchorTimeMs = anchor.startTimeMs + deltaMs;
        const snapTimes = [playhead * durationMs];
        for (const track of tracks) {
          const timing = getMotionTrackTiming(track, durationMs);
          track.keyframes.forEach((keyframe, index) => {
            if (movedIndices.has(`${trackKey(track)}\u001f${index}`)) return;
            snapTimes.push(timing.startMs + keyframe.t * timing.durationMs);
          });
        }
        const nearestSnap = snapTimes
          .map((timeMs) => ({
            timeMs,
            deltaMs: timeMs - anchor.startTimeMs,
          }))
          .filter(
            (snap) =>
              snap.deltaMs >= minDeltaMs &&
              snap.deltaMs <= maxDeltaMs &&
              Math.abs(snap.timeMs - anchorTimeMs) <= snapThresholdMs,
          )
          .sort(
            (left, right) =>
              Math.abs(left.timeMs - anchorTimeMs) -
              Math.abs(right.timeMs - anchorTimeMs),
          )[0];
        if (nearestSnap) deltaMs = nearestSnap.deltaMs;
      }

      const updatesByTrack = new Map<string, Map<number, number>>();
      const nextSelection = new Set<string>();
      for (const target of targets) {
        const track = tracks.find(
          (candidate) => trackKey(candidate) === target.trackKey,
        );
        if (!track) continue;
        const timing = getMotionTrackTiming(track, durationMs);
        const nextT = Math.max(
          0,
          Math.min(
            1,
            (target.startTimeMs + deltaMs - timing.startMs) / timing.durationMs,
          ),
        );
        const updates = updatesByTrack.get(target.trackKey) ?? new Map();
        updates.set(target.index, nextT);
        updatesByTrack.set(target.trackKey, updates);
        nextSelection.add(keyframeSelectionKey(track, nextT));
      }

      let changed = false;
      const nextTracks = tracks.map((track) => {
        const updates = updatesByTrack.get(trackKey(track));
        if (!updates) return track;
        const movedFrames = [...updates.entries()].filter(([index, nextT]) => {
          const keyframe = track.keyframes[index];
          return keyframe && nextT !== keyframe.t;
        });
        if (movedFrames.length === 0) return track;
        changed = true;
        const movedIndices = new Set(movedFrames.map(([index]) => index));
        let keyframes = track.keyframes.filter(
          (_, index) => !movedIndices.has(index),
        );
        for (const [index, nextT] of movedFrames) {
          const keyframe = track.keyframes[index];
          if (!keyframe) continue;
          keyframes = upsertMotionKeyframeAtTime(keyframes, {
            ...keyframe,
            t: nextT,
          });
        }
        return { ...track, keyframes };
      });
      setSelectedKeyframeKeys(nextSelection);
      if (changed) onTracksChange(nextTracks);
    },
    [durationMs, onTracksChange, playhead, readOnly, tracks],
  );

  const moveKeyframesEnd = useCallback(
    (targets: MotionKeyframeDragTarget[]) => {
      if (!onTracksChange || targets.length === 0) return;
      const affectedTrackKeys = new Set(
        targets.map((target) => target.trackKey),
      );
      onTracksChange(
        tracks.map((track) =>
          affectedTrackKeys.has(trackKey(track))
            ? { ...track, keyframes: sortMotionKeyframes(track.keyframes) }
            : track,
        ),
      );
    },
    [onTracksChange, tracks],
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

  const updateLayerSpan = useCallback(
    (nodeId: string, nextSpan: { startMs: number; durationMs: number }) => {
      if (readOnly || !onTracksChange) return;
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
    [durationMs, onTracksChange, readOnly, tracks],
  );

  const commitTimeDraft = useCallback(() => {
    if (timeDraft === null) return;
    const ms = parseMotionTimeValue(timeDraft, timeUnit);
    setTimeDraft(null);
    if (ms === null) return;
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
    timeUnit,
    timeDraft,
  ]);

  const commitDurationDraft = useCallback(() => {
    if (readOnly) return;
    const ms = parseMotionTimeValue(durationInput, timeUnit);
    if (ms !== null && ms >= 50) {
      onDurationChange?.(ms);
    } else {
      setDurationInput(formatMotionTimeValue(durationMs, timeUnit));
    }
  }, [durationInput, durationMs, onDurationChange, readOnly, timeUnit]);

  const dockRef = useRef<HTMLDivElement>(null);
  const handleDockKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) {
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedKeyframeKeys.size === 0) return;
        e.preventDefault();
        dockRef.current?.focus();
        deleteSelectedKeyframes(selectedKeyframeKeys);
        return;
      }
      if (e.code !== "Space") return;
      if (target?.closest("button, [role=button], [role=checkbox]")) return;
      e.preventDefault();
      spacePressedRef.current = true;
      spacePannedRef.current = false;
    },
    [deleteSelectedKeyframes, selectedKeyframeKeys],
  );
  const handleDockKeyUp = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.code !== "Space" || !spacePressedRef.current) return;
      event.preventDefault();
      spacePressedRef.current = false;
      if (!spacePannedRef.current) {
        if (playing) stopPlayback();
        else startPlayback();
      }
      spacePannedRef.current = false;
    },
    [playing, startPlayback, stopPlayback],
  );
  const handleTimelinePointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!spacePressedRef.current || event.button !== 0) return;
      const viewport = timelineViewportRef.current;
      if (!viewport) return;
      timelinePanRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startScrollLeft: viewport.scrollLeft,
      };
      spacePannedRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      if (event.nativeEvent.isTrusted) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [],
  );
  const handleTimelinePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pan = timelinePanRef.current;
      const viewport = timelineViewportRef.current;
      if (!pan || pan.pointerId !== event.pointerId || !viewport) return;
      viewport.scrollLeft = pan.startScrollLeft - (event.clientX - pan.startX);
    },
    [],
  );
  const endTimelinePan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (timelinePanRef.current?.pointerId !== event.pointerId) return;
      timelinePanRef.current = null;
    },
    [],
  );
  const handleTimelineWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const levelDelta = Math.max(-0.1, Math.min(0.1, -event.deltaY * 0.0002));
      const viewport = timelineViewportRef.current;
      if (viewport) {
        const viewportLeft = viewport.getBoundingClientRect().left;
        const timelineX =
          event.clientX -
          viewportLeft -
          TIMELINE_START_INSET_PX +
          viewport.scrollLeft;
        timelineZoomAnchorRef.current = {
          clientX: event.clientX,
          timeMs: Math.max(0, timelineX / timelinePixelsPerMs),
        };
      }
      setTimelineZoomLevel((current) => {
        const next = Math.max(
          MIN_TIMELINE_ZOOM_LEVEL,
          Math.min(MAX_TIMELINE_ZOOM_LEVEL, current + levelDelta),
        );
        const normalizedNext = Math.round(next * 100) / 100;
        if (normalizedNext === current) timelineZoomAnchorRef.current = null;
        return normalizedNext;
      });
    },
    [timelinePixelsPerMs],
  );
  const handleRulerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const viewport = timelineViewportRef.current;
      if (!viewport) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        viewport.scrollLeft += event.key === "ArrowLeft" ? -40 : 40;
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const rows = trackRowsRef.current;
        if (!rows) return;
        event.preventDefault();
        rows.scrollTop += event.key === "ArrowUp" ? -ROW_HEIGHT : ROW_HEIGHT;
      }
    },
    [],
  );

  function rulerTicks(): { ms: number; t: number; label: string }[] {
    const NICE_STEPS = [
      10, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000,
    ];
    const step =
      NICE_STEPS.find(
        (candidate) =>
          candidate * timelinePixelsPerMs >= RULER_MAJOR_TICK_SPACING_PX,
      ) ?? NICE_STEPS[NICE_STEPS.length - 1];
    const visibleWidthPx =
      timelineViewportWidth ||
      Math.min(timelineContentWidthPx, INITIAL_RULER_VIEWPORT_WIDTH_PX);
    const firstVisibleMs = Math.max(
      0,
      (timelineScrollLeft -
        TIMELINE_START_INSET_PX -
        RULER_MAJOR_TICK_SPACING_PX) /
        timelinePixelsPerMs,
    );
    const lastVisibleMs = Math.min(
      timelineScaleDurationMs,
      (timelineScrollLeft +
        visibleWidthPx -
        TIMELINE_START_INSET_PX +
        RULER_MAJOR_TICK_SPACING_PX) /
        timelinePixelsPerMs,
    );
    const ticks: { ms: number; t: number; label: string }[] = [];
    const firstTickMs = Math.floor(firstVisibleMs / step) * step;
    for (let ms = firstTickMs; ms <= lastVisibleMs; ms += step) {
      ticks.push({
        ms,
        t: ms / timelineScaleDurationMs,
        label: formatMotionRulerTick(ms),
      });
    }
    return ticks;
  }

  type LayerGroup = {
    nodeId: string;
    label: string;
    hidden: boolean;
    tracks: MotionDockTrack[];
    nativeStyles: MotionDockNativeStyleEntry[];
  };
  const layersByNodeId = new Map<string, LayerGroup>();
  const layerForTarget = (nodeId: string, fallbackLabel: string) => {
    const existing = layersByNodeId.get(nodeId);
    if (existing) return existing;
    const layer: LayerGroup = {
      nodeId,
      label:
        layerLabels?.get(nodeId) ??
        (selectedTarget?.nodeId === nodeId
          ? selectedTarget.label
          : fallbackLabel),
      hidden: hiddenLayerIds?.has(nodeId) ?? false,
      tracks: [],
      nativeStyles: [],
    };
    layersByNodeId.set(nodeId, layer);
    return layer;
  };
  for (const track of tracks) {
    layerForTarget(track.targetNodeId, track.label).tracks.push(track);
  }
  nativeStyles.forEach((instance, index) => {
    layerForTarget(
      instance.targetNodeId,
      nativeStyleDisplayLabel(instance, t),
    ).nativeStyles.push({
      instance,
      index,
      key: nativeStyleIdentityKey(instance, index),
    });
  });
  const layers = [...layersByNodeId.values()];
  const allLayersExpanded =
    layers.length > 0 &&
    layers.every((layer) => expandedNodeIds.has(layer.nodeId));

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
        role="region"
        aria-label={t("designEditor.motion.dockLabel")}
        aria-description={t("designEditor.motion.timelineDescription", {
          tracks: tracks.length + nativeStyles.length + audioClips.length,
          keyframes: tracks.reduce(
            (total, track) => total + track.keyframes.length,
            0,
          ),
        })}
        aria-hidden={!isOpen ? true : undefined}
        ref={dockRef}
        tabIndex={-1}
        onKeyDown={handleDockKeyDown}
        onKeyUp={handleDockKeyUp}
        className={cn(
          "design-motion-dock before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-20 before:h-px before:bg-border absolute inset-x-0 bottom-0 z-[90] flex min-h-0 transform-gpu flex-col overflow-hidden bg-background outline-none select-none",
          isOpen
            ? "translate-y-0 border-border opacity-100"
            : "translate-y-full border-transparent pointer-events-none",
        )}
        style={{ height: dockHeight }}
      >
        {/* Resize handle */}
        <div
          data-motion-dock-resize
          className="absolute -top-1 left-0 right-0 h-2 cursor-ns-resize z-10"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
        />

        {/* Dock toolbar and timeline scrubber */}
        <div className="relative flex h-12 shrink-0 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-20 after:h-px after:bg-border">
          <div
            data-motion-toolbar-controls
            className="relative h-full shrink-0"
            style={{ width: LAYER_SIDEBAR_WIDTH + layerSidebarInset }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-2 top-3 size-6"
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

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={autoKeyframe ? "secondary" : "ghost"}
                  size="icon"
                  role="checkbox"
                  className={cn(
                    "absolute left-[41px] top-3 size-6",
                    autoKeyframe && "text-primary",
                  )}
                  disabled={readOnly}
                  onClick={() => setAutoKeyframe((value) => !value)}
                  aria-label={t("designEditor.motion.toggleAutoKeyframe")}
                  aria-checked={autoKeyframe}
                >
                  <IconDiamondFilled className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {t("designEditor.motion.autoKeyframe")}
              </TooltipContent>
            </Tooltip>

            <Input
              type="text"
              inputMode={timeUnit === "s" ? "decimal" : "numeric"}
              value={
                timeDraft ??
                formatMotionTimeValue(playhead * durationMs, timeUnit)
              }
              onFocus={() =>
                setTimeDraft(
                  formatMotionTimeValue(playhead * durationMs, timeUnit),
                )
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
                  skipNextTimeBlurCommitRef.current =
                    motionFieldKeyRequiresBlurGuard(e.key);
                  (e.target as HTMLInputElement).blur();
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setTimeDraft(null);
                  skipNextTimeBlurCommitRef.current =
                    motionFieldKeyRequiresBlurGuard(e.key);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="absolute left-[76px] top-3 h-6 w-[34px] px-0.5 !text-[11px] md:!text-[11px]"
              aria-label={t("designEditor.motion.currentTimeLabel")}
            />

            <Input
              type="text"
              inputMode={timeUnit === "s" ? "decimal" : "numeric"}
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
                  skipNextDurationBlurCommitRef.current =
                    motionFieldKeyRequiresBlurGuard(e.key);
                  (e.target as HTMLInputElement).blur();
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDurationInput(formatMotionTimeValue(durationMs, timeUnit));
                  skipNextDurationBlurCommitRef.current =
                    motionFieldKeyRequiresBlurGuard(e.key);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="absolute left-[111px] top-3 h-6 w-[42px] px-0.5 !text-[11px] md:!text-[11px]"
              disabled={readOnly}
              aria-label={t("designEditor.motion.duration")}
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute left-[155px] top-3 h-6 w-6 px-0 !text-[10px]"
                  onClick={() =>
                    setTimeUnit((unit) => (unit === "ms" ? "s" : "ms"))
                  }
                  aria-label={t("designEditor.motion.changeTimeFormat")}
                >
                  {timeUnit}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {t("designEditor.motion.changeTimeFormat")}
              </TooltipContent>
            </Tooltip>

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
                      className="absolute left-[180px] top-3 size-6"
                      disabled={readOnly}
                      onClick={cyclePlaybackMode}
                      aria-label={t("designEditor.motion.playbackModeButton", {
                        mode: modeLabel.toLocaleLowerCase(),
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

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-3 size-6"
                  aria-label={t(
                    allLayersExpanded
                      ? "designEditor.motion.collapseAllTracks"
                      : "designEditor.motion.expandAllTracks",
                  )}
                  aria-pressed={allLayersExpanded}
                  onClick={() =>
                    setExpandedNodeIds(
                      allLayersExpanded
                        ? new Set()
                        : new Set(layers.map((layer) => layer.nodeId)),
                    )
                  }
                  disabled={layers.length === 0}
                >
                  {allLayersExpanded ? (
                    <IconChevronDown className="size-3.5" />
                  ) : (
                    <IconChevronRight className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {t(
                  allLayersExpanded
                    ? "designEditor.motion.collapseAllTracks"
                    : "designEditor.motion.expandAllTracks",
                )}
              </TooltipContent>
            </Tooltip>
          </div>

          <div
            data-motion-timeline-header
            className="relative min-w-0 flex-1 overflow-hidden"
            style={{ paddingRight: TIMELINE_CONTROL_RAIL_WIDTH }}
            onPointerDownCapture={handleTimelinePointerDownCapture}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={endTimelinePan}
            onPointerCancel={endTimelinePan}
            onWheel={handleTimelineWheel}
          >
            <div
              ref={trackAreaRef}
              data-motion-ruler
              className="relative h-full shrink-0 cursor-col-resize"
              style={{
                width: timelineWidthStyle,
                marginLeft: TIMELINE_START_INSET_PX - timelineScrollLeft,
              }}
              onPointerDown={handleRulerPointerDown}
              onPointerMove={handleRulerPointerMove}
              onPointerUp={handleRulerPointerUp}
            >
              {rulerTicks().map(({ ms, t: tickPosition, label }) => (
                <div
                  key={tickPosition}
                  data-motion-ruler-tick-ms={ms}
                  className="pointer-events-none absolute top-0 h-full"
                  style={{ left: `${tickPosition * 100}%` }}
                >
                  <div className="h-3 w-px bg-border/70" />
                  <span className="absolute left-0 top-6 -translate-x-1/2 whitespace-nowrap text-[9px] leading-none text-muted-foreground/70">
                    {label}
                  </span>
                </div>
              ))}
              <PlayheadLine
                t={(playhead * durationMs) / timelineScaleDurationMs}
                height={RULER_HEIGHT}
                inRuler
                autoKeyframe={autoKeyframe}
              />
              <button
                type="button"
                role="slider"
                data-motion-timeline-duration-handle
                aria-label={t("designEditor.motion.duration")}
                aria-orientation="horizontal"
                aria-valuemin={50}
                aria-valuemax={MOTION_TIMELINE_MAX_DURATION_MS}
                aria-valuenow={durationMs}
                aria-valuetext={`${formatMotionTimeValue(durationMs, timeUnit)} ${t(timeUnit === "ms" ? "designEditor.motion.milliseconds" : "designEditor.motion.seconds").toLocaleLowerCase()}`}
                aria-disabled={readOnly || !onDurationChange}
                disabled={readOnly || !onDurationChange}
                className="group absolute top-0 z-10 flex h-full w-3 -translate-x-1/2 cursor-ew-resize items-start justify-center bg-transparent p-0 outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] disabled:cursor-default"
                style={{ left: timelineTrackWidthPx }}
                onPointerDown={handleTimelineDurationPointerDown}
                onPointerMove={handleTimelineDurationPointerMove}
                onPointerUp={handleTimelineDurationPointerEnd}
                onPointerCancel={handleTimelineDurationPointerEnd}
                onKeyDown={handleTimelineDurationKeyDown}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--design-editor-accent-color)]/70 group-hover:bg-[var(--design-editor-accent-color)]"
                />
                <span
                  aria-hidden="true"
                  className="relative mt-2 h-3 w-1.5 rounded-full border border-background bg-[var(--design-editor-accent-color)] shadow-sm transition-[width] group-hover:w-2"
                />
              </button>
            </div>

            <div
              data-motion-scrubber
              role="slider"
              tabIndex={0}
              aria-label={t("designEditor.motion.timelineScrubber")}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={durationMs * 1000}
              aria-valuenow={Math.round(playhead * durationMs * 1000)}
              aria-valuetext={`${((playhead * durationMs) / 1000).toFixed(3)} ${t("designEditor.motion.seconds").toLocaleLowerCase()}`}
              className="pointer-events-none absolute top-0 h-full outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
              style={{
                left: TIMELINE_SCRUBBER_LEFT_PX,
                width: `${timelineTrackWidthPx + TIMELINE_SCRUBBER_HORIZONTAL_INSET_PX}px`,
              }}
              onKeyDown={handleRulerKeyDown}
            />

            <div className="absolute right-3 top-3 z-10 flex h-6 items-center gap-1.5">
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Slider
                    data-motion-timeline-zoom
                    min={MIN_TIMELINE_ZOOM_LEVEL}
                    max={MAX_TIMELINE_ZOOM_LEVEL}
                    step={0.01}
                    value={[timelineZoomLevel]}
                    onValueChange={(value) => {
                      const zoomLevel = value[0];
                      if (typeof zoomLevel === "number") {
                        timelineZoomAnchorRef.current = null;
                        setTimelineZoomLevel(zoomLevel);
                      }
                    }}
                    thumbAriaLabel={t("designEditor.motion.timelineZoomLevel")}
                    className="w-[109px]"
                  />
                </TooltipTrigger>
                <TooltipContent side="top">
                  {t("designEditor.motion.timelineZoom", {
                    percent: Math.round(timelineZoomLevel * 100),
                  })}
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
                onClick={() => setOpen(false)}
                aria-label={t("designEditor.motion.collapseDock")}
              >
                <IconChevronDown className="size-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Dock body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Layer sidebar */}
          <div
            data-motion-layer-sidebar
            className="flex flex-col shrink-0 border-r border-border overflow-y-auto"
            style={{
              width: LAYER_SIDEBAR_WIDTH + layerSidebarInset,
              paddingLeft: layerSidebarInset,
              paddingTop: 8,
            }}
          >
            <MotionAudioTracks
              surface="sidebar"
              clips={audioClips}
              playheadMs={playhead * durationMs}
              timelineDurationMs={durationMs}
              timelineScaleDurationMs={timelineScaleDurationMs}
              readOnly={readOnly}
              onClipsChange={onAudioClipsChange}
              onDurationChange={onDurationChange}
              onSeek={(timeMs) => jumpToPlayhead(timeMs / durationMs)}
            />
            {layers.length === 0 && audioClips.length === 0 ? (
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
                  </>
                ) : (
                  <p className="!text-[11px] text-muted-foreground/70 leading-snug">
                    {t("designEditor.motion.emptyStateNoSelection")}
                  </p>
                )}
              </div>
            ) : layers.length > 0 ? (
              layers.map((layer) => (
                <LayerGroup
                  key={layer.nodeId}
                  layer={layer}
                  readOnly={readOnly}
                  hidden={layer.hidden}
                  expanded={expandedNodeIds.has(layer.nodeId)}
                  selectedKeyframeKeys={selectedKeyframeKeys}
                  playhead={playhead}
                  timelineDurationMs={durationMs}
                  timeUnit={timeUnit}
                  defaultEase={defaultEase}
                  easingVariables={easingVariables}
                  onEasingVariablesChange={onEasingVariablesChange}
                  onSelectLayer={() => selectLayerKeyframes(layer)}
                  onToggleExpand={() =>
                    setExpandedNodeIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(layer.nodeId)) next.delete(layer.nodeId);
                      else next.add(layer.nodeId);
                      return next;
                    })
                  }
                  onToggleKeyframe={toggleKeyframeAtPlayhead}
                  onPreviousKeyframe={jumpToPreviousKeyframe}
                  onToggleAnimationVisibility={toggleTrackVisibility}
                  onToggleLayerHidden={onToggleLayerHidden}
                  selectedTrackKey={selectedTrackKey}
                  onSelectTrack={selectTrack}
                  onUpdateTrackTiming={updateTrackTiming}
                  onUpdateTrackEase={updateTrackEase}
                  onDeleteTrack={deleteTrackKeyframes}
                  selectedNativeStyleKey={selectedNativeStyleKey}
                  onSelectNativeStyle={setSelectedNativeStyleKey}
                  onNativeStyleChange={onNativeStyleChange}
                  onNativeStyleRemove={onNativeStyleRemove}
                />
              ))
            ) : null}
          </div>

          {/* Timeline / track area */}
          <div
            ref={timelineViewportRef}
            data-motion-timeline-viewport
            className="relative min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
            style={{ paddingRight: TIMELINE_CONTROL_RAIL_WIDTH }}
            onPointerDownCapture={handleTimelinePointerDownCapture}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={endTimelinePan}
            onPointerCancel={endTimelinePan}
            onWheel={handleTimelineWheel}
            onScroll={(event) =>
              setTimelineScrollLeft(event.currentTarget.scrollLeft)
            }
          >
            <div
              className="flex h-full min-w-0 flex-col"
              data-motion-timeline-content
              style={{
                width: timelineWidthStyle,
                marginLeft: TIMELINE_START_INSET_PX,
              }}
            >
              {/* Track rows with keyframe diamonds */}
              <div
                ref={trackRowsRef}
                className="relative flex-1 overflow-x-hidden overflow-y-auto"
                data-motion-tracks
                style={{
                  width: timelineTrackWidthPx,
                  alignSelf: "flex-start",
                  paddingTop: 8,
                  boxSizing: "border-box",
                }}
                onPointerDown={handleMarqueePointerDown}
                onPointerMove={handleMarqueePointerMove}
                onPointerUp={handleMarqueePointerUp}
                onPointerCancel={handleMarqueePointerUp}
                onClickCapture={handleTrackClickCapture}
              >
                <MotionAudioTracks
                  surface="timeline"
                  clips={audioClips}
                  playheadMs={playhead * durationMs}
                  timelineDurationMs={durationMs}
                  timelineScaleDurationMs={timelineScaleDurationMs}
                  readOnly={readOnly}
                  onClipsChange={onAudioClipsChange}
                  onDurationChange={onDurationChange}
                  onSeek={(timeMs) => jumpToPlayhead(timeMs / durationMs)}
                />
                {layers.map((layer) => (
                  <LayerTrackRows
                    key={layer.nodeId}
                    layer={layer}
                    readOnly={readOnly}
                    expanded={expandedNodeIds.has(layer.nodeId)}
                    playhead={playhead}
                    timelineDurationMs={durationMs}
                    defaultEase={defaultEase}
                    easingVariables={easingVariables}
                    onEasingVariablesChange={onEasingVariablesChange}
                    selectedTrackKey={selectedTrackKey}
                    selectedKeyframeKeys={selectedKeyframeKeys}
                    onSelectTrack={selectTrack}
                    onSelectKeyframe={selectKeyframe}
                    onJumpToPlayhead={jumpToPlayhead}
                    onDeleteKeyframe={deleteKeyframe}
                    onAddKeyframeAtTime={(track, timeMs) => {
                      addKeyframeAtTime(track, timeMs);
                      jumpToPlayhead(timeMs / durationMs);
                    }}
                    onBeginKeyframeDrag={(track, index, extendSelection) =>
                      getKeyframeDragTargets(track, index, extendSelection)
                    }
                    onMoveKeyframes={moveKeyframes}
                    onMoveKeyframesEnd={moveKeyframesEnd}
                    onEaseKeyframe={easeKeyframe}
                    onLayerSpanChange={updateLayerSpan}
                    selectedNativeStyleKey={selectedNativeStyleKey}
                    onNativeStyleSpanChange={onNativeStyleSpanChange}
                  />
                ))}

                {marqueeRect ? (
                  <div
                    aria-hidden="true"
                    data-motion-marquee
                    className="pointer-events-none absolute z-20 border border-primary bg-primary/10"
                    style={marqueeRect}
                  />
                ) : null}

                {/* Playhead across track rows */}
                <PlayheadLine
                  t={playhead}
                  autoKeyframe={autoKeyframe}
                  height={
                    8 +
                    audioClips.length * ROW_HEIGHT +
                    layers.reduce(
                      (sum, layer) =>
                        sum +
                        ROW_HEIGHT +
                        (expandedNodeIds.has(layer.nodeId)
                          ? layer.tracks.length * ROW_HEIGHT +
                            layer.nativeStyles.length * ROW_HEIGHT
                          : 0),
                      0,
                    )
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface AddTrackMenuProps {
  selectedTarget: {
    nodeId: string;
    label: string;
    isText?: boolean;
    isPath?: boolean;
  } | null;
  onCreateTrack?: (preset: MotionPropertyPreset) => void;
  onCreateStyle?: (style: MotionAnimationStyle) => void;
  onCreateNativeStyle?: (styleKey: MotionNativeStyleKey) => void;
  onCreateText?: () => void;
  disabledProperties?: readonly string[];
  disabledReason?: string;
}

export function AddTrackMenu({
  selectedTarget,
  onCreateTrack,
  onCreateStyle,
  onCreateNativeStyle,
  onCreateText,
  disabledProperties = [],
  disabledReason,
}: AddTrackMenuProps) {
  const t = useT();
  const disabled = !selectedTarget || Boolean(disabledReason);
  const addMotionLabel = t("designEditor.motion.addMotion");
  const trigger = (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-6 w-6 px-0"
      disabled={disabled}
      aria-label={addMotionLabel}
      title={addMotionLabel}
    >
      <IconPlus className="size-3.5" />
      <span className="sr-only">{addMotionLabel}</span>
    </Button>
  );

  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{trigger}</span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {disabledReason ?? t("designEditor.motion.selectElementFirst")}
        </TooltipContent>
      </Tooltip>
    );
  }

  const primaryStyles = getMotionDockPrimaryStyles(t);
  const nativeStyleOptions: Array<{
    styleKey: MotionNativeStyleKey;
    labelKey: string;
    Icon: typeof IconArrowsMove;
  }> = [
    {
      styleKey: "Position",
      labelKey: "designEditor.motion.animationStyles.position",
      Icon: IconArrowsMove,
    },
    {
      styleKey: "Scale",
      labelKey: "designEditor.motion.animationStyles.scale",
      Icon: IconScale,
    },
    {
      styleKey: "Rotation",
      labelKey: "designEditor.motion.animationStyles.rotation",
      Icon: IconRotate,
    },
    {
      styleKey: "Size",
      labelKey: "designEditor.motion.animationStyles.size",
      Icon: IconResize,
    },
    {
      styleKey: "Opacity",
      labelKey: "designEditor.motion.animationStyles.opacity",
      Icon: IconCircleHalf,
    },
  ];
  const productMotionOptions: Array<{
    key: string;
    labelKey: string;
    Icon: typeof IconTypography;
    onSelect: () => void;
  }> = [
    ...(selectedTarget.isText && onCreateText
      ? [
          {
            key: "Text",
            labelKey: "designEditor.motion.text",
            Icon: IconTypography,
            onSelect: onCreateText,
          },
        ]
      : []),
    ...(selectedTarget.isText && onCreateNativeStyle
      ? [
          {
            key: "TextStagger",
            labelKey: "designEditor.motion.nativeTextStagger.create",
            Icon: IconTypography,
            onSelect: () => onCreateNativeStyle("TextStagger"),
          },
        ]
      : []),
    ...(selectedTarget.isPath && onCreateNativeStyle
      ? [
          {
            key: "Path",
            labelKey: "designEditor.motion.animationStyles.path",
            Icon: IconVectorBezier2,
            onSelect: () => onCreateNativeStyle("Path"),
          },
        ]
      : []),
  ];
  const moreMotionLabel = `${t("designEditor.motion.more")} ${t("designEditor.motion.tabLabel")}`;

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-32 p-1">
          <DropdownMenuLabel className="sr-only">
            {t("designEditor.motion.animateLayer", {
              label: selectedTarget.label,
            })}
          </DropdownMenuLabel>
          {onCreateNativeStyle
            ? nativeStyleOptions.map(({ styleKey, labelKey, Icon }) => (
                <DropdownMenuItem
                  key={styleKey}
                  className="h-6 gap-2 px-2 text-[12px] leading-none"
                  onSelect={() => onCreateNativeStyle(styleKey)}
                >
                  <Icon
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  {t(labelKey)}
                </DropdownMenuItem>
              ))
            : null}
          {!onCreateNativeStyle
            ? primaryStyles.map((style) => (
                <DropdownMenuItem
                  key={`${style.preset.property}-${style.label}`}
                  className="h-6 gap-2 px-2 text-[12px] leading-none"
                  disabled={
                    style.preset.additionalProperties
                      ? style.preset.additionalProperties.every((property) =>
                          disabledProperties.includes(property),
                        )
                      : disabledProperties.includes(style.preset.property)
                  }
                  onSelect={() => {
                    if (onCreateStyle) onCreateStyle(style);
                    else onCreateTrack?.(style.preset);
                  }}
                >
                  {style.preset.property === "translate" ? (
                    <IconArrowsMove
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : style.preset.property === "scale" ? (
                    <IconScale
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : style.preset.property === "rotate" ? (
                    <IconRotate
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : style.preset.property === "size" ? (
                    <IconResize
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <IconCircleHalf
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  {style.label}
                </DropdownMenuItem>
              ))
            : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {productMotionOptions.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 w-6 px-0"
              disabled={disabled}
              aria-label={moreMotionLabel}
              title={moreMotionLabel}
            >
              <IconDots className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-36 p-1">
            <DropdownMenuLabel className="sr-only">
              {moreMotionLabel}
            </DropdownMenuLabel>
            {productMotionOptions.map(({ key, labelKey, Icon, onSelect }) => (
              <DropdownMenuItem
                key={key}
                className="h-6 gap-2 px-2 text-[12px] leading-none"
                onSelect={onSelect}
              >
                <Icon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                {t(labelKey)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

interface PlayheadLineProps {
  t: number;
  height: number;
  inRuler?: boolean;
  autoKeyframe?: boolean;
}

function PlayheadLine({
  t,
  height,
  inRuler,
  autoKeyframe = false,
}: PlayheadLineProps) {
  return (
    <div
      data-motion-playhead
      data-motion-auto-keyframe={autoKeyframe ? "" : undefined}
      className={cn(
        "absolute top-0 pointer-events-none z-10",
        autoKeyframe
          ? "bg-destructive"
          : inRuler
            ? "bg-primary/80"
            : "bg-primary/60",
      )}
      style={{
        left: `${t * 100}%`,
        width: PLAYHEAD_WIDTH,
        height,
        transform: "translateX(-50%)",
      }}
    >
      {inRuler && (
        <div
          className={cn(
            "absolute -top-0 left-1/2 -translate-x-1/2 size-2 rounded-sm",
            autoKeyframe ? "bg-destructive" : "bg-primary",
          )}
        />
      )}
    </div>
  );
}

interface LayerGroupProps {
  layer: {
    nodeId: string;
    label: string;
    hidden: boolean;
    tracks: MotionDockTrack[];
    nativeStyles: MotionDockNativeStyleEntry[];
  };
  readOnly: boolean;
  hidden: boolean;
  expanded: boolean;
  selectedKeyframeKeys: ReadonlySet<string>;
  playhead: number;
  timelineDurationMs: number;
  timeUnit: MotionTimeUnit;
  defaultEase: MotionEase;
  easingVariables: MotionEasingVariable[];
  onEasingVariablesChange?: (variables: MotionEasingVariable[]) => void;
  onSelectLayer: () => void;
  onToggleExpand: () => void;
  onToggleKeyframe: (track: MotionDockTrack) => void;
  onPreviousKeyframe: (track: MotionDockTrack) => void;
  onToggleAnimationVisibility: (track: MotionDockTrack) => void;
  onToggleLayerHidden?: (nodeId: string, hidden: boolean) => void;
  selectedTrackKey: string | null;
  onSelectTrack: (track: MotionDockTrack) => void;
  onUpdateTrackTiming: (
    track: MotionDockTrack,
    startMs: number,
    durationMs: number,
  ) => void;
  onUpdateTrackEase: (track: MotionDockTrack, ease: MotionEase) => void;
  onDeleteTrack: (track: MotionDockTrack) => void;
  selectedNativeStyleKey: string | null;
  onSelectNativeStyle: (key: string) => void;
  onNativeStyleChange?: (
    instance: MotionNativeStyleInstance,
    index: number,
  ) => void;
  onNativeStyleRemove?: (
    instance: MotionNativeStyleInstance,
    index: number,
  ) => void;
}

function LayerGroup({
  layer,
  readOnly,
  hidden,
  expanded,
  selectedKeyframeKeys,
  playhead,
  timelineDurationMs,
  timeUnit,
  defaultEase,
  easingVariables,
  onEasingVariablesChange,
  onSelectLayer,
  onToggleExpand,
  onToggleKeyframe,
  onPreviousKeyframe,
  onToggleAnimationVisibility,
  onToggleLayerHidden,
  selectedTrackKey,
  onSelectTrack,
  onUpdateTrackTiming,
  onUpdateTrackEase,
  onDeleteTrack,
  selectedNativeStyleKey,
  onSelectNativeStyle,
  onNativeStyleChange,
  onNativeStyleRemove,
}: LayerGroupProps) {
  const t = useT();
  const layerKeyframeKeys = layer.tracks.flatMap((track) =>
    track.keyframes.map((keyframe) => keyframeSelectionKey(track, keyframe.t)),
  );
  const selected =
    layerKeyframeKeys.length > 0 &&
    layerKeyframeKeys.every((key) => selectedKeyframeKeys.has(key));
  return (
    <>
      {/* Layer header row */}
      <div
        data-motion-layer-group
        className={cn(
          "relative flex shrink-0 items-center gap-1 px-2 hover:bg-accent/40",
          selected && "bg-accent/40",
        )}
        style={{
          height: ROW_HEIGHT,
          marginLeft: -24,
          width: "calc(100% + 24px)",
        }}
        role="row"
        aria-selected={selected}
        aria-expanded={expanded}
      >
        <button
          type="button"
          className="shrink-0 text-muted-foreground"
          aria-label={layer.label}
          aria-expanded={expanded}
          onClick={onToggleExpand}
        >
          {expanded ? (
            <IconChevronDown className="size-3" />
          ) : (
            <IconChevronRight className="size-3" />
          )}
        </button>
        <button
          type="button"
          data-motion-select-layer
          className="flex-1 truncate pr-8 text-left !text-[11px] font-medium"
          title={layer.label}
          aria-label={layer.label}
          onClick={onSelectLayer}
        >
          {layer.label}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          role="checkbox"
          aria-checked={!hidden}
          aria-label={t("designEditor.motion.toggleLayerVisibility")}
          title={t("designEditor.motion.toggleLayerVisibility")}
          disabled={!onToggleLayerHidden}
          className="absolute right-[7px] top-0 size-6 shrink-0"
          onClick={(event) => {
            event.stopPropagation();
            onToggleLayerHidden?.(layer.nodeId, !hidden);
          }}
        >
          {hidden ? (
            <IconEyeOff className="size-3.5" />
          ) : (
            <IconEye className="size-3.5" />
          )}
        </Button>
      </div>

      {/* Property rows */}
      {expanded &&
        layer.tracks.map((track) =>
          (() => {
            const playheadTrackT = timelineTimeToTrackTime(
              track,
              playhead * timelineDurationMs,
              timelineDurationMs,
            );
            const hasKeyframeAtPlayhead = track.keyframes.some(
              (keyframe) =>
                Math.abs(keyframe.t - playheadTrackT) <=
                MOTION_KEYFRAME_TIME_EPSILON,
            );
            const hasPreviousKeyframe = hasPreviousMotionKeyframe(
              track,
              playhead * timelineDurationMs,
              timelineDurationMs,
            );
            const animationEnabled = track.enabled !== false;
            return (
              <div
                key={`${track.targetNodeId}-${track.property}`}
                data-motion-property-row={track.property}
                className={cn(
                  "group relative flex shrink-0 items-center cursor-pointer hover:bg-accent/20",
                  trackKey(track) === selectedTrackKey && "bg-accent/40",
                )}
                style={{
                  height: ROW_HEIGHT,
                  marginLeft: -34,
                  width: "calc(100% + 34px)",
                }}
                role="button"
                tabIndex={0}
                onClick={() => onSelectTrack(track)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Delete" || e.key === "Backspace") {
                    if (readOnly) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onDeleteTrack(track);
                    return;
                  }
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectTrack(track);
                  }
                }}
                aria-pressed={trackKey(track) === selectedTrackKey}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-[18px] top-0 h-3 w-px bg-border/60"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-[18px] top-1/2 h-px w-2.5 bg-border/60"
                />
                <span
                  className={cn(
                    "absolute left-[34px] right-[165px] truncate text-[11px] leading-4 text-muted-foreground",
                    !animationEnabled && "opacity-50",
                  )}
                >
                  {motionTrackDisplayLabel(
                    track.property,
                    t,
                    track.isTextAnimation,
                  )}
                </span>
                {trackKey(track) === selectedTrackKey ? (
                  <MotionTrackSettingsButton
                    track={track}
                    timelineDurationMs={timelineDurationMs}
                    timeUnit={timeUnit}
                    defaultEase={defaultEase}
                    easingVariables={easingVariables}
                    onEasingVariablesChange={onEasingVariablesChange}
                    readOnly={readOnly}
                    onOpen={() => onSelectTrack(track)}
                    onTimingChange={onUpdateTrackTiming}
                    onEaseChange={onUpdateTrackEase}
                  />
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-[123px] top-0 size-6 shrink-0"
                  disabled={readOnly}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleKeyframe(track);
                  }}
                  aria-label={t("designEditor.motion.addOrRemoveKeyframe")}
                  title={t("designEditor.motion.addOrRemoveKeyframe")}
                >
                  {hasKeyframeAtPlayhead ? (
                    <IconDiamondFilled className="size-3" />
                  ) : (
                    <IconDiamond className="size-3" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-[147px] top-0 h-6 w-4 shrink-0"
                  disabled={!hasPreviousKeyframe || readOnly}
                  onClick={(event) => {
                    event.stopPropagation();
                    onPreviousKeyframe(track);
                  }}
                  aria-label={t("designEditor.motion.previousKeyframe")}
                  title={t("designEditor.motion.previousKeyframe")}
                >
                  <IconChevronLeft className="size-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  role="checkbox"
                  aria-checked={animationEnabled}
                  aria-label={t(
                    "designEditor.motion.toggleAnimationVisibility",
                  )}
                  title={t("designEditor.motion.toggleAnimationVisibility")}
                  className="absolute right-[7px] top-0 size-6 shrink-0"
                  disabled={readOnly}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleAnimationVisibility(track);
                  }}
                >
                  {animationEnabled ? (
                    <IconEye className="size-3.5" />
                  ) : (
                    <IconEyeOff className="size-3.5" />
                  )}
                </Button>
              </div>
            );
          })(),
        )}

      {expanded &&
        layer.nativeStyles.map(({ instance, index, key }) => {
          const enabled = instance.enabled !== false;
          const label = nativeStyleDisplayLabel(instance, t);
          const selectedNativeStyle = selectedNativeStyleKey === key;
          return (
            <div
              key={key}
              data-motion-native-style-row={instance.styleKey}
              data-motion-native-style-key={key}
              className={cn(
                "group relative flex shrink-0 items-center cursor-pointer hover:bg-accent/20",
                selectedNativeStyle &&
                  "bg-[var(--design-editor-accent-color)]/15",
                !enabled && "text-muted-foreground/60",
              )}
              style={{
                height: ROW_HEIGHT,
                marginLeft: -34,
                width: "calc(100% + 34px)",
              }}
              role="row"
              aria-selected={selectedNativeStyle}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-[18px] top-0 h-3 w-px bg-border/60"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-[18px] top-1/2 h-px w-2.5 bg-border/60"
              />
              <button
                type="button"
                data-motion-select-native-style
                className={cn(
                  "absolute left-[34px] right-[61px] truncate text-left text-[11px] leading-4 text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  selectedNativeStyle &&
                    "text-[var(--design-editor-accent-color)]",
                )}
                title={label}
                aria-pressed={selectedNativeStyle}
                onClick={() => onSelectNativeStyle(key)}
              >
                {label}
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                role="checkbox"
                aria-checked={enabled}
                aria-label={`${t(enabled ? "designEditor.motion.animationStyles.hide" : "designEditor.motion.animationStyles.show")} ${label}`}
                title={`${t(enabled ? "designEditor.motion.animationStyles.hide" : "designEditor.motion.animationStyles.show")} ${label}`}
                className="absolute right-[31px] top-0 size-6 shrink-0"
                disabled={readOnly || !onNativeStyleChange}
                onClick={(event) => {
                  event.stopPropagation();
                  onNativeStyleChange?.(
                    { ...instance, enabled: !enabled },
                    index,
                  );
                }}
              >
                {enabled ? (
                  <IconEye className="size-3.5" />
                ) : (
                  <IconEyeOff className="size-3.5" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${t("designEditor.motion.animationStyles.removeAnimation")} ${label}`}
                title={`${t("designEditor.motion.animationStyles.removeAnimation")} ${label}`}
                className="absolute right-[7px] top-0 size-6 shrink-0"
                disabled={readOnly || !onNativeStyleRemove}
                onClick={(event) => {
                  event.stopPropagation();
                  onNativeStyleRemove?.(instance, index);
                }}
              >
                <IconTrash className="size-3.5" />
              </Button>
            </div>
          );
        })}
    </>
  );
}

interface MotionTrackSettingsButtonProps {
  track: MotionDockTrack;
  timelineDurationMs: number;
  timeUnit: MotionTimeUnit;
  defaultEase: MotionEase;
  easingVariables: MotionEasingVariable[];
  onEasingVariablesChange?: (variables: MotionEasingVariable[]) => void;
  readOnly: boolean;
  onOpen: () => void;
  onTimingChange: (
    track: MotionDockTrack,
    startMs: number,
    durationMs: number,
  ) => void;
  onEaseChange: (track: MotionDockTrack, ease: MotionEase) => void;
}

function MotionTrackSettingsButton({
  track,
  timelineDurationMs,
  timeUnit,
  defaultEase,
  easingVariables,
  onEasingVariablesChange,
  readOnly,
  onOpen,
  onTimingChange,
  onEaseChange,
}: MotionTrackSettingsButtonProps) {
  const t = useT();
  const timing = getMotionTrackTiming(track, timelineDurationMs);
  const [open, setOpen] = useState(false);
  const [startInput, setStartInput] = useState(
    formatMotionTimeValue(timing.startMs, timeUnit),
  );
  const [durationInput, setDurationInput] = useState(
    formatMotionTimeValue(timing.durationMs, timeUnit),
  );

  const syncInputs = useCallback(() => {
    setStartInput(formatMotionTimeValue(timing.startMs, timeUnit));
    setDurationInput(formatMotionTimeValue(timing.durationMs, timeUnit));
  }, [timeUnit, timing.durationMs, timing.startMs]);

  const commitTiming = useCallback(() => {
    const parsedStart = parseMotionTimeValue(startInput, timeUnit);
    const parsedDuration = parseMotionTimeValue(durationInput, timeUnit);
    if (
      parsedStart === null ||
      parsedDuration === null ||
      parsedDuration < 50
    ) {
      syncInputs();
      return;
    }
    const nextDuration = Math.max(
      50,
      Math.min(timelineDurationMs, parsedDuration),
    );
    const nextStart = Math.max(
      0,
      Math.min(parsedStart, timelineDurationMs - nextDuration),
    );
    onTimingChange(track, nextStart, nextDuration);
    setStartInput(formatMotionTimeValue(nextStart, timeUnit));
    setDurationInput(formatMotionTimeValue(nextDuration, timeUnit));
  }, [
    durationInput,
    onTimingChange,
    startInput,
    syncInputs,
    timeUnit,
    timelineDurationMs,
    track,
  ]);

  const firstEase = track.keyframes[0]?.ease ?? defaultEase;
  const animationLabel = t("designEditor.motion.editAnimation");

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          syncInputs();
          onOpen();
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute left-[97px] top-0 size-6 shrink-0"
          aria-label={animationLabel}
          title={animationLabel}
          disabled={readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <IconAdjustmentsHorizontal className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-64 space-y-3 p-3"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted-foreground">
            {t("designEditor.motion.type")}
          </span>
          <span className="truncate text-[11px] font-medium">
            {motionTrackDisplayLabel(track.property, t, track.isTextAnimation)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">
              {t("designEditor.motion.startTimeMs")}
            </span>
            <Input
              type="text"
              inputMode={timeUnit === "s" ? "decimal" : "numeric"}
              value={startInput}
              aria-label={t("designEditor.motion.startTimeMs")}
              disabled={readOnly}
              className="h-7 px-2 !text-xs"
              onChange={(event) => setStartInput(event.target.value)}
              onBlur={commitTiming}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitTiming();
                event.currentTarget.blur();
              }}
            />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">
              {t("designEditor.motion.duration")}
            </span>
            <Input
              type="text"
              inputMode={timeUnit === "s" ? "decimal" : "numeric"}
              value={durationInput}
              aria-label={t("designEditor.motion.durationMs")}
              disabled={readOnly}
              className="h-7 px-2 !text-xs"
              onChange={(event) => setDurationInput(event.target.value)}
              onBlur={commitTiming}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitTiming();
                event.currentTarget.blur();
              }}
            />
          </div>
        </div>
        <div
          aria-label={t("designEditor.motion.segmentEasing", {
            ease: easeLabel(firstEase, t),
          })}
          className="border-t border-border pt-2"
        >
          <EasingPanel
            ease={firstEase}
            easingVariables={easingVariables}
            onEasingVariablesChange={onEasingVariablesChange}
            disabled={readOnly}
            onChange={(ease) => onEaseChange(track, ease)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface LayerTrackRowsProps {
  layer: {
    nodeId: string;
    label: string;
    tracks: MotionDockTrack[];
    nativeStyles: MotionDockNativeStyleEntry[];
  };
  readOnly: boolean;
  expanded: boolean;
  playhead: number;
  timelineDurationMs: number;
  defaultEase: MotionEase;
  easingVariables: MotionEasingVariable[];
  onEasingVariablesChange?: (variables: MotionEasingVariable[]) => void;
  selectedTrackKey: string | null;
  selectedKeyframeKeys: ReadonlySet<string>;
  onSelectTrack: (track: MotionDockTrack) => void;
  onSelectKeyframe: (
    track: MotionDockTrack,
    t: number,
    extendSelection: boolean,
  ) => void;
  onJumpToPlayhead: (t: number) => void;
  onDeleteKeyframe: (track: MotionDockTrack, index: number) => void;
  onAddKeyframeAtTime: (track: MotionDockTrack, timeMs: number) => void;
  onBeginKeyframeDrag: (
    track: MotionDockTrack,
    index: number,
    extendSelection: boolean,
  ) => MotionKeyframeDragTarget[];
  onMoveKeyframes: (
    targets: MotionKeyframeDragTarget[],
    deltaMs: number,
    snapToTargets: boolean,
  ) => void;
  onMoveKeyframesEnd: (targets: MotionKeyframeDragTarget[]) => void;
  onEaseKeyframe: (
    track: MotionDockTrack,
    index: number,
    ease: MotionEase,
  ) => void;
  onLayerSpanChange: (
    nodeId: string,
    span: { startMs: number; durationMs: number },
  ) => void;
  selectedNativeStyleKey: string | null;
  onNativeStyleSpanChange?: (
    instance: MotionNativeStyleInstance,
    index: number,
    span: { startMs: number; durationMs: number },
  ) => void;
}

function LayerTrackRows({
  layer,
  readOnly,
  expanded,
  playhead: _playhead,
  timelineDurationMs,
  defaultEase,
  easingVariables,
  onEasingVariablesChange,
  selectedTrackKey,
  selectedKeyframeKeys,
  onSelectTrack,
  onSelectKeyframe,
  onJumpToPlayhead,
  onDeleteKeyframe,
  onAddKeyframeAtTime,
  onBeginKeyframeDrag,
  onMoveKeyframes,
  onMoveKeyframesEnd,
  onEaseKeyframe,
  onLayerSpanChange,
  selectedNativeStyleKey,
  onNativeStyleSpanChange,
}: LayerTrackRowsProps) {
  const t = useT();
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
            disabled={readOnly}
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
            readOnly={readOnly}
            timelineDurationMs={timelineDurationMs}
            defaultEase={defaultEase}
            easingVariables={easingVariables}
            onEasingVariablesChange={onEasingVariablesChange}
            selected={trackKey(track) === selectedTrackKey}
            onSelect={() => onSelectTrack(track)}
            selectedKeyframeKeys={selectedKeyframeKeys}
            onSelectKeyframe={(t, extendSelection) =>
              onSelectKeyframe(track, t, extendSelection)
            }
            onJumpToPlayhead={onJumpToPlayhead}
            onAddKeyframeAtTime={(timeMs) => onAddKeyframeAtTime(track, timeMs)}
            onDeleteKeyframe={(index) => onDeleteKeyframe(track, index)}
            onBeginKeyframeDrag={(index, extendSelection) =>
              onBeginKeyframeDrag(track, index, extendSelection)
            }
            onMoveKeyframes={onMoveKeyframes}
            onMoveKeyframesEnd={onMoveKeyframesEnd}
            onEaseKeyframe={(index, ease) => onEaseKeyframe(track, index, ease)}
          />
        ))}

      {expanded &&
        layer.nativeStyles.map((entry) => (
          <div
            key={entry.key}
            data-motion-native-style-track-row={entry.key}
            className="relative border-b border-border/40"
            style={{ height: ROW_HEIGHT }}
          >
            {isRunnableNativeStyle(entry.instance.styleKey) ? (
              <NativeStyleSpanBar
                entry={entry}
                label={nativeStyleDisplayLabel(entry.instance, t)}
                timelineDurationMs={timelineDurationMs}
                readOnly={readOnly}
                selected={selectedNativeStyleKey === entry.key}
                onSpanChange={onNativeStyleSpanChange}
              />
            ) : null}
          </div>
        ))}
    </>
  );
}

interface NativeStyleSpanBarProps {
  entry: MotionDockNativeStyleEntry;
  label: string;
  timelineDurationMs: number;
  readOnly: boolean;
  selected: boolean;
  onSpanChange?: (
    instance: MotionNativeStyleInstance,
    index: number,
    span: { startMs: number; durationMs: number },
  ) => void;
}

function NativeStyleSpanBar({
  entry,
  label,
  timelineDurationMs,
  readOnly,
  selected,
  onSpanChange,
}: NativeStyleSpanBarProps) {
  const t = useT();
  const barRef = useRef<HTMLDivElement>(null);
  const timing = nativeStyleTiming(entry.instance);
  const disabled = readOnly || !onSpanChange || !timing;
  const gesture = useRef<{
    kind: "move" | "left" | "right";
    startX: number;
    startMs: number;
    durationMs: number;
    pxPerMs: number;
  } | null>(null);

  const changeSpan = useCallback(
    (span: { startMs: number; durationMs: number }) => {
      onSpanChange?.(entry.instance, entry.index, span);
    },
    [entry.index, entry.instance, onSpanChange],
  );

  const beginGesture = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      kind: "move" | "left" | "right",
    ) => {
      if (disabled || !timing) return;
      const row = barRef.current?.parentElement;
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = row.getBoundingClientRect();
      if (rect.width <= 0) return;
      gesture.current = {
        kind,
        startX: event.clientX,
        startMs: timing.startMs,
        durationMs: Math.max(1, timing.endMs - timing.startMs),
        pxPerMs: rect.width / timelineDurationMs,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [disabled, timelineDurationMs, timing],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (!current) return;
      const deltaMs = (event.clientX - current.startX) / current.pxPerMs;
      const minimumStartMs = timing?.delayMs ?? 0;
      if (current.kind === "move") {
        const maxStartMs = Math.max(
          minimumStartMs,
          timelineDurationMs - current.durationMs,
        );
        changeSpan({
          startMs: Math.min(
            Math.max(minimumStartMs, current.startMs + deltaMs),
            maxStartMs,
          ),
          durationMs: current.durationMs,
        });
      } else if (current.kind === "right") {
        const durationMs = Math.max(
          50,
          Math.min(
            current.durationMs + deltaMs,
            timelineDurationMs - current.startMs,
          ),
        );
        changeSpan({ startMs: current.startMs, durationMs });
      } else {
        const endMs = current.startMs + current.durationMs;
        const startMs = Math.max(
          minimumStartMs,
          Math.min(current.startMs + deltaMs, endMs - 50),
        );
        changeSpan({ startMs, durationMs: endMs - startMs });
      }
    },
    [changeSpan, timelineDurationMs, timing?.delayMs],
  );

  const endGesture = useCallback(() => {
    gesture.current = null;
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (disabled || !timing || !onSpanChange) return;
      const direction =
        event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (!direction) return;
      event.preventDefault();
      const stepMs = Math.max(1, Math.round(timelineDurationMs / 100));
      const minimumStartMs = timing.delayMs;
      const maxStartMs = Math.max(
        minimumStartMs,
        timelineDurationMs - (timing.endMs - timing.startMs),
      );
      const startMs = Math.min(
        maxStartMs,
        Math.max(minimumStartMs, timing.startMs + direction * stepMs),
      );
      changeSpan({
        startMs,
        durationMs: timing.endMs - timing.startMs,
      });
    },
    [changeSpan, disabled, onSpanChange, timelineDurationMs, timing],
  );

  if (!timing) return null;

  const durationMs = timing.endMs - timing.startMs;
  const leftPct = (timing.startMs / timelineDurationMs) * 100;
  const widthPct = Math.max(0.5, (durationMs / timelineDurationMs) * 100);
  const ariaLabel = t("designEditor.motion.layerAnimationSpan", { label });

  return (
    <div
      ref={barRef}
      data-motion-native-style-span={entry.instance.styleKey}
      data-motion-native-style-key={entry.key}
      className={cn(
        "group absolute top-1/2 h-4 -translate-y-1/2 rounded-sm border border-primary/40 bg-primary/20",
        selected &&
          "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)]",
        entry.instance.enabled === false && "opacity-50",
        disabled
          ? "cursor-default"
          : "cursor-grab active:cursor-grabbing hover:bg-primary/30",
      )}
      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      onPointerDown={(event) => beginGesture(event, "move")}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onKeyDown={handleKeyDown}
      role="slider"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      aria-valuemin={Math.round(timing.delayMs)}
      aria-valuemax={timelineDurationMs}
      aria-valuenow={Math.round(timing.startMs)}
      aria-valuetext={`${Math.round(timing.startMs)}ms – ${Math.round(timing.endMs)}ms`}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
    >
      {!disabled ? (
        <>
          <div
            aria-hidden="true"
            data-motion-native-style-span-handle="start"
            className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-sm bg-primary/50 opacity-0 group-hover:opacity-100"
            onPointerDown={(event) => beginGesture(event, "left")}
            onPointerMove={handlePointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          />
          <div
            aria-hidden="true"
            data-motion-native-style-span-handle="end"
            className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-sm bg-primary/50 opacity-0 group-hover:opacity-100"
            onPointerDown={(event) => beginGesture(event, "right")}
            onPointerMove={handlePointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          />
        </>
      ) : null}
    </div>
  );
}

interface LayerSpanBarProps {
  spanStartMs: number;
  spanEndMs: number;
  timelineDurationMs: number;
  label: string;
  disabled: boolean;
  onSpanChange: (span: { startMs: number; durationMs: number }) => void;
}

function LayerSpanBar({
  spanStartMs,
  spanEndMs,
  timelineDurationMs,
  label,
  disabled,
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
      if (disabled) return;
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
    [disabled, spanEndMs, spanStartMs, timelineDurationMs],
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
      className={cn(
        "group absolute top-1/2 h-4 -translate-y-1/2 rounded-sm border border-primary/40 bg-primary/20",
        disabled
          ? "cursor-default"
          : "cursor-grab active:cursor-grabbing hover:bg-primary/30",
      )}
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
      aria-disabled={disabled}
      tabIndex={-1}
    >
      {/* Edge handles: scale the layer's animations */}
      {!disabled ? (
        <>
          <div
            data-motion-span-handle="start"
            className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-sm bg-primary/50 opacity-0 group-hover:opacity-100"
            onPointerDown={(e) => beginGesture(e, "left")}
          />
          <div
            data-motion-span-handle="end"
            className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-sm bg-primary/50 opacity-0 group-hover:opacity-100"
            onPointerDown={(e) => beginGesture(e, "right")}
          />
        </>
      ) : null}
    </div>
  );
}

interface TrackRowProps {
  track: MotionDockTrack;
  readOnly: boolean;
  timelineDurationMs: number;
  defaultEase: MotionEase;
  easingVariables: MotionEasingVariable[];
  onEasingVariablesChange?: (variables: MotionEasingVariable[]) => void;
  selected: boolean;
  selectedKeyframeKeys: ReadonlySet<string>;
  onSelect: () => void;
  onSelectKeyframe: (t: number, extendSelection: boolean) => void;
  onJumpToPlayhead: (t: number) => void;
  onAddKeyframeAtTime: (timeMs: number) => void;
  onDeleteKeyframe: (index: number) => void;
  onBeginKeyframeDrag: (
    index: number,
    extendSelection: boolean,
  ) => MotionKeyframeDragTarget[];
  onMoveKeyframes: (
    targets: MotionKeyframeDragTarget[],
    deltaMs: number,
    snapToTargets: boolean,
  ) => void;
  onMoveKeyframesEnd: (targets: MotionKeyframeDragTarget[]) => void;
  onEaseKeyframe: (index: number, ease: MotionEase) => void;
}

function TrackRow({
  track,
  readOnly,
  timelineDurationMs,
  defaultEase,
  easingVariables,
  onEasingVariablesChange,
  selected,
  selectedKeyframeKeys,
  onSelect,
  onSelectKeyframe,
  onJumpToPlayhead,
  onAddKeyframeAtTime,
  onDeleteKeyframe,
  onBeginKeyframeDrag,
  onMoveKeyframes,
  onMoveKeyframesEnd,
  onEaseKeyframe,
}: TrackRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const timing = getMotionTrackTiming(track, timelineDurationMs);
  const fractionFor = (kfT: number) =>
    (timing.startMs + kfT * timing.durationMs) / timelineDurationMs;

  const dragging = useRef<{
    targets: MotionKeyframeDragTarget[];
    startX: number;
    moved: boolean;
  } | null>(null);

  const handleDiamondPointerDown = useCallback(
    (
      e: ReactPointerEvent<SVGSVGElement>,
      index: number,
      kf: MotionKeyframe,
    ) => {
      e.stopPropagation();
      const extendSelection = e.shiftKey || e.metaKey || e.ctrlKey;
      const alreadySelected = selectedKeyframeKeys.has(
        keyframeSelectionKey(track, kf.t),
      );
      if (extendSelection || !alreadySelected) {
        onSelectKeyframe(kf.t, extendSelection);
      }
      if (readOnly) return;
      const targets = onBeginKeyframeDrag(index, extendSelection);
      if (targets.length === 0) return;
      dragging.current = {
        targets,
        startX: e.clientX,
        moved: false,
      };
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [
      onBeginKeyframeDrag,
      onSelectKeyframe,
      readOnly,
      selectedKeyframeKeys,
      track,
    ],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current || !rowRef.current) return;
      const rect = rowRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const dx = e.clientX - dragging.current.startX;
      if (Math.abs(dx) < 0.5) return;
      dragging.current.moved = true;
      onMoveKeyframes(
        dragging.current.targets,
        (dx / rect.width) * timelineDurationMs,
        e.shiftKey,
      );
    },
    [onMoveKeyframes, timelineDurationMs],
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragging.current;
    dragging.current = null;
    if (drag?.moved) onMoveKeyframesEnd(drag.targets);
  }, [onMoveKeyframesEnd]);

  const orderedIndices = track.keyframes
    .map((kf, index) => ({ t: kf.t, index }))
    .sort((a, b) => a.t - b.t)
    .map((entry) => entry.index);

  return (
    <div
      ref={rowRef}
      data-motion-track-row
      className={cn(
        "relative border-b border-border/30",
        selected && "bg-accent/20",
      )}
      style={{ height: ROW_HEIGHT }}
      onClick={onSelect}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement;
        if (
          readOnly ||
          target.closest(
            "[data-motion-keyframe], [role=slider], [data-motion-marquee-ignore]",
          )
        ) {
          return;
        }
        const rect = rowRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        event.preventDefault();
        const position = Math.max(
          0,
          Math.min(1, (event.clientX - rect.left) / rect.width),
        );
        const timeMs = position * timelineDurationMs;
        onAddKeyframeAtTime(timeMs);
        onJumpToPlayhead(position);
      }}
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
            easingVariables={easingVariables}
            onEasingVariablesChange={onEasingVariablesChange}
            onEaseChange={(ease) => onEaseKeyframe(kfIndex, ease)}
            disabled={readOnly}
          />
        );
      })}

      {/* Keyframe diamonds */}
      {track.keyframes.map((kf, i) => (
        <KeyframeDiamond
          key={i}
          kf={kf}
          selectionKey={keyframeSelectionKey(track, kf.t)}
          leftFraction={fractionFor(kf.t)}
          timeMs={Math.round(timing.startMs + kf.t * timing.durationMs)}
          selected={selectedKeyframeKeys.has(keyframeSelectionKey(track, kf.t))}
          onSelect={(extendSelection) =>
            onSelectKeyframe(kf.t, extendSelection)
          }
          onDoubleClick={() =>
            onJumpToPlayhead(
              Math.max(
                0,
                Math.min(
                  1,
                  (timing.startMs + kf.t * timing.durationMs) /
                    timelineDurationMs,
                ),
              ),
            )
          }
          onPointerDown={(e) => handleDiamondPointerDown(e, i, kf)}
          onDelete={() => onDeleteKeyframe(i)}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

interface KeyframeDiamondProps {
  kf: MotionKeyframe;
  selectionKey: string;
  leftFraction: number;
  timeMs: number;
  selected: boolean;
  readOnly: boolean;
  onSelect: (extendSelection: boolean) => void;
  onDoubleClick: () => void;
  onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onDelete: () => void;
}

function KeyframeDiamond({
  kf,
  selectionKey,
  leftFraction,
  timeMs,
  selected,
  readOnly,
  onSelect,
  onDoubleClick,
  onPointerDown,
  onDelete,
}: KeyframeDiamondProps) {
  const t = useT();
  const [hovered, setHovered] = useState(false);

  return (
    <div
      data-motion-keyframe
      data-motion-selection-key={selectionKey}
      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 group"
      style={{ left: `${leftFraction * 100}%` }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <svg
            width={10}
            height={10}
            viewBox="0 0 10 10"
            className={
              readOnly ? "cursor-default" : "cursor-grab active:cursor-grabbing"
            }
            onPointerDown={onPointerDown}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDoubleClick();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onSelect(event.shiftKey || event.metaKey || event.ctrlKey);
            }}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            aria-label={t("designEditor.motion.keyframeAt", { ms: timeMs })}
            aria-pressed={selected}
            role="button"
            tabIndex={0}
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
                selected
                  ? "fill-primary stroke-primary-foreground"
                  : hovered
                    ? "fill-primary/20 stroke-primary"
                    : "fill-background stroke-primary",
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
          {!readOnly ? (
            <button
              type="button"
              className="ml-1 text-destructive hover:text-destructive/80"
              onClick={onDelete}
              aria-label={t("designEditor.motion.deleteKeyframe")}
            >
              <IconTrash className="size-3" />
            </button>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

interface EasingSegmentProps {
  left: number;
  width: number;
  ease: MotionEase | undefined;
  defaultEase: MotionEase;
  easingVariables: MotionEasingVariable[];
  onEasingVariablesChange?: (variables: MotionEasingVariable[]) => void;
  disabled: boolean;
  onEaseChange: (ease: MotionEase) => void;
}

function EasingSegment({
  left,
  width,
  ease,
  defaultEase,
  easingVariables,
  onEasingVariablesChange,
  disabled,
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
          disabled={disabled}
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
        <EasingPanel
          ease={effective}
          easingVariables={easingVariables}
          onEasingVariablesChange={onEasingVariablesChange}
          disabled={disabled}
          onChange={onEaseChange}
        />
      </PopoverContent>
    </Popover>
  );
}

interface EasingPanelProps {
  ease: MotionEase;
  easingVariables: MotionEasingVariable[];
  onEasingVariablesChange?: (variables: MotionEasingVariable[]) => void;
  disabled: boolean;
  onChange: (ease: MotionEase) => void;
}

function EasingPanel({
  ease,
  easingVariables,
  onEasingVariablesChange,
  disabled,
  onChange,
}: EasingPanelProps) {
  const t = useT();
  const easeStr = String(ease);
  const variableId = motionEaseVariableId(easeStr);
  const variable = easingVariables.find(
    (candidate) => candidate.id === variableId,
  );
  const curveValue = variable?.value ?? easeStr;
  const spring = parseSpringToken(curveValue);
  const bezierMatch = /^cubic-bezier\(([^)]+)\)$/.exec(curveValue);
  const bezierPoints: [number, number, number, number] = (() => {
    if (bezierMatch) {
      const parts = bezierMatch[1].split(",").map((part) => parseFloat(part));
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        return [parts[0], parts[1], parts[2], parts[3]];
      }
    }
    return [0.42, 0, 0.58, 1];
  })();
  const bounce = spring?.bounce ?? MOTION_SPRING_DEFAULT_BOUNCE;
  const settle = spring?.settle ?? 1;
  const updateCurve = (value: string) => {
    if (variable && onEasingVariablesChange) {
      onEasingVariablesChange(
        easingVariables.map((candidate) =>
          candidate.id === variable.id ? { ...candidate, value } : candidate,
        ),
      );
      return;
    }
    if (variableId) return;
    onChange(value as MotionEase);
  };

  return (
    <div className="flex flex-col gap-2">
      <MotionEasingPicker
        value={easeStr}
        easingVariables={easingVariables}
        onEasingVariablesChange={onEasingVariablesChange}
        disabled={disabled}
        t={t}
        onChange={(value) => onChange(value as MotionEase)}
      />
      {bezierMatch ? (
        <CurveEditor
          value={bezierPoints}
          onChange={(points) =>
            updateCurve(
              `cubic-bezier(${points
                .map((n) => Math.round(n * 100) / 100)
                .join(", ")})`,
            )
          }
        />
      ) : null}
      {spring ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
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
            disabled={disabled || Boolean(variable && !onEasingVariablesChange)}
            onValueChange={(values) =>
              updateCurve(springToken({ bounce: values[0] ?? bounce, settle }))
            }
            aria-label={t("designEditor.motion.bounce")}
          />
          <SpringCurvePreview bounce={bounce} settle={settle} />
        </div>
      ) : null}
    </div>
  );
}

const CURVE_W = 216;
const CURVE_H = 132;
const CURVE_PAD = 10;
const CURVE_Y_MIN = -0.25;
const CURVE_Y_MAX = 1.25;

interface CurveEditorProps {
  value: [number, number, number, number];
  onChange: (value: [number, number, number, number]) => void;
}

export function formatCurveAxisValue(n: number): string {
  return String(Math.round(n * 100) / 100);
}

interface CurveNumberFieldProps {
  label: string;
  value: number;
  onChange: (n: number) => void;
}

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
