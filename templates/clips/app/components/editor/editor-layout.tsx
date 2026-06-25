/**
 * Non-destructive editor for a single recording.
 *
 * Three rows, top to bottom:
 *   1. Preview — a simple <video> element plus a side panel for transcript.
 *   2. Transcript editor (middle) + chapters sidebar.
 *   3. Waveform, trim handles, timeline ruler (bottom).
 *
 * All edits (trim, split, thumbnail, chapters, stitch) go through actions so
 * the agent and UI stay in sync via `useDbSync` + the `refresh-signal` poke.
 */

import {
  agentNativePath,
  appBasePath,
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
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
import {
  parseEdits,
  getExcludedRanges,
  formatMs,
  type EditsJson,
} from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";
import { computePeaks, type WaveformPeaks } from "@/lib/waveform-peaks";

import { ChaptersEditor } from "./chapters-editor";
import { EditorToolbar } from "./editor-toolbar";
import { StitchManager } from "./stitch-manager";
import { ThumbnailPicker } from "./thumbnail-picker";
import { Timeline } from "./timeline";
import { TranscriptEditor } from "./transcript-editor";
import { TrimHandles } from "./trim-handles";
import { Waveform } from "./waveform";

export interface EditorLayoutProps {
  recordingId: string;
  className?: string;
}

const WAVEFORM_HEIGHT = 120;

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
  const [chaptersOpen, setChaptersOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

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

  const totalWidth = Math.max(
    viewportWidth,
    Math.floor(viewportWidth * Math.max(1, zoom)),
  );

  useEffect(() => {
    setScrollLeft((current) =>
      Math.min(current, Math.max(0, totalWidth - viewportWidth)),
    );
  }, [totalWidth, viewportWidth]);

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
    if (videoRef.current) videoRef.current.playbackRate = next;
  }, [defaultPreviewSpeed, recording?.id]);

  // Keep the editor preview speed visible and in sync with the media element.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = playbackSpeed;
  }, [playbackSpeed, videoUrl]);

  const handlePlaybackSpeedChange = useCallback((rate: number) => {
    const next = parsePlaybackSpeed(rate) ?? 1.2;
    setPlaybackSpeed(next);
    savePlaybackSpeedPreference(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  }, []);

  // Keep the playheadMs in sync with the element's currentTime.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setPlayheadMs(v.currentTime * 1000);
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [videoUrl]);

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

  const seek = useCallback((ms: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = ms / 1000;
    setPlayheadMs(ms);
  }, []);

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
      } else if (e.key.toLowerCase() === "i") {
        setSelectionRange((r) => ({
          startMs: playheadMs,
          endMs: r?.endMs && r.endMs > playheadMs ? r.endMs : playheadMs + 1000,
        }));
      } else if (e.key.toLowerCase() === "o") {
        setSelectionRange((r) => ({
          startMs:
            r?.startMs && r.startMs < playheadMs
              ? r.startMs
              : Math.max(0, playheadMs - 1000),
          endMs: playheadMs,
        }));
      } else if (e.key.toLowerCase() === "x") {
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
      } else if (e.key.toLowerCase() === "s") {
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
  const effectiveSelection = selectionRange ?? {
    startMs: Math.max(0, playheadMs - 1000),
    endMs: Math.min(durationMs || 1_000, playheadMs + 1000),
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
                crossOrigin="anonymous"
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
                width={viewportWidth}
                height={WAVEFORM_HEIGHT}
                zoom={zoom}
                playheadMs={playheadMs}
                durationMs={durationMs}
                excludedRanges={excludedRanges}
                selectionRange={selectionRange}
                activityRanges={transcriptSegments}
                onSeek={seek}
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
                    transform: `translateX(${-scrollLeft}px)`,
                  }}
                >
                  <TrimHandles
                    width={totalWidth}
                    height={WAVEFORM_HEIGHT}
                    value={effectiveSelection}
                    onChange={setSelectionRange}
                    durationMs={durationMs}
                    scrollLeft={scrollLeft}
                  />
                </div>
              </div>
            </div>

            <div
              className="min-w-0 overflow-hidden rounded-sm border border-border/70"
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
                  excludedRanges={excludedRanges}
                  splitPoints={splitPoints}
                  scrollLeft={scrollLeft}
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
      />
      <StitchManager
        open={stitchOpen}
        onOpenChange={setStitchOpen}
        seedRecordingId={recordingId}
      />
    </div>
  );
}
