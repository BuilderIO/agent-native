import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { FileStorageSetupDialog } from "@agent-native/core/client/setup-connections";
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

// Client-side app-state helpers — the `@agent-native/core/application-state`
// module is server-only (requires DB access). In the browser we hit the
// framework's auto-mounted route, which handles per-session scoping.
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

/** One step of undo: both editable lists as they stood. */
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

/**
 * How many unreadable progress polls to sit through before saying so.
 *
 * At 700ms a poll this is a few seconds — long enough to ride out a dropped
 * request or a redeploy mid-burn, short enough that a bar which can never be
 * filled in does not turn forever.
 */
const MAX_UNREADABLE_BURN_POLLS = 12;

/**
 * How long an "I know nothing about that burn" answer is treated as too early
 * to mean anything.
 *
 * The first poll goes out the moment Burn is pressed, not when the request
 * lands, so it can easily beat the action to the server — and the progress a
 * burn reports lives in the memory of the process running it, so a process
 * that has not started one answers "idle". Taken at face value that reads as
 * "finished or never happened", and with the boxes still on the row the editor
 * would call a burn that is running and about to succeed a failure. Until the
 * job has been seen running, an idle answer inside this window means only that
 * the question was asked too soon.
 */
const BURN_REGISTRATION_GRACE_MS = 15_000;

/**
 * Help behind an icon, rather than a paragraph under the timeline.
 *
 * The editing panel's instructions ran to several lines of small grey text,
 * permanently, directly below the thing they described — on a laptop that is a
 * meaningful slice of the height that should be showing the picture. They are
 * worth keeping (a redaction that follows a scroll is not guessable), so they
 * moved in here, where they cost a 20px button until someone wants them.
 *
 * Written as a lead plus labelled lines rather than prose. The first version
 * was three dense paragraphs and Pete could not read what to do out of them:
 * one sentence saying what matters, then one line per thing you might want to
 * do, is what a person scans.
 */
function HelpPopover({
  label,
  lead,
  rows,
}: {
  label: string;
  /** The one sentence to read if nothing else is read. */
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

/**
 * Mosaic or solid fill, for the selected box or for the next one drawn.
 *
 * Lifted out of the row of redaction chips under the timeline and up beside
 * the tabs, where it is the first thing to hand when the Redact tool is armed
 * rather than something to find among the boxes already placed.
 */
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

/**
 * The filmstrip's height, and with it most of the editing panel's.
 *
 * Halved on 2026-09-21: on a laptop the panel left the picture itself tiny,
 * and the picture is the thing being edited. The filmstrip frames are cut to
 * this height (`WAVEFORM_HEIGHT * 16/9` wide), so they are smaller too —
 * which is the trade, and the right way round for a screen recording, where
 * the frames are mostly there to show you roughly where you are.
 */
const WAVEFORM_HEIGHT = 50;
/** How many steps of undo the editor keeps for a session. */
const HISTORY_LIMIT = 50;
const MIN_TIMELINE_ZOOM = 1;
const MAX_TIMELINE_ZOOM = 50;

/** An element's content width, with its padding taken off. */
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
    // Internal URLs already carry a short-lived `?t=<token>` for non-owner
    // viewers of password-protected recordings (minted in
    // `get-recording-player-data`). Pass through as-is.
    return videoUrl.startsWith("/") ? `${appBasePath()}${videoUrl}` : videoUrl;
  }

  // Cross-origin provider URLs (R2 / S3 / Builder) get proxied through the
  // same-origin `/api/video/:id` route for CORS reasons. We intentionally do
  // NOT forward the password here — the plaintext password was previously
  // appended via `?password=…`, but it isn't sent to this component anymore
  // (the action returns `hasPassword: boolean` instead of the plaintext).
  // For owners the proxy bypasses the password gate; for non-owner editors
  // of password-protected recordings with cross-origin storage the waveform
  // will be empty — they can still see / scrub the video, just not the
  // waveform visualization.
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
  // --- server state -------------------------------------------------------
  const playerDataQuery = useActionQuery("get-recording-player-data", {
    recordingId,
  });

  const playerData: any = playerDataQuery.data;
  const recording: any = playerData?.recording;
  const durationMs = recording?.durationMs ?? 0;
  const videoUrl: string | null = recording?.videoUrl ?? null;
  const videoFormat: "webm" | "mp4" = recording?.videoFormat ?? "webm";
  /**
   * The file can be replaced while its URL stays the same — a redaction burn
   * uploads under a stable name. Without the version the editor would keep
   * playing the copy the browser already had, which after a burn is the
   * unredacted one, under a recording that says it is redacted.
   */
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

  // --- edit state ---------------------------------------------------------
  // Declared ahead of the derived edits below, which read them.
  const [selection, setSelection] = useState<TrackSelection | null>(null);
  /** Edits mid-drag — shown, but not yet saved. */
  const [previewEdits, setPreviewEdits] = useState<EditsJson | null>(null);
  /** Edits saved optimistically, held until the recording query catches up. */
  const [pendingTrims, setPendingTrims] = useState<TrimRange[] | null>(null);
  /** Redaction boxes placed but not yet burned, mid-edit and optimistic. */
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
  /** What the next box will be. Changing it also changes the selected box. */
  const [redactionStyle, setRedactionStyle] = useState<RedactionStyle>(
    DEFAULT_REDACTION_STYLE,
  );
  /**
   * The picture's own dimensions. The row usually has them, but a recording
   * made before they were stored reports 0 — a redaction laid out against the
   * wrong aspect ratio would burn in the wrong place, so the player's own
   * reading wins as soon as it has one.
   */
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [burning, setBurning] = useState(false);
  const burnStorageCheckInFlightRef = useRef(false);
  const burnToastRef = useRef<string | number | null>(null);
  /**
   * Undo covers the redaction boxes as well as the cuts. They are two lists in
   * one document and a person does not keep two histories in their head — and
   * a redaction deleted by a mis-click is exactly the thing you reach for
   * Cmd+Z after. What it cannot undo is a burn: those pixels are gone.
   */
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

  /**
   * Three views of the same document, and the distinction matters while a
   * drag is in flight: `savedEdits` is what the server has (or is about to
   * have) and drives playback, while `shownEdits` includes the drag preview
   * and drives what is drawn. Seeking off a half-made cut would fight the
   * drag, so the two are kept apart.
   */
  const savedEdits: EditsJson = useMemo(() => {
    const next = pendingTrims ? { ...edits, trims: pendingTrims } : edits;
    return pendingOverlays ? { ...next, overlays: pendingOverlays } : next;
  }, [edits, pendingOverlays, pendingTrims]);
  const shownEdits: EditsJson = previewEdits ?? savedEdits;

  /**
   * The redaction boxes. These hide nothing on their own — the stored file
   * still has every pixel until `burn-recording-redactions` runs — so the
   * editor labels them as pending rather than letting a black box imply the
   * work is done.
   */
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
  // Only the markers that still divide footage — see `visibleSplitPoints`.
  // The ruler used to draw every one, which left the line from the original
  // cut sitting inside the stretch that cut had since removed.
  const splitPoints = useMemo(
    () => visibleSplitPoints(shownEdits, durationMs),
    [durationMs, shownEdits],
  );
  const pieces = useMemo(
    () => buildTimelinePieces(durationMs, shownEdits),
    [durationMs, shownEdits],
  );
  /** The highlighted clip, as a plain range — what the toolbar's Cut acts on. */
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

  // --- player state -------------------------------------------------------
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(() =>
    readPlaybackSpeedPreference(1.2),
  );
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(800);
  const [scrollLeft, setScrollLeft] = useState(0);
  // The timeline is what the editor is for; the transcript is the other way in.
  const [editingSurface, setEditingSurface] = useState<
    "transcript" | "timeline"
  >("timeline");
  /**
   * What the panel is actually showing.
   *
   * Redacting is a timeline job — boxes are placed against the picture and
   * their bars live on the lane — so the tabs are not offered while the tool
   * is armed. Derived rather than forced into state, so arming Redact from the
   * transcript and disarming it again puts the transcript back.
   */
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

  // Measure viewport so waveform + timeline stay responsive.
  //
  // The content box, not `clientWidth`: the container is padded, and
  // `clientWidth` counts that padding. The track was being drawn 16px wider
  // than the space it had, so the last sixteen pixels of every timeline —
  // the end of the clip, and the grab handle of anything ending there — sat
  // outside the visible box, clipped.
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

  /**
   * Pan a zoomed timeline with the wheel or a trackpad swipe.
   *
   * The waveform is what actually scrolls, but the timeline track is a
   * separate layer sitting on top of it — a sibling, not an ancestor — so a
   * wheel over the track scrolls nothing, and the layer also covers the
   * scrollbar that would otherwise be there to drag. With the drag gesture
   * already taken by scrubbing, that left no way at all to reach the rest of a
   * zoomed timeline. Handled here, where the scroll position already lives, so
   * it works over every layer.
   */
  const handleTimelineWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const maxScroll = Math.max(0, totalWidth - viewportWidth);
      if (maxScroll <= 0) return;
      // A trackpad swipe reports deltaX; a wheel with shift reports deltaY,
      // which is how a mouse asks for the same thing.
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

  // Sync the <video> to play state.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  }, [playing]);

  // Load the clip's default speed (or the user's saved override) when a new
  // recording enters the editor.
  useEffect(() => {
    if (!recording?.id) return;
    const next = readPlaybackSpeedPreference(defaultPreviewSpeed);
    setPlaybackSpeed(next);
    if (videoRef.current) {
      videoRef.current.defaultPlaybackRate = next;
      videoRef.current.playbackRate = next;
    }
  }, [defaultPreviewSpeed, recording?.id]);

  // Keep the editor preview speed visible and in sync with the media element.
  // `defaultPlaybackRate` is set too so a `videoUrl` source swap that resets
  // `playbackRate` (some browsers do this on load) falls back to the chosen
  // speed instead of 1x.
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

  // Keep the playheadMs in sync with the element's currentTime.
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

  // Expose the in-editor state so the agent can read "the user is editing and scrubbed to X".
  useEffect(() => {
    void writeAppStateClient("editor-draft", {
      recordingId,
      playheadMs: Math.round(playheadMs),
      playbackSpeed,
      zoom,
      editsJson: savedEdits,
    });
  }, [recordingId, playheadMs, playbackSpeed, zoom, savedEdits]);

  // --- waveform peaks, cached in application_state ------------------------
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
      // 1) Try cached peaks.
      const cached = await readAppStateClient<WaveformPeaks>(
        `waveform-${recordingId}`,
      );
      if (cached?.peaks && cached.bucketCount) {
        if (!cancelled) setPeaks(cached);
        return;
      }
      // 2) Compute from the video URL. Cross-origin provider URLs go through
      // the same-origin /api/video proxy so CDN CORS cannot blank the waveform.
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

  // Filmstrip drawn behind the waveform. A server-generated sprite is one
  // cached image request and is preferred; browser extraction is the fallback
  // for hosts without ffmpeg and for local/dev media the server can't fetch.
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

  // Cells should read as video frames, so aim for one per `height * aspect` of
  // track. Bucketed so ordinary window resizing does not re-extract, and based
  // on the unzoomed width — a zoomed fallback strip stretches, which is one of
  // the reasons the server sprite is the preferred path.
  const filmstripFrameCount = useMemo(() => {
    const bucketedWidth = Math.max(240, Math.round(viewportWidth / 120) * 120);
    const cellWidth = WAVEFORM_HEIGHT * (16 / 9);
    return Math.min(48, Math.max(6, Math.round(bucketedWidth / cellWidth)));
  }, [viewportWidth]);

  useEffect(() => {
    // A sprite already covers the whole clip — don't decode the video again.
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
    // `waveformMediaUrl`, not `videoUrl`: reading frames back out of a
    // cross-origin video taints the canvas, so provider media must come
    // through the same-origin proxy first.
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

  // --- actions ------------------------------------------------------------
  // Every timeline edit is a whole-list write. Appending one merged range, as
  // `trim-recording` does, cannot express "move the edge of the cut I made
  // five minutes ago" — the entry it would have to address no longer exists.
  const setTrims = useActionMutation("set-recording-trims");

  const pushHistory = useCallback((snapshot: EditSnapshot) => {
    undoStackRef.current = [...undoStackRef.current, snapshot].slice(
      -HISTORY_LIMIT,
    );
    redoStackRef.current = [];
    setHistory({ undo: undoStackRef.current.length, redo: 0 });
  }, []);

  /** Take the entry back off after a write that did not land. */
  const dropNewestHistory = useCallback(() => {
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setHistory({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    });
  }, []);

  /**
   * Save a new set of edits. The list is shown straight away and the history
   * entry is pushed before the write, so the timeline responds at once and
   * Cmd+Z still reverses the edit while the save is in flight.
   */
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
        // Reported, not swallowed: the toolbar announces "Selection cut" on
        // the strength of this, and saying an edit landed when it did not is
        // worse than the failure itself.
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
  /**
   * How far the burn has got. A full re-encode of a long clip is minutes of
   * nothing happening on screen, and "is it stuck?" is the reasonable
   * conclusion.
   *
   * Polled from a plain route, not an action: the burn is itself a
   * long-running action, and the answer has to come back while that one is
   * still working.
   */
  const [burnPercent, setBurnPercent] = useState(0);
  /**
   * Held in a ref, not a dependency. `useActionQuery` hands back a new object
   * on every render, so depending on it tears the poll below down and rebuilds
   * it constantly — and every response in flight at that moment was being
   * thrown away as cancelled, which is why the percentage never moved.
   */
  const refetchPlayerDataRef = useRef(playerDataQuery.refetch);
  refetchPlayerDataRef.current = playerDataQuery.refetch;

  /**
   * A burn outlives the page that started it. Opening the editor — or
   * refreshing it — while one is running has to show that, or the Burn button
   * is there to be pressed a second time on a recording already being burned.
   */
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
        // Only asking whether a burn is already running, so there is nothing
        // to show the user — but swallowing it silently is how a route that
        // has started failing stays unnoticed.
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

    /**
     * Follow the background job to the end.
     *
     * The burn is not the action's return value — a re-encode takes longer
     * than an action is allowed to — so the action starts it and this watches
     * it, through a plain route rather than another action, because the answer
     * has to come back while the work is still going.
     */
    /**
     * A poll that cannot be read is not the same as a job that is still
     * running, and treating them alike is what made a four-second burn look
     * endless: the route answered 403 for the owner of the recording, every
     * poll was thrown away by the `!res.ok` line below, and the bar sat at
     * zero with the spinner turning until the page was reloaded. The route is
     * fixed, but the spinner must not be able to outlive the answer again —
     * after a few seconds of unreadable answers this says so and stops.
     */
    let unreadable = 0;
    /**
     * Whether this burn has ever been seen running. Until it has, "idle" is
     * not evidence of anything — see `BURN_REGISTRATION_GRACE_MS`.
     */
    let sawRunning = false;
    const startedAt = Date.now();
    const givingUp = () => {
      unreadable += 1;
      if (unreadable < MAX_UNREADABLE_BURN_POLLS) return;
      // Deliberately not an error: the burn is almost certainly still going,
      // or already done. What is broken is our view of it.
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
          // Asked too soon. Keep waiting rather than calling it.
          return;
        }

        setBurning(false);
        // Dismiss rather than reuse the id: a replaced toast that misses its
        // target leaves the old one spinning forever, which is exactly what a
        // finished burn looked like.
        if (burnToastRef.current !== null) toast.dismiss(burnToastRef.current);
        burnToastRef.current = null;

        const refreshed = await refetchPlayerDataRef.current();
        // "idle" means the server has no memory of the job: it finished long
        // enough ago to be swept, or a restart took it. Whether it worked is
        // a question the recording itself can answer — the boxes are taken
        // off the timeline as they are burned in.
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
          // Idle, with the boxes still on the row. Nothing here says the burn
          // failed — this process simply has no record of it, which is what a
          // restart mid-burn, or another instance answering, looks like.
          // Calling that a failure would be a guess, and the wrong one.
          toast.message(t("editorLayout.burnProgressUnreadable"));
        }
      } catch {
        // One missed poll is not worth surfacing; the next one is a second
        // away. A run of them is — see above.
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
        // Reported like the trim write, so a caller stepping through history
        // can tell whether the step actually landed.
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

  /** Save the redaction boxes, as one step of history. */
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

  /** A box drawn on the picture becomes a redaction over a stretch of time. */
  const addRedaction = useCallback(
    (rect: RedactionRect) => {
      const at = Math.round(playheadMs);
      // The highlighted section if there is one, because "redact this bit" is
      // usually the bit already selected; otherwise five seconds from here,
      // which the user then drags to fit.
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

  /**
   * Moving or resizing a box drops a waypoint at the playhead, which is what
   * makes a redaction follow something that moves. The time is pulled inside
   * the redaction's own range: a waypoint outside it would change where the
   * box sits without being visible anywhere.
   */
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
      // Comes back as soon as the job is accepted; the poll sees it out.
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

  // The toast carries the percentage, so it is visible wherever the user is
  // looking rather than only on the toolbar.
  useEffect(() => {
    if (!burning || !burnToastRef.current) return;
    // Before the first reading there is no percentage worth showing — a bar
    // stuck on 0% reads as broken, where "rendering…" reads as working.
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

      // The writes come first, and the stacks only move if they land. These
      // counts are what the toolbar's undo and redo buttons are drawn from,
      // so moving them on a write that failed leaves the editor offering a
      // history position the recording is not actually at.
      //
      // Only what actually differs is written: a step that only moved a
      // redaction should not rewrite the trim list, and vice versa.
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
      // The error is already on screen. The step stays where it was, so the
      // same key press tries again — and the half that did land is skipped
      // the second time round, because it no longer differs.
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

  /** Cut a range out — used by the transcript editor and the toolbar. */
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
    // Select the section on the left of the new line, which is the one whose
    // end the line drags by default. Seeing it highlighted is what tells the
    // user which way the cut is about to go.
    if (at > 0) setSelection({ kind: "clip", anchorMs: at - 1 });
    return await commitEdits(addSplitAt(savedEdits, at));
  }, [commitEdits, playheadMs, savedEdits]);

  /**
   * Delete removes the highlighted section; on a gap it puts it back, and on a
   * red line it takes the line away — a cut made by mistake is undone by
   * clicking the line and pressing Delete, without touching the footage.
   */
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

  // --- keyboard shortcuts -------------------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when focus is inside an editable element.
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
        // A selected redaction goes first: it is the thing the user is
        // looking at. Otherwise this is the timeline's Delete, and when
        // nothing is highlighted the transcript editor keeps the key.
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
        // Cut everything before the playhead: the intro nobody wants.
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
                // Leaving the tool takes a crawling speed with it, rather than
                // leaving the whole editor playing at a sixteenth.
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
                // Stays on the row rather than going into the help: it is not
                // an explanation, it is the fact that nothing is hidden yet.
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
      <FileStorageSetupDialog
        open={storageSetupOpen}
        onOpenChange={setStorageSetupOpen}
        onConnected={() => void videoStorageStatus.refetch()}
      />
    </div>
  );
}
