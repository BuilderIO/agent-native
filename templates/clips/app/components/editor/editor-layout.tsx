import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconBracketsContain,
  IconCut,
  IconTrash,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

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

import { useRecordingAnnotations } from "@/components/player/use-recording-annotations";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { annotationColorClass } from "@/lib/annotation-kinds";
import {
  parsePlaybackSpeed,
  readPlaybackSpeedPreference,
  savePlaybackSpeedPreference,
} from "@/lib/playback-speed";
import { canOfferRewindHistory } from "@/lib/rewind-visibility";
import {
  parseEdits,
  getExcludedRanges,
  formatMs,
  skipExcludedRange,
  type EditsJson,
} from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";
import {
  extractFilmstripThumbnails,
  type FilmstripFrame,
  type FilmstripSprite,
} from "@/lib/video-filmstrip";
import { computePeaks, type WaveformPeaks } from "@/lib/waveform-peaks";

import { ChaptersEditor } from "./chapters-editor";
import { CoordinateMenu } from "./coordinate-menu";
import { defaultSelectionRange } from "./editor-selection";
import { EditorToolbar } from "./editor-toolbar";
import { setFrameCaptureSuspended } from "./frame-store";
import { RewindExtensionDialog } from "./rewind-extension-dialog";
import { StitchManager } from "./stitch-manager";
import { ThumbnailPicker } from "./thumbnail-picker";
import { Timeline } from "./timeline";
import { buildTimelineActions } from "./timeline-actions";
import { TranscriptEditor } from "./transcript-editor";
import { TrimHandles } from "./trim-handles";
import { useFilmstrip } from "./use-filmstrip";
import { Waveform } from "./waveform";

export interface EditorLayoutProps {
  recordingId: string;
  className?: string;
}

// Track strip anatomy (mirrors the full editor's item look): filmstrip of
// frames on top, waveform underneath, ruler ABOVE the strip.
const FILMSTRIP_HEIGHT = 54;
const WAVEFORM_HEIGHT = 46;
const TRACK_STRIP_HEIGHT = FILMSTRIP_HEIGHT + WAVEFORM_HEIGHT;

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
  // --- server state -------------------------------------------------------
  const { threaded: editorAnnotations, refetch: refetchAnnotations } =
    useRecordingAnnotations(recordingId);
  const addAnnotationMutation = useActionMutation("add-annotation" as any);
  const updateAnnotationMutation = useActionMutation(
    "update-annotation" as any,
  );
  const deleteAnnotationMutation = useActionMutation(
    "delete-annotation" as any,
  );
  const trimMutation = useActionMutation("trim-recording");
  const restoreMutation = useActionMutation("restore-recording-range" as any);
  const removeSplitMutation = useActionMutation(
    "remove-recording-split" as any,
  );
  const moveSplitMutation = useActionMutation("move-recording-split" as any);
  const splitMutation = useActionMutation("split-recording");
  const addMarkerAt = (ms: number, kind: string) =>
    addAnnotationMutation.mutate(
      { recordingId, startMs: Math.round(ms), kind } as any,
      { onSettled: () => refetchAnnotations() } as any,
    );
  const [transcriptPanelWidth, setTranscriptPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 340;
    const saved = Number(
      window.localStorage.getItem("clips-editor-transcript-width"),
    );
    return Number.isFinite(saved) && saved >= 240 ? Math.min(saved, 720) : 340;
  });
  useEffect(() => {
    window.localStorage.setItem(
      "clips-editor-transcript-width",
      String(transcriptPanelWidth),
    );
  }, [transcriptPanelWidth]);
  const transcriptResizeRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const onTranscriptResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    transcriptResizeRef.current = {
      startX: e.clientX,
      startWidth: transcriptPanelWidth,
    };
    const onMove = (ev: PointerEvent) => {
      const drag = transcriptResizeRef.current;
      if (!drag) return;
      const next = drag.startWidth + (drag.startX - ev.clientX);
      setTranscriptPanelWidth(Math.min(720, Math.max(240, Math.round(next))));
    };
    const onUp = () => {
      transcriptResizeRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const timelineAnnotations = useMemo(
    () =>
      editorAnnotations
        .filter((a) => a.startMs !== null)
        .map((a) => ({
          id: a.id,
          entity: a.entity,
          startMs: a.startMs ?? 0,
          endMs: a.endMs,
          kind: a.kind,
          label: a.label,
          body: a.body,
          authorName: a.authorName ?? null,
          resolved: a.resolved,
          comments: a.comments,
        })),
    [editorAnnotations],
  );
  const playerDataQuery = useActionQuery("get-recording-player-data", {
    recordingId,
  });

  const playerData: any = playerDataQuery.data;
  const recording: any = playerData?.recording;
  const durationMs = recording?.durationMs ?? 0;
  const videoUrl: string | null = recording?.videoUrl ?? null;
  const videoFormat: "webm" | "mp4" = recording?.videoFormat ?? "webm";
  const defaultPreviewSpeed = useMemo(
    () => parsePlaybackSpeed(recording?.defaultSpeed) ?? 1.2,
    [recording?.defaultSpeed],
  );

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

  const excludedRanges = useMemo(() => getExcludedRanges(edits), [edits]);
  const segmentBoundsAt = (ms: number): { startMs: number; endMs: number } => {
    let start = 0;
    let end = durationMs;
    for (const split of splitPoints) {
      if (split <= ms && split > start) start = split;
      if (split > ms && split < end) end = split;
    }
    return { startMs: start, endMs: end };
  };
  const splitPoints = useMemo(
    () =>
      edits.trims
        .filter((t) => !t.excluded && t.startMs === t.endMs)
        .map((t) => t.startMs),
    [edits],
  );
  // Segments between split points — the track strip renders one card per
  // segment so splits read as visible gaps, not just ruler needles.
  const segmentRanges = useMemo(() => {
    const bounds = [0, ...[...splitPoints].sort((a, b) => a - b), durationMs];
    const out: Array<{ startMs: number; endMs: number }> = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      if (bounds[i + 1] > bounds[i]) {
        out.push({ startMs: bounds[i], endMs: bounds[i + 1] });
      }
    }
    return out;
  }, [splitPoints, durationMs]);

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
  // Two selection kinds, deliberately distinct (Descript's model): a
  // "segment" selection is a whole split-bounded segment (card highlight,
  // segment actions), a "range" selection is an arbitrary span (violet span
  // like Descript's purple, range actions — cut just this part). Adjusting
  // a segment's span via the trim handles converts it into a range.
  const [selectionRange, setSelectionRange] = useState<{
    type: "segment" | "range";
    startMs: number;
    endMs: number;
  } | null>(null);
  // Drag state for the track-strip segment dividers (the Descript-style
  // visible gap between segment cards) — same gesture as the ruler needle.
  const [trackSplitDrag, setTrackSplitDrag] = useState<{
    fromMs: number;
    ghostMs: number;
  } | null>(null);
  const trackSplitStartXRef = useRef(0);
  const trackSplitMovedRef = useRef(false);
  // Right-click menu on the track strip: a segment card or a split divider.
  const [stripMenu, setStripMenu] = useState<{
    x: number;
    y: number;
    target:
      | { type: "segment"; range: { startMs: number; endMs: number } }
      | { type: "range"; range: { startMs: number; endMs: number } }
      | { type: "split"; ms: number };
  } | null>(null);

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
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      setViewportWidth(Math.max(1, el.clientWidth));
    });
    ro.observe(el);
    setViewportWidth(Math.max(1, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const baseTrackWidth = useMemo(() => {
    if (durationMs <= 0 || viewportWidth <= 0) return viewportWidth;
    const durationSec = durationMs / 1000;
    // Scale timeline track width proportionally with duration so long videos scale & scroll (bounded to safe max allocation)
    const durationScaledPx = Math.min(8192, Math.round(durationSec * 14));
    return Math.max(viewportWidth, durationScaledPx);
  }, [durationMs, viewportWidth]);

  const totalWidth = useMemo(() => {
    return Math.max(
      baseTrackWidth,
      Math.floor(baseTrackWidth * Math.max(1, zoom)),
    );
  }, [baseTrackWidth, zoom]);

  const { canvasRef: filmstripCanvasRef } = useFilmstrip({
    videoUrl,
    durationMs,
    totalWidth,
    height: FILMSTRIP_HEIGHT,
    enabled: Boolean(videoUrl) && durationMs > 0,
  });

  useEffect(() => {
    setScrollLeft((current) =>
      Math.min(current, Math.max(0, totalWidth - viewportWidth)),
    );
  }, [totalWidth, viewportWidth]);

  // Zoom around a viewport x position: the moment under the cursor (or the
  // viewport center for the buttons) stays put while the scale changes.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const scrollLeftRef = useRef(scrollLeft);
  scrollLeftRef.current = scrollLeft;
  const viewportWidthRef = useRef(viewportWidth);
  viewportWidthRef.current = viewportWidth;
  const baseTrackWidthRef = useRef(baseTrackWidth);
  baseTrackWidthRef.current = baseTrackWidth;
  const zoomAround = useCallback((viewportX: number, factor: number) => {
    const vw = viewportWidthRef.current;
    const btw = baseTrackWidthRef.current;
    const oldZoom = zoomRef.current;
    const newZoom = Math.min(50, Math.max(1, oldZoom * factor));
    if (newZoom === oldZoom) return;
    const oldTotal = Math.max(btw, Math.floor(btw * oldZoom));
    const newTotal = Math.max(btw, Math.floor(btw * newZoom));
    const x = Math.min(Math.max(viewportX, 0), vw);
    const anchorFrac = (scrollLeftRef.current + x) / oldTotal;
    setZoom(Math.round(newZoom * 100) / 100);
    setScrollLeft(
      Math.min(Math.max(anchorFrac * newTotal - x, 0), newTotal - vw),
    );
  }, []);

  // Cmd/Ctrl+scroll zooms around the cursor (Descript's gesture); plain
  // horizontal wheel pans when zoomed in. Native listener because React's
  // wheel handlers can't reliably preventDefault (passive) — and this must
  // beat the browser's page-zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        zoomAround(e.clientX - rect.left - 8, Math.exp(-e.deltaY * 0.002));
        return;
      }
      const delta = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (delta !== 0 && zoomRef.current > 1) {
        e.preventDefault();
        const vw = viewportWidthRef.current;
        const btw = baseTrackWidthRef.current;
        const total = Math.max(btw, Math.floor(btw * zoomRef.current));
        setScrollLeft(
          Math.min(Math.max(scrollLeftRef.current + delta, 0), total - vw),
        );
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAround]);

  // Sync the <video> to play state — and suspend preview-frame capture
  // while playing so it never competes with playback for bandwidth/decoder.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setFrameCaptureSuspended(playing);
    if (playing) {
      v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
    return () => setFrameCaptureSuspended(false);
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

  // While playing, the preview must behave like the edited cut: `timeupdate`
  // only ticks ~4Hz, so a tighter interval (a) jumps the playhead past any
  // excluded range it enters (matching the share player's skipExcludedRange —
  // deleted words must not be spoken in the editor either) and (b) keeps the
  // transcript's active-word highlight in step. Paused seeks stay free so
  // trimmed material remains inspectable/restorable.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing) return;
    const tick = () => {
      if (v.paused || v.seeking) return;
      const ms = v.currentTime * 1000;
      const range = excludedRanges.find((r) => ms >= r.startMs && ms < r.endMs);
      if (range) {
        if (durationMs > 0 && range.endMs >= durationMs) {
          v.pause();
          v.currentTime = durationMs / 1000;
          setPlayheadMs(durationMs);
          return;
        }
        v.currentTime = range.endMs / 1000;
        setPlayheadMs(range.endMs);
        return;
      }
      setPlayheadMs(ms);
    };
    const id = window.setInterval(tick, 80);
    return () => window.clearInterval(id);
  }, [playing, excludedRanges, durationMs, videoUrl]);

  // Expose the in-editor state so the agent can read "the user is editing and scrubbed to X".
  useEffect(() => {
    writeAppStateClient("editor-draft", {
      recordingId,
      playheadMs: Math.round(playheadMs),
      playbackSpeed,
      zoom,
      editsJson: edits,
    });
  }, [recordingId, playheadMs, playbackSpeed, zoom, edits]);

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
    (async () => {
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
    if (filmstripSprite) {
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
    filmstripFrameCount,
    filmstripSprite,
  ]);

  // --- actions ------------------------------------------------------------
  const trim = useActionMutation("trim-recording");
  const split = useActionMutation("split-recording");
  const undo = useActionMutation("undo-edit");

  const callTrim = useCallback(
    async (
      range: { startMs: number; endMs: number },
      opts?: { hidden?: boolean },
    ) => {
      try {
        await trim.mutateAsync({
          recordingId,
          startMs: Math.round(range.startMs),
          endMs: Math.round(range.endMs),
          hidden: opts?.hidden ?? false,
        });
        toast.success(
          opts?.hidden ? t("editorLayout.cut") : t("editorLayout.trimmed"),
        );
        setSelectionRange(null);
      } catch (err: any) {
        toast.error(
          err?.message ??
            (opts?.hidden
              ? t("editorLayout.cutFailed")
              : t("editorLayout.trimFailed")),
        );
      }
    },
    [recordingId, trim, t],
  );

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

      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "z"
      ) {
        e.preventDefault();
        undo.mutate({ recordingId });
      } else if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        e.key.toLowerCase() === "i"
      ) {
        setSelectionRange((r) => ({
          type: "range",
          startMs: playheadMs,
          endMs: r?.endMs && r.endMs > playheadMs ? r.endMs : playheadMs + 1000,
        }));
      } else if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        e.key.toLowerCase() === "o"
      ) {
        setSelectionRange((r) => ({
          type: "range",
          startMs:
            r?.startMs && r.startMs < playheadMs
              ? r.startMs
              : Math.max(0, playheadMs - 1000),
          endMs: playheadMs,
        }));
      } else if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        e.key.toLowerCase() === "x"
      ) {
        // Real Cut: was previously the same plain trim as Backspace with a
        // mislabeled "Cut" toast. Now matches the context menu's Cut —
        // copies the text and removes it from the transcript view entirely
        // (hidden), instead of leaving a strikethrough.
        const range = selectionRange;
        if (range) {
          e.preventDefault();
          const text = transcriptSegments
            .filter((s) => s.startMs < range.endMs && s.endMs > range.startMs)
            .map((s) => s.text.trim())
            .join(" ");
          if (text) navigator.clipboard?.writeText(text).catch(() => {});
          callTrim(range, { hidden: true });
        }
      } else if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        e.key.toLowerCase() === "s"
      ) {
        // Split at playhead
        e.preventDefault();
        split
          .mutateAsync({ recordingId, atMs: Math.round(playheadMs) })
          .then(() => toast.success(t("editorLayout.split")))
          .catch((err: any) =>
            toast.error(err?.message ?? t("editorLayout.splitFailed")),
          );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    playheadMs,
    recordingId,
    selectionRange,
    split,
    undo,
    callTrim,
    transcriptSegments,
  ]);

  // Default selection window so the TrimHandles have something to render.
  const effectiveSelection = selectionRange ?? {
    type: "range" as const,
    ...defaultSelectionRange(playheadMs, durationMs),
  };

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
      <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
        {/* Top region: video | transcript panel | optional chapters */}
        <div
          className="grid flex-1 min-h-0 min-w-0 overflow-hidden"
          style={{
            gridTemplateColumns: chaptersOpen
              ? `minmax(0,1fr) ${transcriptPanelWidth}px 300px`
              : `minmax(0,1fr) ${transcriptPanelWidth}px`,
          }}
        >
          {/* Row 1: video */}
          <div className="flex min-h-0 min-w-0 flex-1 basis-[220px] items-center justify-center overflow-hidden bg-black p-4">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                className="h-full w-full rounded object-contain shadow"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                controls={false}
              />
            ) : (
              <div className="text-sm text-muted-foreground">
                {t("editorLayout.noVideoYet")}
              </div>
            )}
          </div>

          {/* Transcript: Descript-like side panel, docked by default,
              resizable via the left-edge drag handle */}
          <div className="relative flex min-h-0 min-w-0 flex-col border-l border-border">
            <div
              onPointerDown={onTranscriptResizeDown}
              className="absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize hover:bg-primary/20"
              aria-hidden
            />
            <TranscriptEditor
              segments={transcriptSegments}
              edits={edits}
              currentMs={playheadMs}
              annotations={timelineAnnotations}
              onSeek={seek}
              onTrimRange={callTrim}
              onSelectionChange={(range) =>
                setSelectionRange(range ? { type: "range", ...range } : null)
              }
              onCreateSection={(range) =>
                addAnnotationMutation.mutate(
                  {
                    recordingId,
                    startMs: Math.round(range.startMs),
                    endMs: Math.round(range.endMs),
                    kind: "generic",
                  } as any,
                  { onSettled: () => refetchAnnotations() } as any,
                )
              }
              onRestoreRange={(range) =>
                restoreMutation.mutate({
                  recordingId,
                  startMs: Math.round(range.startMs),
                  endMs: Math.round(range.endMs),
                } as any)
              }
              onAddMarkerAt={(ms) => addMarkerAt(ms, "generic")}
              onSplitAt={(atMs) =>
                splitMutation.mutate({ recordingId, atMs } as any)
              }
              splitPoints={splitPoints}
              videoUrl={videoUrl}
              onSelectSegmentAt={(ms) =>
                setSelectionRange({ type: "segment", ...segmentBoundsAt(ms) })
              }
              segmentBoundsAt={segmentBoundsAt}
              onRemoveSplitAt={(atMs) =>
                removeSplitMutation.mutate({ recordingId, atMs } as any)
              }
              className="flex-1"
            />
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

        {/* Control bar: undo, actions, play, split, speed — Descript keeps
            transport controls with the timeline, so it lives directly above
            the timeline bars rather than at the top of the editor. */}
        <EditorToolbar
          recordingId={recordingId}
          playheadMs={playheadMs}
          durationMs={durationMs}
          playing={playing}
          onPlayPause={() => setPlaying((p) => !p)}
          playbackSpeed={playbackSpeed}
          onPlaybackSpeedChange={handlePlaybackSpeedChange}
          zoom={zoom}
          onZoomChange={setZoom}
          edits={edits}
          selectionRange={selectionRange}
          video={{ videoUrl, videoFormat, title: recording.title }}
          onOpenThumbnailPicker={() => setThumbOpen(true)}
          onOpenChapters={() => setChaptersOpen((v) => !v)}
          onOpenStitch={() => setStitchOpen(true)}
          onAddMarker={addMarkerAt}
          onOpenRewind={() => setRewindOpen(true)}
          rewindAlreadyAdded={Boolean(edits.rewindOriginalStartMs)}
          rewindAvailable={canOfferRewindHistory(playerData?.role)}
          rewindRequiresPrivate={recording?.visibility !== "private"}
          chaptersOpen={chaptersOpen}
        />

        {/* Row 3: waveform + timeline (full width, below the control bar) */}
        <div
          ref={containerRef}
          className="relative min-w-0 shrink-0 space-y-1 overflow-hidden bg-card/30 p-2"
        >
          <div
            className="shadow-3d-sm min-w-0 overflow-hidden rounded-md border border-border/70"
            style={{ width: viewportWidth }}
          >
            <div
              style={{
                transform: `translateX(${-scrollLeft}px)`,
                width: totalWidth,
              }}
            >
              <Timeline
                width={totalWidth}
                durationMs={durationMs}
                playheadMs={playheadMs}
                chapters={chapters}
                annotations={timelineAnnotations}
                excludedRanges={excludedRanges}
                splitPoints={splitPoints}
                originalStartMs={edits.rewindOriginalStartMs}
                onSeek={seek}
                onClickChapter={(c) => seek(c.startMs)}
                onClickAnnotation={(a) => seek(a.startMs)}
                onAddAnnotationAt={addMarkerAt}
                getEditActions={(ms) =>
                  buildTimelineActions({
                    atMs: ms,
                    durationMs,
                    selectionRange,
                    t,
                    formatTime: formatMs,
                    handlers: {
                      splitAt: (atMs) =>
                        splitMutation.mutate({ recordingId, atMs } as any),
                      trimRange: (startMs, endMs) =>
                        trimMutation.mutate({
                          recordingId,
                          startMs,
                          endMs,
                        } as any),
                      addMarker: addMarkerAt,
                    },
                  })
                }
                onRemoveSplit={(atMs) =>
                  removeSplitMutation.mutate({ recordingId, atMs } as any)
                }
                onMoveSplit={(fromMs, toMs) =>
                  moveSplitMutation.mutate({
                    recordingId,
                    fromMs,
                    toMs,
                  } as any)
                }
                onMoveAnnotation={(a, toMs) =>
                  updateAnnotationMutation.mutate(
                    {
                      id: a.id,
                      startMs: Math.round(toMs),
                      ...(a.endMs != null
                        ? {
                            endMs: Math.round(a.endMs + (toMs - a.startMs)),
                          }
                        : {}),
                    } as any,
                    { onSettled: () => refetchAnnotations() } as any,
                  )
                }
                onToggleAnnotationResolved={(a) =>
                  updateAnnotationMutation.mutate(
                    { id: a.id, resolved: !a.resolved } as any,
                    { onSettled: () => refetchAnnotations() } as any,
                  )
                }
                onChangeAnnotationKind={(a, kind) =>
                  updateAnnotationMutation.mutate(
                    { id: a.id, kind } as any,
                    { onSettled: () => refetchAnnotations() } as any,
                  )
                }
                onDeleteAnnotation={(a) =>
                  deleteAnnotationMutation.mutate(
                    { id: a.id } as any,
                    { onSettled: () => refetchAnnotations() } as any,
                  )
                }
              />
            </div>
          </div>

          <div
            className="shadow-3d-inset-well-deep relative min-w-0 overflow-hidden rounded-lg bg-background/60"
            style={{ width: viewportWidth, height: TRACK_STRIP_HEIGHT }}
            onContextMenu={(e) => {
              // Right-click: an active free-range selection owns clicks
              // inside its span (range actions); anywhere else selects the
              // segment under the cursor and offers segment actions. (This
              // container is NOT translated, so the scroll offset must be
              // added — unlike inside the ruler.)
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left + scrollLeft;
              const ms = Math.max(
                0,
                Math.min(durationMs, (x / totalWidth) * durationMs),
              );
              if (
                selectionRange?.type === "range" &&
                ms >= selectionRange.startMs &&
                ms <= selectionRange.endMs
              ) {
                setStripMenu({
                  x: e.clientX,
                  y: e.clientY,
                  target: { type: "range", range: selectionRange },
                });
                return;
              }
              const range = segmentBoundsAt(ms);
              setSelectionRange({ type: "segment", ...range });
              setStripMenu({
                x: e.clientX,
                y: e.clientY,
                target: { type: "segment", range },
              });
            }}
          >
            {/* Filmstrip (frames) — click seeks, like the waveform. */}
            <div
              className="absolute inset-x-0 top-0 cursor-pointer overflow-hidden"
              style={{ height: FILMSTRIP_HEIGHT }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left + scrollLeft;
                seek(
                  Math.max(
                    0,
                    Math.min(durationMs, (x / totalWidth) * durationMs),
                  ),
                );
              }}
            >
              <div
                style={{
                  width: totalWidth,
                  transform: `translateX(${-scrollLeft}px)`,
                }}
              >
                <canvas
                  ref={filmstripCanvasRef}
                  style={{ width: totalWidth, height: FILMSTRIP_HEIGHT }}
                />
              </div>
            </div>
            {/* Recording title, overlaid like the full editor's item label */}
            <div className="pointer-events-none absolute left-1 top-1 z-10 max-w-[60%] truncate rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
              {recording.title}
            </div>
            <div
              className="absolute inset-x-0 bottom-0"
              style={{ height: WAVEFORM_HEIGHT }}
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
                excludedRanges={excludedRanges}
                selectionRange={selectionRange}
                selectionType={selectionRange?.type ?? "range"}
                activityRanges={transcriptSegments}
                onSeek={(ms) => {
                  // Clicking the audio representation selects the enclosing
                  // segment (Descript-style) besides seeking; the filmstrip
                  // above stays seek-only.
                  seek(ms);
                  if (splitPoints.length > 0) {
                    setSelectionRange({
                      type: "segment",
                      ...segmentBoundsAt(ms),
                    });
                  }
                }}
                onScroll={(s) => setScrollLeft(s)}
                scrollLeft={scrollLeft}
              />
            </div>
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div
                className="relative h-full"
                style={{
                  width: totalWidth,
                  transform: `translateX(${-scrollLeft}px)`,
                }}
              >
                <TrimHandles
                  width={totalWidth}
                  height={TRACK_STRIP_HEIGHT}
                  value={effectiveSelection}
                  onChange={(next) =>
                    setSelectionRange({ type: "range", ...next })
                  }
                  tone={effectiveSelection.type}
                  durationMs={durationMs}
                />
              </div>
            </div>
            {/* Timestamp markers are a first-class layer: stems run from
                  under the ruler through the filmstrip and waveform,
                  mirroring the full-editor treatment. Bounded to the strip
                  so they never bleed into the footer. */}
            {timelineAnnotations.length > 0 && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div
                  className="relative h-full"
                  style={{
                    width: totalWidth,
                    transform: `translateX(${-scrollLeft}px)`,
                  }}
                >
                  {timelineAnnotations
                    .filter((a) => a.endMs !== null)
                    .map((a) => {
                      const left =
                        (a.startMs / Math.max(durationMs, 1)) * totalWidth;
                      const width = Math.max(
                        1,
                        ((Math.min(durationMs, a.endMs ?? 0) - a.startMs) /
                          Math.max(durationMs, 1)) *
                          totalWidth,
                      );
                      return (
                        <div
                          key={`stem-band-${a.id}`}
                          className={cn(
                            "absolute inset-y-0 opacity-10",
                            annotationColorClass(a.kind),
                            a.resolved && "opacity-[0.04]",
                          )}
                          style={{ left, width }}
                        />
                      );
                    })}
                  {timelineAnnotations.map((a) => (
                    <div
                      key={`stem-${a.id}`}
                      className={cn(
                        "absolute inset-y-0 w-0.5 -translate-x-1/2 opacity-60",
                        annotationColorClass(a.kind),
                        a.resolved && "opacity-20",
                      )}
                      style={{
                        left:
                          (a.startMs / Math.max(durationMs, 1)) * totalWidth,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            {/* Descript-style segment cards: the track itself visibly splits
                — an opaque gap divider between segments (draggable: moving
                it moves the boundary), with a subtle card outline per
                segment, instead of only a needle line in the ruler. */}
            {splitPoints.length > 0 && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div
                  className="relative h-full"
                  style={{
                    width: totalWidth,
                    transform: `translateX(${-scrollLeft}px)`,
                  }}
                >
                  {segmentRanges.map((seg, i) => {
                    const left =
                      (seg.startMs / Math.max(durationMs, 1)) * totalWidth;
                    const segWidth =
                      ((seg.endMs - seg.startMs) / Math.max(durationMs, 1)) *
                      totalWidth;
                    const isSelected =
                      selectionRange?.type === "segment" &&
                      Math.abs(selectionRange.startMs - seg.startMs) < 2 &&
                      Math.abs(selectionRange.endMs - seg.endMs) < 2;
                    return (
                      <div
                        key={`seg-card-${i}`}
                        className={cn(
                          "absolute inset-y-0 rounded-md border",
                          isSelected
                            ? "border-ring border-2 bg-ring/10"
                            : "border-border/60",
                        )}
                        style={{ left: left + 2, width: segWidth - 4 }}
                      />
                    );
                  })}
                  {splitPoints.map((ms, i) => {
                    const dragging = trackSplitDrag?.fromMs === ms;
                    const shownMs = dragging ? trackSplitDrag.ghostMs : ms;
                    const x = (shownMs / Math.max(durationMs, 1)) * totalWidth;
                    return (
                      <button
                        key={`seg-divider-${i}-${ms}`}
                        type="button"
                        className="group pointer-events-auto absolute inset-y-0 w-[11px] -translate-x-1/2 cursor-col-resize"
                        style={{ left: x }}
                        title={`Split @ ${formatMs(shownMs)}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (trackSplitMovedRef.current) {
                            trackSplitMovedRef.current = false;
                            return;
                          }
                          seek(ms);
                        }}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          e.stopPropagation();
                          trackSplitStartXRef.current = e.clientX;
                          trackSplitMovedRef.current = false;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setTrackSplitDrag({ fromMs: ms, ghostMs: ms });
                        }}
                        onPointerMove={(e) => {
                          if (!dragging) return;
                          if (!e.currentTarget.hasPointerCapture(e.pointerId))
                            return;
                          if (
                            Math.abs(e.clientX - trackSplitStartXRef.current) >
                            3
                          ) {
                            trackSplitMovedRef.current = true;
                          }
                          const parent = e.currentTarget.parentElement;
                          if (!parent) return;
                          const rect = parent.getBoundingClientRect();
                          const ghostMs = Math.max(
                            0,
                            Math.min(
                              durationMs,
                              ((e.clientX - rect.left) / totalWidth) *
                                durationMs,
                            ),
                          );
                          setTrackSplitDrag({ fromMs: ms, ghostMs });
                        }}
                        onPointerUp={(e) => {
                          if (!dragging) return;
                          e.currentTarget.releasePointerCapture(e.pointerId);
                          if (trackSplitMovedRef.current) {
                            moveSplitMutation.mutate({
                              recordingId,
                              fromMs: ms,
                              toMs: Math.round(trackSplitDrag.ghostMs),
                            } as any);
                          }
                          setTrackSplitDrag(null);
                        }}
                        onPointerCancel={() => {
                          trackSplitMovedRef.current = false;
                          setTrackSplitDrag(null);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setStripMenu({
                            x: e.clientX,
                            y: e.clientY,
                            target: { type: "split", ms },
                          });
                        }}
                      >
                        {/* Opaque gap that separates the segment cards —
                            filmstrip content can be near-black, so the gap
                            alone isn't enough: the card edge lines and the
                            always-visible grip make the cut read. */}
                        <span className="absolute inset-y-0 left-1/2 w-[8px] -translate-x-1/2 bg-background" />
                        <span className="absolute inset-y-0 left-1/2 ml-[-5px] w-px bg-border" />
                        <span className="absolute inset-y-0 left-1/2 ml-[4px] w-px bg-border" />
                        <span
                          className={cn(
                            "absolute left-1/2 top-1/2 h-8 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/50 transition-colors group-hover:bg-muted-foreground",
                            dragging && "bg-rose-400",
                          )}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Track-strip context menu: segment cards and split dividers are
              first-class right-click targets, same as in the ruler. */}
          {stripMenu ? (
            <CoordinateMenu
              open
              x={stripMenu.x}
              y={stripMenu.y}
              onOpenChange={(open) => {
                if (!open) setStripMenu(null);
              }}
            >
              {stripMenu.target.type === "range" ? (
                <>
                  <DropdownMenuItem
                    onSelect={() => {
                      if (stripMenu.target.type !== "range") return;
                      addAnnotationMutation.mutate(
                        {
                          recordingId,
                          startMs: Math.round(stripMenu.target.range.startMs),
                          endMs: Math.round(stripMenu.target.range.endMs),
                          kind: "generic",
                        } as any,
                        { onSettled: () => refetchAnnotations() } as any,
                      );
                      setStripMenu(null);
                    }}
                  >
                    <IconBracketsContain className="h-4 w-4" />
                    {t("transcriptEditor.createSection")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setSelectionRange(null);
                      setStripMenu(null);
                    }}
                  >
                    {t("editorToolbar.clearSelection")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => {
                      if (stripMenu.target.type !== "range") return;
                      trimMutation.mutate({
                        recordingId,
                        startMs: Math.round(stripMenu.target.range.startMs),
                        endMs: Math.round(stripMenu.target.range.endMs),
                      } as any);
                      setSelectionRange(null);
                      setStripMenu(null);
                    }}
                  >
                    <IconCut className="h-4 w-4" />
                    {t("editorToolbar.cutSelection")}
                  </DropdownMenuItem>
                </>
              ) : stripMenu.target.type === "segment" ? (
                <>
                  <DropdownMenuItem
                    onSelect={() => {
                      if (stripMenu.target.type !== "segment") return;
                      seek(stripMenu.target.range.startMs);
                      setStripMenu(null);
                    }}
                  >
                    {t("annotationsStrip.jumpTo", {
                      time: formatMs(stripMenu.target.range.startMs),
                    })}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      if (stripMenu.target.type !== "segment") return;
                      addAnnotationMutation.mutate(
                        {
                          recordingId,
                          startMs: Math.round(stripMenu.target.range.startMs),
                          endMs: Math.round(stripMenu.target.range.endMs),
                          kind: "generic",
                        } as any,
                        { onSettled: () => refetchAnnotations() } as any,
                      );
                      setStripMenu(null);
                    }}
                  >
                    <IconBracketsContain className="h-4 w-4" />
                    {t("transcriptEditor.createSection")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => {
                      if (stripMenu.target.type !== "segment") return;
                      trimMutation.mutate({
                        recordingId,
                        startMs: Math.round(stripMenu.target.range.startMs),
                        endMs: Math.round(stripMenu.target.range.endMs),
                      } as any);
                      setStripMenu(null);
                    }}
                  >
                    <IconCut className="h-4 w-4" />
                    {t("editorToolbar.cutSegment")}
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem
                    onSelect={() => {
                      if (stripMenu.target.type !== "split") return;
                      seek(stripMenu.target.ms);
                      setStripMenu(null);
                    }}
                  >
                    {t("annotationsStrip.jumpTo", {
                      time: formatMs(stripMenu.target.ms),
                    })}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => {
                      if (stripMenu.target.type !== "split") return;
                      removeSplitMutation.mutate({
                        recordingId,
                        atMs: stripMenu.target.ms,
                      } as any);
                      setStripMenu(null);
                    }}
                  >
                    <IconTrash className="h-4 w-4" />
                    {t("editorToolbar.removeSplit")}
                  </DropdownMenuItem>
                </>
              )}
            </CoordinateMenu>
          ) : null}

          <div className="flex items-center justify-between gap-3 pt-1 font-mono text-[10px] text-muted-foreground">
            <span>
              {excludedRanges.length} trim(s) · {splitPoints.length} split(s)
            </span>
            <span className="flex items-center gap-1">
              <span className="truncate text-right">
                speed {playbackSpeed}x ·{" "}
                <span
                  className={cn(
                    effectiveSelection.type === "segment"
                      ? "text-ring"
                      : "text-violet-400",
                  )}
                >
                  {effectiveSelection.type === "segment"
                    ? t("editorToolbar.selectionSegment")
                    : t("editorToolbar.selectionRange")}
                </span>{" "}
                {formatMs(effectiveSelection.startMs)}–
                {formatMs(effectiveSelection.endMs)}
              </span>
              {/* Zoom controls, Descript-style at the timeline itself; the
                  scale readout doubles as fit-to-width. Cmd/Ctrl+scroll on
                  the timeline zooms around the cursor. */}
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5"
                aria-label={t("editorToolbar.zoomOut")}
                disabled={zoom <= 1}
                onClick={() => zoomAround(viewportWidth / 2, 1 / 1.5)}
              >
                <IconZoomOut className="h-3.5 w-3.5" />
              </Button>
              <button
                type="button"
                className="min-w-[38px] cursor-pointer rounded px-1 text-center hover:bg-accent hover:text-foreground"
                title={t("editorToolbar.fitToWidth")}
                onClick={() => {
                  setZoom(1);
                  setScrollLeft(0);
                }}
              >
                {Math.round(zoom * 100)}%
              </button>
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5"
                aria-label={t("editorToolbar.zoomIn")}
                disabled={zoom >= 50}
                onClick={() => zoomAround(viewportWidth / 2, 1.5)}
              >
                <IconZoomIn className="h-3.5 w-3.5" />
              </Button>
            </span>
          </div>
        </div>
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
    </div>
  );
}
