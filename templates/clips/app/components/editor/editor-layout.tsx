import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { FileStorageSetupCard } from "@agent-native/core/client/setup-connections";
import { IconInfoCircle } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { StorageStatusRetry } from "@/components/recorder/storage-status-retry";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

async function readAppStateClient<T = unknown>(key: string): Promise<T | null> {
  try {
    const r = await fetch(
      agentNativePath(
        `/_agent-native/application-state/${encodeURIComponent(key)}`,
      ),
    );
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}
async function writeAppStateClient(key: string, value: unknown): Promise<void> {
  try {
    await fetch(
      agentNativePath(
        `/_agent-native/application-state/${encodeURIComponent(key)}`,
      ),
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
        keepalive: true,
      },
    );
  } catch {
    // noop
  }
}

import { useVideoStorageStatus } from "@/hooks/use-video-storage-status";
import { withMediaVersion } from "@/lib/media-url";
import {
  parsePlaybackSpeed,
  readPlaybackSpeedPreference,
  savePlaybackSpeedPreference,
  SLOW_SPEED_CEILING,
} from "@/lib/playback-speed";
import { canOfferRewindHistory } from "@/lib/rewind-visibility";
import {
  addCut,
  addSplitAt,
  buildTimelinePieces,
  formatMs,
  getExcludedRanges,
  parseEdits,
  removeCut,
  removeSplit,
  skipExcludedRange,
  visibleSplitPoints,
  type EditsJson,
  type TrimRange,
} from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";
import {
  extractFilmstripThumbnails,
  type FilmstripFrame,
  type FilmstripSprite,
} from "@/lib/video-filmstrip";
import {
  clampRedactionToDuration,
  DEFAULT_REDACTION_STYLE,
  newRedactionId,
  otherOverlays,
  parseRedactions,
  setRedactionKey,
  type RedactionRect,
  type RedactionStyle,
  type VideoRedaction,
} from "@/lib/video-redactions";
import { computePeaks, type WaveformPeaks } from "@/lib/waveform-peaks";

import { ChaptersEditor } from "./chapters-editor";
import { EditorToolbar } from "./editor-toolbar";
import { RedactionLane } from "./redaction-lane";
import { RedactionOverlay } from "./redaction-overlay";
import { RewindExtensionDialog } from "./rewind-extension-dialog";
import { StitchManager } from "./stitch-manager";
import { ThumbnailPicker } from "./thumbnail-picker";
import { Timeline } from "./timeline";
import { getTimelineTotalWidth } from "./timeline-geometry";
import { TimelineTrack, type TrackSelection } from "./timeline-track";
import { TranscriptEditor } from "./transcript-editor";
import { Waveform } from "./waveform";

export interface EditorLayoutProps {
  recordingId: string;
  className?: string;
}

interface EditSnapshot {
  trims: TrimRange[];
  overlays: unknown[];
}

function snapshotOf(edits: EditsJson): EditSnapshot {
  return { trims: edits.trims, overlays: edits.overlays ?? [] };
}

function sameList(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const MAX_UNREADABLE_BURN_POLLS = 12;

const BURN_REGISTRATION_GRACE_MS = 15_000;

function HelpPopover({
  label,
  lead,
  rows,
}: {
  label: string;
  lead?: string;
  rows: Array<{ term?: string; text: string }>;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <IconInfoCircle className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className="max-h-[var(--radix-popover-content-available-height)] w-80 overflow-y-auto text-[11px] leading-relaxed"
      >
        <p className="text-xs font-semibold">{label}</p>
        {lead ? (
          <p className="mt-1 font-medium text-amber-600 dark:text-amber-400">
            {lead}
          </p>
        ) : null}
        <dl className="mt-2 space-y-1.5">
          {rows.map((row, index) => (
            <div key={index}>
              {row.term ? (
                <dt className="font-medium text-foreground">{row.term}</dt>
              ) : null}
              <dd className="text-muted-foreground">{row.text}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

function RedactionStyleToggle({
  value,
  onChange,
  t,
}: {
  value: RedactionStyle;
  onChange: (style: RedactionStyle) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
}) {
  return (
    <span className="inline-flex shrink-0 overflow-hidden rounded-full border border-border text-[11px]">
      {(["mosaic", "solid"] as const).map((style) => (
        <button
          key={style}
          type="button"
          aria-pressed={value === style}
          className={cn(
            "px-2 py-0.5",
            value === style
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
          title={t(
            style === "mosaic"
              ? "redaction.styleBlurHint"
              : "redaction.styleSolidHint",
          )}
          onClick={() => onChange(style)}
        >
          {t(
            style === "mosaic" ? "redaction.styleBlur" : "redaction.styleSolid",
          )}
        </button>
      ))}
    </span>
  );
}

const WAVEFORM_HEIGHT = 50;
const HISTORY_LIMIT = 50;
const MIN_TIMELINE_ZOOM = 1;
const MAX_TIMELINE_ZOOM = 50;

function contentWidthOf(el: HTMLElement): number {
  const style =
    typeof window === "undefined" ? null : window.getComputedStyle(el);
  const padding = style
    ? Number.parseFloat(style.paddingLeft || "0") +
      Number.parseFloat(style.paddingRight || "0")
    : 0;
  return Math.max(0, el.clientWidth - (Number.isFinite(padding) ? padding : 0));
}

function clampTimelineZoom(value: number): number {
  if (!Number.isFinite(value)) return MIN_TIMELINE_ZOOM;
  const clamped = Math.max(
    MIN_TIMELINE_ZOOM,
    Math.min(MAX_TIMELINE_ZOOM, value),
  );
  return Math.round(clamped * 10) / 10;
}

function normalizeWheelDeltaY(
  event: WheelEvent,
  viewportWidth: number,
): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * viewportWidth;
  return event.deltaY;
}

function shouldProxyWaveformUrl(videoUrl: string): boolean {
  try {
    const parsed = new URL(
      videoUrl,
      typeof window === "undefined"
        ? "http://local.test"
        : window.location.href,
    );
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    if (
      typeof window !== "undefined" &&
      parsed.origin === window.location.origin
    ) {
      return false;
    }
    return /^https?:\/\//i.test(videoUrl);
  } catch {
    return false;
  }
}

function getWaveformMediaUrl({
  recordingId,
  videoUrl,
}: {
  recordingId: string;
  videoUrl: string | null;
}): string | null {
  if (!videoUrl) return null;
  if (!shouldProxyWaveformUrl(videoUrl)) {
    return videoUrl.startsWith("/") ? `${appBasePath()}${videoUrl}` : videoUrl;
  }

  return `${appBasePath()}/api/video/${encodeURIComponent(recordingId)}`;
}

export function EditorLayout({ recordingId, className }: EditorLayoutProps) {
  const t = useT();
  const videoStorageStatus = useVideoStorageStatus();
  const [storageSetupOpen, setStorageSetupOpen] = useState(false);
  useEffect(() => {
    if (
      storageSetupOpen &&
      videoStorageStatus.data?.configured &&
      !videoStorageStatus.isError
    ) {
      setStorageSetupOpen(false);
    }
  }, [
    storageSetupOpen,
    videoStorageStatus.data?.configured,
    videoStorageStatus.isError,
  ]);
  const playerDataQuery = useActionQuery("get-recording-player-data", {
    recordingId,
  });

  const playerData: any = playerDataQuery.data;
  const recording: any = playerData?.recording;
  const durationMs = recording?.durationMs ?? 0;
  const videoUrl: string | null = recording?.videoUrl ?? null;
  const videoFormat: "webm" | "mp4" = recording?.videoFormat ?? "webm";
  const editorVideoUrl = useMemo(
    () =>
      videoUrl
        ? withMediaVersion(
            videoUrl,
            recording?.mediaUpdatedAt ?? recording?.videoSizeBytes ?? null,
          )
        : null,
    [recording?.mediaUpdatedAt, recording?.videoSizeBytes, videoUrl],
  );
  const defaultPreviewSpeed = useMemo(
    () => parsePlaybackSpeed(recording?.defaultSpeed) ?? 1.2,
    [recording?.defaultSpeed],
  );

  const [selection, setSelection] = useState<TrackSelection | null>(null);
  const [previewEdits, setPreviewEdits] = useState<EditsJson | null>(null);
  const [pendingTrims, setPendingTrims] = useState<TrimRange[] | null>(null);
  const [pendingOverlays, setPendingOverlays] = useState<unknown[] | null>(
    null,
  );
  const [previewRedactions, setPreviewRedactions] = useState<
    VideoRedaction[] | null
  >(null);
  const [selectedRedactionId, setSelectedRedactionId] = useState<string | null>(
    null,
  );
  const [redactMode, setRedactMode] = useState(false);
  const [redactionStyle, setRedactionStyle] = useState<RedactionStyle>(
    DEFAULT_REDACTION_STYLE,
  );
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [burning, setBurning] = useState(false);
  const burnStorageCheckInFlightRef = useRef(false);
  const burnToastRef = useRef<string | number | null>(null);
  const undoStackRef = useRef<EditSnapshot[]>([]);
  const redoStackRef = useRef<EditSnapshot[]>([]);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });

  const edits: EditsJson = useMemo(
    () => parseEdits(recording?.editsJson),
    [recording?.editsJson],
  );
  const chapters: Array<{ startMs: number; title: string }> = useMemo(() => {
    if (Array.isArray(playerData?.chapters)) return playerData.chapters;
    try {
      return recording?.chaptersJson ? JSON.parse(recording.chaptersJson) : [];
    } catch {
      return [];
    }
  }, [playerData?.chapters, recording?.chaptersJson]);

  const savedEdits: EditsJson = useMemo(() => {
    const next = pendingTrims ? { ...edits, trims: pendingTrims } : edits;
    return pendingOverlays ? { ...next, overlays: pendingOverlays } : next;
  }, [edits, pendingOverlays, pendingTrims]);
  const shownEdits: EditsJson = previewEdits ?? savedEdits;

  const savedRedactions = useMemo(
    () =>
      parseRedactions(savedEdits.overlays).map((r) =>
        clampRedactionToDuration(r, durationMs),
      ),
    [durationMs, savedEdits],
  );
  const redactions = previewRedactions ?? savedRedactions;
  const selectedRedaction = useMemo(
    () => redactions.find((r) => r.id === selectedRedactionId) ?? null,
    [redactions, selectedRedactionId],
  );

  const excludedRanges = useMemo(
    () => getExcludedRanges(savedEdits),
    [savedEdits],
  );
  const shownExcludedRanges = useMemo(
    () => getExcludedRanges(shownEdits),
    [shownEdits],
  );
  const splitPoints = useMemo(
    () => visibleSplitPoints(shownEdits, durationMs),
    [durationMs, shownEdits],
  );
  const pieces = useMemo(
    () => buildTimelinePieces(durationMs, shownEdits),
    [durationMs, shownEdits],
  );
  const selectedClip = useMemo(() => {
    if (selection?.kind !== "clip") return null;
    const piece = pieces.find(
      (p) =>
        p.kind === "clip" &&
        selection.anchorMs >= p.startMs &&
        selection.anchorMs < p.endMs,
    );
    return piece ? { startMs: piece.startMs, endMs: piece.endMs } : null;
  }, [pieces, selection]);

  const transcriptSegments: Array<{
    startMs: number;
    endMs: number;
    text: string;
  }> = useMemo(() => {
    const raw = playerData?.transcript?.segments;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    }
    return [];
  }, [playerData?.transcript?.segments]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(() =>
    readPlaybackSpeedPreference(1.2),
  );
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(800);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [editingSurface, setEditingSurface] = useState<
    "transcript" | "timeline"
  >("timeline");
  const activeSurface = redactMode ? "timeline" : editingSurface;

  const [thumbOpen, setThumbOpen] = useState(false);
  const [stitchOpen, setStitchOpen] = useState(false);
  const [rewindOpen, setRewindOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const trackpadGestureRef = useRef<{
    zoom: number;
    scrollLeft: number;
    anchorRatio: number;
    viewportX: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(([entry]) => {
      const measured = entry?.contentRect.width ?? contentWidthOf(el);
      setViewportWidth(Math.max(1, Math.floor(measured)));
    });
    ro.observe(el);
    setViewportWidth(Math.max(1, Math.floor(contentWidthOf(el))));
    return () => ro.disconnect();
  }, [activeSurface]);

  const totalWidth = useMemo(
    () => getTimelineTotalWidth(viewportWidth, zoom),
    [viewportWidth, zoom],
  );

  const clampedScrollLeft = Math.min(
    scrollLeft,
    Math.max(0, totalWidth - viewportWidth),
  );

  const handleTimelineWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const maxScroll = Math.max(0, totalWidth - viewportWidth);
      if (maxScroll <= 0) return;
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY)
          ? e.deltaX
          : e.shiftKey
            ? e.deltaY
            : 0;
      if (delta === 0) return;
      e.preventDefault();
      setScrollLeft((current) =>
        Math.max(0, Math.min(maxScroll, current + delta)),
      );
    },
    [totalWidth, viewportWidth],
  );

  const calculateAnchoredScrollLeft = useCallback(
    (
      nextZoom: number,
      anchor?: { anchorRatio?: number; viewportX?: number },
    ) => {
      const nextTotalWidth = getTimelineTotalWidth(viewportWidth, nextZoom);
      const maxScrollLeft = Math.max(0, nextTotalWidth - viewportWidth);
      const anchorMs = selectedClip
        ? (selectedClip.startMs + selectedClip.endMs) / 2
        : playheadMs;
      const fallbackAnchorRatio =
        durationMs > 0
          ? Math.max(0, Math.min(durationMs, anchorMs)) / durationMs
          : 0;
      const anchorRatio = Math.max(
        0,
        Math.min(1, anchor?.anchorRatio ?? fallbackAnchorRatio),
      );
      const viewportX =
        typeof anchor?.viewportX === "number"
          ? Math.max(0, Math.min(viewportWidth, anchor.viewportX))
          : viewportWidth / 2;
      const anchorX = anchorRatio * nextTotalWidth;
      return Math.max(0, Math.min(maxScrollLeft, anchorX - viewportX));
    },
    [durationMs, playheadMs, selectedClip, viewportWidth],
  );

  const setAnchoredZoom = useCallback(
    (
      nextZoom: number,
      anchor?: { anchorRatio?: number; viewportX?: number },
    ) => {
      const clamped = clampTimelineZoom(nextZoom);
      setZoom(clamped);
      setScrollLeft(calculateAnchoredScrollLeft(clamped, anchor));
    },
    [calculateAnchoredScrollLeft],
  );

  const handleZoomChange = useCallback(
    (nextZoom: number) => setAnchoredZoom(nextZoom),
    [setAnchoredZoom],
  );

  useEffect(() => {
    setScrollLeft((current) =>
      Math.min(current, Math.max(0, totalWidth - viewportWidth)),
    );
  }, [totalWidth, viewportWidth]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const getViewportX = (clientX?: number) => {
      if (typeof clientX !== "number") return viewportWidth / 2;
      const rect = el.getBoundingClientRect();
      return Math.max(0, Math.min(viewportWidth, clientX - rect.left));
    };

    const getAnchorRatio = (
      sourceZoom: number,
      sourceScrollLeft: number,
      viewportX: number,
    ) => {
      const sourceTotalWidth = getTimelineTotalWidth(viewportWidth, sourceZoom);
      return Math.max(
        0,
        Math.min(
          1,
          (sourceScrollLeft + viewportX) / Math.max(1, sourceTotalWidth),
        ),
      );
    };

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const deltaY = normalizeWheelDeltaY(event, viewportWidth);
      if (Math.abs(deltaY) < 0.01) return;
      const viewportX = getViewportX(event.clientX);
      const anchorRatio = getAnchorRatio(zoom, scrollLeft, viewportX);
      const nextZoom = clampTimelineZoom(zoom * Math.exp(-deltaY * 0.006));
      if (nextZoom === zoom) return;
      setAnchoredZoom(nextZoom, { anchorRatio, viewportX });
    };

    const handleGestureStart = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { clientX?: number };
      const viewportX = getViewportX(gesture.clientX);
      trackpadGestureRef.current = {
        zoom,
        scrollLeft,
        anchorRatio: getAnchorRatio(zoom, scrollLeft, viewportX),
        viewportX,
      };
    };

    const handleGestureChange = (event: Event) => {
      const start = trackpadGestureRef.current;
      if (!start) return;
      event.preventDefault();
      const gesture = event as Event & { scale?: number };
      const scale =
        typeof gesture.scale === "number" && Number.isFinite(gesture.scale)
          ? gesture.scale
          : 1;
      const nextZoom = clampTimelineZoom(start.zoom * scale);
      if (nextZoom === zoom) return;
      setAnchoredZoom(nextZoom, {
        anchorRatio: start.anchorRatio,
        viewportX: start.viewportX,
      });
    };

    const handleGestureEnd = () => {
      trackpadGestureRef.current = null;
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("gesturestart", handleGestureStart, {
      passive: false,
    });
    el.addEventListener("gesturechange", handleGestureChange, {
      passive: false,
    });
    el.addEventListener("gestureend", handleGestureEnd);
    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("gesturestart", handleGestureStart);
      el.removeEventListener("gesturechange", handleGestureChange);
      el.removeEventListener("gestureend", handleGestureEnd);
    };
  }, [scrollLeft, setAnchoredZoom, viewportWidth, zoom]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  }, [playing]);

  useEffect(() => {
    if (!recording?.id) return;
    const next = readPlaybackSpeedPreference(defaultPreviewSpeed);
    setPlaybackSpeed(next);
    if (videoRef.current) {
      videoRef.current.defaultPlaybackRate = next;
      videoRef.current.playbackRate = next;
    }
  }, [defaultPreviewSpeed, recording?.id]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.defaultPlaybackRate = playbackSpeed;
    v.playbackRate = playbackSpeed;
  }, [playbackSpeed, videoUrl]);

  const handlePlaybackSpeedChange = useCallback((rate: number) => {
    const next = parsePlaybackSpeed(rate) ?? 1.2;
    setPlaybackSpeed(next);
    savePlaybackSpeedPreference(next);
    if (videoRef.current) {
      videoRef.current.defaultPlaybackRate = next;
      videoRef.current.playbackRate = next;
    }
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      const rawMs = v.currentTime * 1000;
      const visibleMs = skipExcludedRange(rawMs, excludedRanges, durationMs);
      if (visibleMs !== rawMs) v.currentTime = visibleMs / 1000;
      setPlayheadMs(visibleMs);
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [durationMs, excludedRanges, videoUrl]);

  useEffect(() => {
    void writeAppStateClient("editor-draft", {
      recordingId,
      playheadMs: Math.round(playheadMs),
      playbackSpeed,
      zoom,
      editsJson: savedEdits,
    });
  }, [recordingId, playheadMs, playbackSpeed, zoom, savedEdits]);

  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null);
  const waveformMediaUrl = useMemo(
    () =>
      getWaveformMediaUrl({
        recordingId,
        videoUrl,
      }),
    [recordingId, videoUrl],
  );

  useEffect(() => {
    if (!waveformMediaUrl) return;
    let cancelled = false;
    void (async () => {
      const cached = await readAppStateClient<WaveformPeaks>(
        `waveform-${recordingId}`,
      );
      if (cached?.peaks && cached.bucketCount) {
        if (!cancelled) setPeaks(cached);
        return;
      }
      const result = await computePeaks(waveformMediaUrl);
      if (cancelled) return;
      setPeaks(result);
      if (result) {
        await writeAppStateClient(`waveform-${recordingId}`, result);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordingId, waveformMediaUrl]);

  const filmstripSprite = useMemo<FilmstripSprite | null>(() => {
    const url = recording?.filmstripUrl;
    const frameCount = Number(recording?.filmstripFrameCount ?? 0);
    const columns = Number(recording?.filmstripColumns ?? 0);
    if (!url || frameCount <= 0 || columns <= 0) return null;
    return {
      url,
      frameCount,
      columns,
      rows: Number(recording?.filmstripRows ?? 1) || 1,
      frameWidth: Number(recording?.filmstripFrameWidth ?? 0) || 160,
      frameHeight: Number(recording?.filmstripFrameHeight ?? 0) || 90,
    };
  }, [
    recording?.filmstripUrl,
    recording?.filmstripFrameCount,
    recording?.filmstripColumns,
    recording?.filmstripRows,
    recording?.filmstripFrameWidth,
    recording?.filmstripFrameHeight,
  ]);

  const [filmstripFrames, setFilmstripFrames] = useState<FilmstripFrame[]>([]);

  useEffect(() => {
    setFilmstripFrames([]);
  }, [recordingId]);

  const filmstripFrameCount = useMemo(() => {
    const bucketedWidth = Math.max(240, Math.round(viewportWidth / 120) * 120);
    const cellWidth = WAVEFORM_HEIGHT * (16 / 9);
    return Math.min(48, Math.max(6, Math.round(bucketedWidth / cellWidth)));
  }, [viewportWidth]);

  useEffect(() => {
    if (activeSurface !== "timeline" || filmstripSprite) {
      setFilmstripFrames([]);
      return;
    }
    if (!waveformMediaUrl || durationMs <= 0) {
      setFilmstripFrames([]);
      return;
    }
    setFilmstripFrames([]);
    let cancelled = false;
    extractFilmstripThumbnails({
      videoUrl: waveformMediaUrl,
      durationMs,
      frameCount: filmstripFrameCount,
    })
      .then((result) => {
        if (cancelled) return;
        if (result.status !== "ok") {
          console.warn("[editor] filmstrip extraction failed", {
            recordingId,
            status: result.status,
            detail: result.detail,
          });
        }
        setFilmstripFrames(result.frames);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[editor] filmstrip extraction threw", {
          recordingId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    recordingId,
    waveformMediaUrl,
    durationMs,
    activeSurface,
    filmstripFrameCount,
    filmstripSprite,
  ]);

  const setTrims = useActionMutation("set-recording-trims");

  const pushHistory = useCallback((snapshot: EditSnapshot) => {
    undoStackRef.current = [...undoStackRef.current, snapshot].slice(
      -HISTORY_LIMIT,
    );
    redoStackRef.current = [];
    setHistory({ undo: undoStackRef.current.length, redo: 0 });
  }, []);

  const dropNewestHistory = useCallback(() => {
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setHistory({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    });
  }, []);

  const commitEdits = useCallback(
    async (next: EditsJson, options?: { record?: boolean }) => {
      const record = options?.record ?? true;
      if (record) pushHistory(snapshotOf(savedEdits));
      setPendingTrims(next.trims);
      try {
        await setTrims.mutateAsync({ recordingId, trims: next.trims });
        await playerDataQuery.refetch();
        return true;
      } catch (err: any) {
        if (record) dropNewestHistory();
        toast.error(err?.message ?? t("editorLayout.editFailed"));
        return false;
      } finally {
        setPendingTrims(null);
      }
    },
    [
      dropNewestHistory,
      playerDataQuery,
      pushHistory,
      recordingId,
      savedEdits,
      setTrims,
      t,
    ],
  );

  const setOverlays = useActionMutation("set-recording-overlays");
  const burnRedactions = useActionMutation("burn-recording-redactions");
  const [burnPercent, setBurnPercent] = useState(0);
  const refetchPlayerDataRef = useRef(playerDataQuery.refetch);
  refetchPlayerDataRef.current = playerDataQuery.refetch;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${appBasePath()}/api/redaction-burn-progress?id=${encodeURIComponent(
            recordingId,
          )}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (!cancelled && data.status === "running") setBurning(true);
      } catch (err) {
        console.warn("[editor] could not check for a running burn", {
          recordingId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordingId]);

  useEffect(() => {
    if (!burning) {
      setBurnPercent(0);
      return;
    }

    let unreadable = 0;
    let sawRunning = false;
    const startedAt = Date.now();
    const givingUp = () => {
      unreadable += 1;
      if (unreadable < MAX_UNREADABLE_BURN_POLLS) return;
      setBurning(false);
      if (burnToastRef.current !== null) toast.dismiss(burnToastRef.current);
      burnToastRef.current = null;
      toast.message(t("editorLayout.burnProgressUnreadable"));
    };

    const poll = async () => {
      try {
        const res = await fetch(
          `${appBasePath()}/api/redaction-burn-progress?id=${encodeURIComponent(
            recordingId,
          )}`,
        );
        if (!res.ok) {
          givingUp();
          return;
        }
        unreadable = 0;
        const data = (await res.json()) as {
          status?: string;
          percent?: number;
          error?: string;
        };
        if (typeof data.percent === "number") setBurnPercent(data.percent);
        if (data.status === "running") {
          sawRunning = true;
          return;
        }
        if (
          data.status === "idle" &&
          !sawRunning &&
          Date.now() - startedAt < BURN_REGISTRATION_GRACE_MS
        ) {
          return;
        }

        setBurning(false);
        if (burnToastRef.current !== null) toast.dismiss(burnToastRef.current);
        burnToastRef.current = null;

        const refreshed = await refetchPlayerDataRef.current();
        const overlaysLeft = parseRedactions(
          parseEdits((refreshed?.data as any)?.recording?.editsJson).overlays,
        ).length;
        if (
          data.status === "done" ||
          (data.status === "idle" && !overlaysLeft)
        ) {
          setSelectedRedactionId(null);
          setRedactMode(false);
          toast.success(t("editorLayout.burnedRedactionsDone"));
        } else if (data.status === "failed") {
          toast.error(data.error ?? t("editorLayout.burnFailed"));
        } else {
          toast.message(t("editorLayout.burnProgressUnreadable"));
        }
      } catch {
        givingUp();
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 700);
    return () => {
      clearInterval(timer);
    };
  }, [burning, recordingId, t]);

  const writeOverlays = useCallback(
    async (overlays: unknown[], record: boolean) => {
      if (record) pushHistory(snapshotOf(savedEdits));
      setPendingOverlays(overlays);
      try {
        await setOverlays.mutateAsync({
          recordingId,
          overlays: overlays as Record<string, unknown>[],
        });
        await playerDataQuery.refetch();
        return true;
      } catch (err: any) {
        if (record) dropNewestHistory();
        toast.error(err?.message ?? t("editorLayout.editFailed"));
        return false;
      } finally {
        setPendingOverlays(null);
      }
    },
    [
      dropNewestHistory,
      playerDataQuery,
      pushHistory,
      recordingId,
      savedEdits,
      setOverlays,
      t,
    ],
  );

  const commitRedactions = useCallback(
    async (next: VideoRedaction[], options?: { record?: boolean }) => {
      return await writeOverlays(
        [
          ...next.map((r) => clampRedactionToDuration(r, durationMs)),
          ...otherOverlays(savedEdits.overlays),
        ],
        options?.record ?? true,
      );
    },
    [durationMs, savedEdits, writeOverlays],
  );

  const addRedaction = useCallback(
    (rect: RedactionRect) => {
      const at = Math.round(playheadMs);
      const range = selectedClip ?? { startMs: at, endMs: at + 5_000 };
      const startMs = Math.round(range.startMs);
      const redaction: VideoRedaction = clampRedactionToDuration(
        {
          id: newRedactionId(),
          kind: "redact",
          style: redactionStyle,
          startMs,
          endMs: Math.max(startMs + 200, Math.round(range.endMs)),
          keys: [{ atMs: startMs, ...rect }],
        },
        durationMs,
      );
      setSelectedRedactionId(redaction.id);
      void commitRedactions([...savedRedactions, redaction]);
    },
    [
      commitRedactions,
      durationMs,
      playheadMs,
      redactionStyle,
      savedRedactions,
      selectedClip,
    ],
  );

  const reshapeRedaction = useCallback(
    (id: string, rect: RedactionRect) => {
      const target = savedRedactions.find((r) => r.id === id);
      if (!target) return;
      const at = Math.min(
        Math.max(Math.round(playheadMs), target.startMs),
        Math.max(target.startMs, target.endMs - 1),
      );
      void commitRedactions(
        savedRedactions.map((r) =>
          r.id === id ? setRedactionKey(r, at, rect) : r,
        ),
      );
    },
    [commitRedactions, playheadMs, savedRedactions],
  );

  const setStyle = useCallback(
    (style: RedactionStyle) => {
      setRedactionStyle(style);
      if (!selectedRedactionId) return;
      void commitRedactions(
        savedRedactions.map((r) =>
          r.id === selectedRedactionId ? { ...r, style } : r,
        ),
      );
    },
    [commitRedactions, savedRedactions, selectedRedactionId],
  );

  const removeRedaction = useCallback(
    (id: string) => {
      setSelectedRedactionId(null);
      void commitRedactions(savedRedactions.filter((r) => r.id !== id));
    },
    [commitRedactions, savedRedactions],
  );

  const pictureSize = useMemo(
    () =>
      videoSize.width > 0 && videoSize.height > 0
        ? videoSize
        : { width: recording?.width ?? 0, height: recording?.height ?? 0 },
    [recording?.height, recording?.width, videoSize],
  );

  const burnIn = useCallback(async () => {
    if (burning || burnStorageCheckInFlightRef.current) return;
    burnStorageCheckInFlightRef.current = true;
    let storageConfigured = false;
    try {
      const storageCheck = await videoStorageStatus.refetch();
      storageConfigured =
        !storageCheck.isError && storageCheck.data?.configured === true;
    } catch {
      setStorageSetupOpen(true);
      return;
    } finally {
      burnStorageCheckInFlightRef.current = false;
    }
    if (!storageConfigured) {
      setStorageSetupOpen(true);
      return;
    }
    setBurning(true);
    burnToastRef.current = toast.loading(t("editorLayout.burningRedactions"));
    try {
      const result: any = await burnRedactions.mutateAsync({ recordingId });
      if (result && result.started === false) {
        setBurning(false);
        toast.error(result.reason ?? t("editorLayout.burnFailed"), {
          id: burnToastRef.current ?? undefined,
        });
        burnToastRef.current = null;
      }
    } catch (err: any) {
      setBurning(false);
      toast.error(err?.message ?? t("editorLayout.burnFailed"), {
        id: burnToastRef.current ?? undefined,
      });
      burnToastRef.current = null;
    }
  }, [burnRedactions, burning, recordingId, t, videoStorageStatus.refetch]);

  useEffect(() => {
    if (!burning || !burnToastRef.current) return;
    toast.loading(
      burnPercent > 0
        ? t("editorLayout.burningRedactionsPercent", { percent: burnPercent })
        : t("editorLayout.burningRedactions"),
      { id: burnToastRef.current },
    );
  }, [burnPercent, burning, t]);

  const stepHistory = useCallback(
    async (direction: "undo" | "redo") => {
      const from =
        direction === "undo" ? undoStackRef.current : redoStackRef.current;
      if (!from.length) {
        toast.info(
          direction === "undo"
            ? t("editorToolbar.nothingToUndo")
            : t("editorLayout.nothingToRedo"),
        );
        return;
      }
      const target = from[from.length - 1];
      const rest = from.slice(0, -1);
      const current = snapshotOf(savedEdits);

      let saved = true;
      if (!sameList(target.trims, current.trims)) {
        saved = await commitEdits(
          { ...savedEdits, trims: target.trims },
          { record: false },
        );
      }
      if (saved && !sameList(target.overlays, current.overlays)) {
        saved = await writeOverlays(target.overlays, false);
      }
      if (!saved) return;

      if (direction === "undo") {
        undoStackRef.current = rest;
        redoStackRef.current = [...redoStackRef.current, current];
      } else {
        redoStackRef.current = rest;
        undoStackRef.current = [...undoStackRef.current, current];
      }
      setHistory({
        undo: undoStackRef.current.length,
        redo: redoStackRef.current.length,
      });
    },
    [commitEdits, savedEdits, t, writeOverlays],
  );

  const callTrim = useCallback(
    async (range: { startMs: number; endMs: number }) => {
      setSelection(null);
      return await commitEdits(
        addCut(savedEdits, Math.round(range.startMs), Math.round(range.endMs)),
      );
    },
    [commitEdits, savedEdits],
  );

  const splitAtPlayhead = useCallback(async () => {
    const at = Math.round(playheadMs);
    if (at > 0) setSelection({ kind: "clip", anchorMs: at - 1 });
    return await commitEdits(addSplitAt(savedEdits, at));
  }, [commitEdits, playheadMs, savedEdits]);

  const deleteSelection = useCallback(async () => {
    if (selection?.kind === "split") {
      setSelection(null);
      await commitEdits(removeSplit(savedEdits, selection.splitId));
      return;
    }
    if (selection?.kind === "gap") {
      setSelection(null);
      await commitEdits(removeCut(savedEdits, selection.cutId));
      return;
    }
    if (!selectedClip) return;
    setSelection(null);
    await commitEdits(
      addCut(savedEdits, selectedClip.startMs, selectedClip.endMs),
    );
  }, [commitEdits, savedEdits, selectedClip, selection]);

  const seek = useCallback(
    (ms: number) => {
      const visibleMs = skipExcludedRange(ms, excludedRanges, durationMs);
      const v = videoRef.current;
      if (v) v.currentTime = visibleMs / 1000;
      setPlayheadMs(visibleMs);
    },
    [durationMs, excludedRanges],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      const editable =
        tag === "input" || tag === "textarea" || target?.isContentEditable;
      if (editable) return;

      const modified = e.metaKey || e.ctrlKey;

      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (modified && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void stepHistory(e.shiftKey ? "redo" : "undo");
      } else if (e.key === "Escape") {
        setSelection(null);
        setSelectedRedactionId(null);
        setRedactMode(false);
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !modified &&
        !e.altKey
      ) {
        if (selectedRedactionId) {
          e.preventDefault();
          removeRedaction(selectedRedactionId);
          return;
        }
        if (!selection) return;
        e.preventDefault();
        void deleteSelection();
      } else if (!modified && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void splitAtPlayhead();
      } else if (!modified && !e.altKey && e.key.toLowerCase() === "b") {
        if (playheadMs < 500) return;
        e.preventDefault();
        void callTrim({ startMs: 0, endMs: Math.round(playheadMs) });
      } else if (!modified && !e.altKey && e.key.toLowerCase() === "a") {
        if (durationMs - playheadMs < 500) return;
        e.preventDefault();
        void callTrim({
          startMs: Math.round(playheadMs),
          endMs: Math.round(durationMs),
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    callTrim,
    deleteSelection,
    durationMs,
    playheadMs,
    removeRedaction,
    selectedRedactionId,
    selection,
    splitAtPlayhead,
    stepHistory,
  ]);

  if (playerDataQuery.isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t("editorLayout.loadingRecording")}
      </div>
    );
  }
  if (!recording) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t("editorLayout.recordingNotFound")}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background",
        className,
      )}
    >
      {/* Preview + transcript + chapters sidebar */}
      <div
        className={cn(
          "grid flex-1 min-h-0 min-w-0 overflow-hidden",
          chaptersOpen
            ? "grid-cols-[minmax(0,1fr)_300px]"
            : "grid-cols-[minmax(0,1fr)]",
        )}
      >
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {/* Row 1: video */}
          <div className="flex min-h-0 min-w-0 flex-1 basis-[220px] items-center justify-center overflow-hidden bg-black p-4">
            {videoUrl ? (
              <div className="relative h-full w-full">
                <video
                  ref={videoRef}
                  src={editorVideoUrl ?? undefined}
                  className="h-full w-full rounded object-contain shadow"
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onLoadedMetadata={(e) => {
                    const el = e.currentTarget;
                    if (el.videoWidth && el.videoHeight) {
                      setVideoSize({
                        width: el.videoWidth,
                        height: el.videoHeight,
                      });
                    }
                  }}
                  controls={false}
                />
                <RedactionOverlay
                  redactions={redactions}
                  playheadMs={playheadMs}
                  selectedId={selectedRedactionId}
                  onSelect={setSelectedRedactionId}
                  onDraw={addRedaction}
                  onReshape={reshapeRedaction}
                  drawing={redactMode}
                  newStyle={redactionStyle}
                  videoWidth={pictureSize.width}
                  videoHeight={pictureSize.height}
                />
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                {t("editorLayout.noVideoYet")}
              </div>
            )}
          </div>

          <EditorToolbar
            recordingId={recordingId}
            playheadMs={playheadMs}
            durationMs={durationMs}
            playing={playing}
            onPlayPause={() => setPlaying((p) => !p)}
            playbackSpeed={playbackSpeed}
            onPlaybackSpeedChange={handlePlaybackSpeedChange}
            zoom={zoom}
            onZoomChange={handleZoomChange}
            timelineActive={activeSurface === "timeline"}
            edits={savedEdits}
            selectionRange={selectedClip}
            onCutRange={callTrim}
            onSplit={splitAtPlayhead}
            redactMode={redactMode}
            onToggleRedact={() => {
              setRedactMode((on) => {
                if (on && playbackSpeed < SLOW_SPEED_CEILING) {
                  handlePlaybackSpeedChange(1);
                }
                return !on;
              });
              setSelectedRedactionId(null);
            }}
            pendingRedactions={savedRedactions.length}
            onBurnRedactions={burnIn}
            burningRedactions={burning}
            burnPercent={burnPercent}
            onUndo={() => stepHistory("undo")}
            onRedo={() => stepHistory("redo")}
            canUndo={history.undo > 0}
            canRedo={history.redo > 0}
            video={{ videoUrl, videoFormat, title: recording.title }}
            onOpenThumbnailPicker={() => setThumbOpen(true)}
            onOpenChapters={() => setChaptersOpen((v) => !v)}
            onOpenStitch={() => setStitchOpen(true)}
            onOpenRewind={() => setRewindOpen(true)}
            rewindAlreadyAdded={Boolean(savedEdits.rewindOriginalStartMs)}
            rewindAvailable={canOfferRewindHistory(playerData?.role)}
            rewindRequiresPrivate={recording?.visibility !== "private"}
            chaptersOpen={chaptersOpen}
          />

          <div className="shrink-0 border-t border-border bg-card/30">
            <div className="flex h-9 items-center gap-2 px-2">
              {/*
                While redacting, this row belongs to the redaction: the
                transcript is not something anyone edits with a box half drawn,
                and the tabs were a line of height spent on a choice nobody
                makes here. The controls that were under the timeline move up
                into the space instead.
              */}
              {redactMode ? (
                <>
                  <RedactionStyleToggle
                    value={selectedRedaction?.style ?? redactionStyle}
                    onChange={setStyle}
                    t={t}
                  />
                  <HelpPopover
                    label={t("redaction.helpTitle")}
                    lead={t("redaction.helpLead")}
                    rows={[
                      {
                        term: t("redaction.helpDrawTerm"),
                        text: t("redaction.helpDraw"),
                      },
                      {
                        term: t("redaction.helpMoveTerm"),
                        text: t("redaction.helpMove"),
                      },
                      {
                        term: t("redaction.helpFollowTerm"),
                        text: t("redaction.helpFollow"),
                      },
                      {
                        term: t("redaction.helpTimingTerm"),
                        text: t("redaction.helpTiming"),
                      },
                      {
                        term: t("redaction.helpWaypointTerm"),
                        text: t("redaction.helpWaypoint"),
                      },
                      {
                        term: t("redaction.helpRemoveTerm"),
                        text: t("redaction.helpRemove"),
                      },
                      {
                        term: t("redaction.helpStylesTerm"),
                        text: t("redaction.styleBlurHint"),
                      },
                      { text: t("redaction.styleSolidHint") },
                      { text: t("redaction.helpWhenInDoubt") },
                    ]}
                  />
                </>
              ) : (
                <>
                  <Tabs
                    value={editingSurface}
                    onValueChange={(value) =>
                      setEditingSurface(value as typeof editingSurface)
                    }
                  >
                    <TabsList className="h-7 p-0.5">
                      <TabsTrigger
                        value="timeline"
                        className="h-6 px-3 text-xs"
                      >
                        {t("editorLayout.timeline")}
                      </TabsTrigger>
                      <TabsTrigger
                        value="transcript"
                        className="h-6 px-3 text-xs"
                      >
                        {t("recordingPage.transcript")}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  {activeSurface === "timeline" ? (
                    <HelpPopover
                      label={t("timelineTrack.helpTitle")}
                      rows={[
                        {
                          term: t("timelineTrack.helpSplitTerm"),
                          text: t("timelineTrack.helpSplit"),
                        },
                        {
                          term: t("timelineTrack.helpShortenTerm"),
                          text: t("timelineTrack.helpShorten"),
                        },
                        {
                          term: t("timelineTrack.helpOtherSideTerm"),
                          text: t("timelineTrack.helpOtherSide"),
                        },
                        {
                          term: t("timelineTrack.helpRemoveTerm"),
                          text: t("timelineTrack.helpRemove"),
                        },
                        {
                          term: t("timelineTrack.helpRestoreTerm"),
                          text: t("timelineTrack.helpRestore"),
                        },
                      ]}
                    />
                  ) : null}
                </>
              )}
              {savedRedactions.length > 0 ? (
                <span className="ms-auto truncate text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  {t("redaction.notYetBurned", {
                    count: savedRedactions.length,
                  })}
                </span>
              ) : null}
            </div>

            {activeSurface === "transcript" ? (
              <div className="h-40 border-t border-border">
                <TranscriptEditor
                  segments={transcriptSegments}
                  edits={savedEdits}
                  currentMs={playheadMs}
                  onSeek={seek}
                  onTrimRange={callTrim}
                />
              </div>
            ) : (
              <div
                ref={containerRef}
                className="min-w-0 space-y-1 overflow-hidden border-t border-border p-2"
              >
                <div
                  className="relative min-w-0 overflow-hidden"
                  onWheel={handleTimelineWheel}
                >
                  <Waveform
                    peaks={peaks}
                    sprite={filmstripSprite}
                    frames={filmstripFrames}
                    width={viewportWidth}
                    height={WAVEFORM_HEIGHT}
                    zoom={zoom}
                    playheadMs={playheadMs}
                    durationMs={durationMs}
                    excludedRanges={shownExcludedRanges}
                    activityRanges={transcriptSegments}
                    onSeek={seek}
                    scrollLeft={clampedScrollLeft}
                    onScroll={(s) => setScrollLeft(s)}
                  />
                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={{ height: WAVEFORM_HEIGHT }}
                  >
                    <div
                      className="relative h-full"
                      style={{
                        width: totalWidth,
                        transform: `translateX(${-clampedScrollLeft}px)`,
                      }}
                    >
                      {durationMs > 0 && (
                        <TimelineTrack
                          width={totalWidth}
                          height={WAVEFORM_HEIGHT}
                          durationMs={durationMs}
                          edits={shownEdits}
                          selection={selection}
                          onSelectionChange={setSelection}
                          onPreview={setPreviewEdits}
                          onCommit={(next) => void commitEdits(next)}
                          onSeek={seek}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {redactions.length > 0 ? (
                  <div
                    className="min-w-0 overflow-hidden"
                    style={{ width: viewportWidth }}
                  >
                    <div
                      style={{
                        transform: `translateX(${-clampedScrollLeft}px)`,
                        width: totalWidth,
                      }}
                    >
                      <RedactionLane
                        width={totalWidth}
                        durationMs={durationMs}
                        redactions={redactions}
                        selectedId={selectedRedactionId}
                        onSelect={setSelectedRedactionId}
                        onPreview={setPreviewRedactions}
                        onCommit={(next) => void commitRedactions(next)}
                        onSeek={seek}
                      />
                    </div>
                  </div>
                ) : null}

                <div
                  className="min-w-0 overflow-hidden rounded-sm border border-border/70"
                  style={{ width: viewportWidth }}
                >
                  <div
                    style={{
                      transform: `translateX(${-clampedScrollLeft}px)`,
                      width: totalWidth,
                    }}
                  >
                    <Timeline
                      width={totalWidth}
                      durationMs={durationMs}
                      playheadMs={playheadMs}
                      chapters={chapters}
                      splitPoints={splitPoints}
                      originalStartMs={edits.rewindOriginalStartMs}
                      onSeek={seek}
                      onClickChapter={(c) => seek(c.startMs)}
                    />
                  </div>
                </div>
                {savedRedactions.length > 0 || redactMode ? (
                  <>
                    {/*
                      Every redaction, always reachable. The bar on the lane can
                      be scrolled out of view or squeezed to a few pixels at low
                      zoom, and the box on the picture only appears while the
                      playhead is inside its range — so neither is somewhere a
                      redaction can be relied on to be deleted from.
                    */}
                    <div className="flex flex-wrap items-center gap-1 px-1 pt-1">
                      {savedRedactions.map((redaction, index) => {
                        const selected = redaction.id === selectedRedactionId;
                        return (
                          <span
                            key={redaction.id}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                              selected
                                ? "border-amber-400 bg-amber-400/15 text-foreground"
                                : "border-border text-muted-foreground",
                            )}
                          >
                            <button
                              type="button"
                              className="font-medium"
                              onClick={() => {
                                setSelectedRedactionId(redaction.id);
                                seek(redaction.startMs);
                              }}
                              title={t("redaction.goTo")}
                            >
                              {t("redaction.chip", {
                                number: index + 1,
                                start: formatMs(redaction.startMs),
                                end: formatMs(redaction.endMs),
                              })}
                            </button>
                            <button
                              type="button"
                              className="rounded-full px-1 leading-none text-muted-foreground hover:text-destructive"
                              aria-label={t("redaction.remove", {
                                number: index + 1,
                              })}
                              title={t("redaction.remove", {
                                number: index + 1,
                              })}
                              onClick={() => removeRedaction(redaction.id)}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar: chapters */}
        {chaptersOpen ? (
          <div className="flex min-h-0 min-w-0 flex-col border-l border-border">
            <ChaptersEditor
              recordingId={recordingId}
              chapters={chapters}
              currentMs={playheadMs}
              onSeek={seek}
              className="flex-1"
            />
          </div>
        ) : null}
      </div>

      <ThumbnailPicker
        open={thumbOpen}
        onOpenChange={setThumbOpen}
        recordingId={recordingId}
        videoUrl={videoUrl}
        videoFormat={videoFormat}
        durationMs={durationMs}
        currentThumbnailUrl={recording.thumbnailUrl}
        currentAnimatedUrl={recording.animatedThumbnailUrl}
        currentThumbnail={edits.thumbnail}
      />
      <StitchManager
        open={stitchOpen}
        onOpenChange={setStitchOpen}
        seedRecordingId={recordingId}
      />
      {canOfferRewindHistory(playerData?.role) ? (
        <RewindExtensionDialog
          open={rewindOpen}
          onOpenChange={setRewindOpen}
          recordingId={recordingId}
          durationMs={durationMs}
          width={recording.width}
          height={recording.height}
          videoFormat={videoFormat}
          hasAudio={Boolean(recording.hasAudio)}
          visibility={recording.visibility}
          onVisibilityChanged={async () => {
            await playerDataQuery.refetch();
          }}
          onApplied={async () => {
            await playerDataQuery.refetch();
          }}
        />
      ) : null}
      <Dialog open={storageSetupOpen} onOpenChange={setStorageSetupOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="sr-only">
              {t("storageSetup.configureS3")}
            </DialogTitle>
          </DialogHeader>
          {videoStorageStatus.isError ? (
            <StorageStatusRetry
              onRetry={() => void videoStorageStatus.refetch()}
            />
          ) : (
            <FileStorageSetupCard />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
