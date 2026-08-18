import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
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
import { defaultSelectionRange } from "./editor-selection";
import { EditorToolbar } from "./editor-toolbar";
import { RewindExtensionDialog } from "./rewind-extension-dialog";
import { StitchManager } from "./stitch-manager";
import { ThumbnailPicker } from "./thumbnail-picker";
import { Timeline } from "./timeline";
import { getTimelineTotalWidth } from "./timeline-geometry";
import { TranscriptEditor } from "./transcript-editor";
import { TrimHandles } from "./trim-handles";
import { Waveform } from "./waveform";

export interface EditorLayoutProps {
  recordingId: string;
  className?: string;
}

const WAVEFORM_HEIGHT = 100;
const MIN_TIMELINE_ZOOM = 1;
const MAX_TIMELINE_ZOOM = 50;

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
  // --- server state -------------------------------------------------------
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
  const splitPoints = useMemo(
    () =>
      edits.trims
        .filter((t) => !t.excluded && t.startMs === t.endMs)
        .map((t) => t.startMs),
    [edits],
  );

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
  const [selectionRange, setSelectionRange] = useState<{
    startMs: number;
    endMs: number;
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

  const totalWidth = useMemo(
    () => getTimelineTotalWidth(viewportWidth, zoom),
    [viewportWidth, zoom],
  );

  const clampedScrollLeft = Math.min(
    scrollLeft,
    Math.max(0, totalWidth - viewportWidth),
  );

  const calculateAnchoredScrollLeft = useCallback(
    (
      nextZoom: number,
      anchor?: { anchorRatio?: number; viewportX?: number },
    ) => {
      const nextTotalWidth = getTimelineTotalWidth(viewportWidth, nextZoom);
      const maxScrollLeft = Math.max(0, nextTotalWidth - viewportWidth);
      const anchorMs = selectionRange
        ? (selectionRange.startMs + selectionRange.endMs) / 2
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
    [durationMs, playheadMs, selectionRange, viewportWidth],
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
    async (range: { startMs: number; endMs: number }) => {
      try {
        await trim.mutateAsync({
          recordingId,
          startMs: Math.round(range.startMs),
          endMs: Math.round(range.endMs),
        });
        toast.success(t("editorLayout.trimmed"));
        setSelectionRange(null);
      } catch (err: any) {
        toast.error(err?.message ?? t("editorLayout.trimFailed"));
      }
    },
    [recordingId, trim],
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
        // Cut: trim the current selection range
        const range = selectionRange;
        if (range) {
          e.preventDefault();
          trim
            .mutateAsync({
              recordingId,
              startMs: Math.round(range.startMs),
              endMs: Math.round(range.endMs),
            })
            .then(() => {
              toast.success(t("editorLayout.cut"));
              setSelectionRange(null);
            })
            .catch((err: any) =>
              toast.error(err?.message ?? t("editorLayout.cutFailed")),
            );
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
  }, [playheadMs, recordingId, selectionRange, split, trim, undo]);

  // Default selection window so the TrimHandles have something to render.
  const effectiveSelection =
    selectionRange ?? defaultSelectionRange(playheadMs, durationMs);

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
        edits={edits}
        selectionRange={selectionRange}
        video={{ videoUrl, videoFormat, title: recording.title }}
        onOpenThumbnailPicker={() => setThumbOpen(true)}
        onOpenChapters={() => setChaptersOpen((v) => !v)}
        onOpenStitch={() => setStitchOpen(true)}
        onOpenRewind={() => setRewindOpen(true)}
        rewindAlreadyAdded={Boolean(edits.rewindOriginalStartMs)}
        rewindAvailable={canOfferRewindHistory(playerData?.role)}
        rewindRequiresPrivate={recording?.visibility !== "private"}
        chaptersOpen={chaptersOpen}
      />

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

          {/* Row 2: transcript editor */}
          <div className="h-40 shrink-0 border-t border-border">
            <TranscriptEditor
              segments={transcriptSegments}
              edits={edits}
              currentMs={playheadMs}
              onSeek={seek}
              onTrimRange={callTrim}
            />
          </div>

          {/* Row 3: waveform + timeline */}
          <div
            ref={containerRef}
            className="min-w-0 shrink-0 space-y-1 overflow-hidden border-t border-border bg-card/30 p-2"
          >
            <div className="relative min-w-0 overflow-hidden">
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
                selectionRange={effectiveSelection}
                splitPoints={splitPoints}
                activityRanges={transcriptSegments}
                onSeek={seek}
                scrollLeft={clampedScrollLeft}
                onScroll={(s) => setScrollLeft(s)}
              />
              <div
                className="pointer-events-none absolute inset-0 overflow-hidden"
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
                    <TrimHandles
                      width={totalWidth}
                      height={WAVEFORM_HEIGHT}
                      value={effectiveSelection}
                      onChange={setSelectionRange}
                      durationMs={durationMs}
                      splitPoints={splitPoints}
                    />
                  )}
                </div>
              </div>
            </div>

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

            <div className="flex justify-between gap-3 pt-1 font-mono text-[10px] text-muted-foreground">
              <span>
                {excludedRanges.length} trim(s) · {splitPoints.length} split(s)
              </span>
              <span className="truncate text-right">
                speed {playbackSpeed}x · zoom {zoom}x · selection{" "}
                {formatMs(effectiveSelection.startMs)}–
                {formatMs(effectiveSelection.endMs)}
              </span>
            </div>
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
