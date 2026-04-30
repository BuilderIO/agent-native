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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentNativePath,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
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

import { cn } from "@/lib/utils";
import { computePeaks, type WaveformPeaks } from "@/lib/waveform-peaks";
import {
  parseEdits,
  getExcludedRanges,
  formatMs,
  type EditsJson,
} from "@/lib/timestamp-mapping";

import { EditorToolbar } from "./editor-toolbar";
import { Waveform } from "./waveform";
import { TrimHandles } from "./trim-handles";
import { Timeline } from "./timeline";
import { TranscriptEditor } from "./transcript-editor";
import { ChaptersEditor } from "./chapters-editor";
import { ThumbnailPicker } from "./thumbnail-picker";
import { StitchManager } from "./stitch-manager";

export interface EditorLayoutProps {
  recordingId: string;
  className?: string;
}

const WAVEFORM_HEIGHT = 120;

export function EditorLayout({ recordingId, className }: EditorLayoutProps) {
  // --- server state -------------------------------------------------------
  const recQuery = useActionQuery(
    "get-recording" as any,
    { id: recordingId } as any,
  );
  const transcriptQuery = useActionQuery(
    "get-transcript" as any,
    { id: recordingId } as any,
  );

  const recording: any = (recQuery.data as any)?.recording ?? recQuery.data;
  const durationMs = recording?.durationMs ?? 0;
  const videoUrl: string | null = recording?.videoUrl ?? null;
  const videoFormat: "webm" | "mp4" = recording?.videoFormat ?? "webm";

  const edits: EditsJson = useMemo(
    () => parseEdits(recording?.editsJson),
    [recording?.editsJson],
  );
  const chapters: Array<{ startMs: number; title: string }> = useMemo(() => {
    try {
      return recording?.chaptersJson ? JSON.parse(recording.chaptersJson) : [];
    } catch {
      return [];
    }
  }, [recording?.chaptersJson]);

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
    const raw =
      (transcriptQuery.data as any)?.segments ??
      (transcriptQuery.data as any)?.segmentsJson;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    }
    return [];
  }, [transcriptQuery.data]);

  // --- player state -------------------------------------------------------
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(800);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [selectionRange, setSelectionRange] = useState<{
    startMs: number;
    endMs: number;
  } | null>(null);

  const [thumbOpen, setThumbOpen] = useState(false);
  const [stitchOpen, setStitchOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Measure viewport so waveform + timeline stay responsive.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      setViewportWidth(el.clientWidth);
    });
    ro.observe(el);
    setViewportWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const totalWidth = Math.max(
    viewportWidth,
    Math.floor(viewportWidth * Math.max(1, zoom)),
  );

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
      zoom,
      editsJson: edits,
    });
  }, [recordingId, playheadMs, zoom, edits]);

  // --- waveform peaks, cached in application_state ------------------------
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null);
  useEffect(() => {
    if (!videoUrl) return;
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
      // 2) Compute from the video URL.
      const result = await computePeaks(videoUrl);
      if (cancelled) return;
      setPeaks(result);
      if (result) {
        await writeAppStateClient(`waveform-${recordingId}`, result);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordingId, videoUrl]);

  // --- actions ------------------------------------------------------------
  const trim = useActionMutation("trim-recording" as any);
  const split = useActionMutation("split-recording" as any);
  const undo = useActionMutation("undo-edit" as any);

  const callTrim = useCallback(
    async (range: { startMs: number; endMs: number }) => {
      try {
        await trim.mutateAsync({
          recordingId,
          startMs: Math.round(range.startMs),
          endMs: Math.round(range.endMs),
        } as any);
        toast.success("Trimmed");
        setSelectionRange(null);
      } catch (err: any) {
        toast.error(err?.message ?? "Trim failed");
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
        undo.mutate({ recordingId } as any);
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
            } as any)
            .then(() => {
              toast.success("Cut");
              setSelectionRange(null);
            })
            .catch((err: any) => toast.error(err?.message ?? "Cut failed"));
        }
      } else if (e.key.toLowerCase() === "s") {
        // Split at playhead
        e.preventDefault();
        split
          .mutateAsync({ recordingId, atMs: Math.round(playheadMs) } as any)
          .then(() => toast.success("Split"))
          .catch((err: any) => toast.error(err?.message ?? "Split failed"));
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

  if (recQuery.isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Loading recording…
      </div>
    );
  }
  if (!recording) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Recording not found
      </div>
    );
  }

  return (
    <div
      className={cn("flex flex-col h-full min-h-0 bg-background", className)}
    >
      <EditorToolbar
        recordingId={recordingId}
        playheadMs={playheadMs}
        durationMs={durationMs}
        playing={playing}
        onPlayPause={() => setPlaying((p) => !p)}
        zoom={zoom}
        onZoomChange={setZoom}
        edits={edits}
        selectionRange={selectionRange}
        video={{ videoUrl, videoFormat, title: recording.title }}
        onOpenThumbnailPicker={() => setThumbOpen(true)}
        onOpenChapters={() => setChaptersOpen((v) => !v)}
        onOpenStitch={() => setStitchOpen(true)}
      />

      {/* Preview + transcript + chapters sidebar */}
      <div className="grid grid-cols-[1fr,320px] flex-1 min-h-0">
        <div className="flex flex-col min-h-0">
          {/* Row 1: video */}
          <div className="flex items-center justify-center bg-black/80 min-h-0 p-3">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                className="max-h-full max-w-full rounded shadow"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                controls={false}
                crossOrigin="anonymous"
              />
            ) : (
              <div className="text-sm text-muted-foreground">
                No video available yet.
              </div>
            )}
          </div>

          {/* Row 2: transcript editor */}
          <div className="border-t border-border h-56">
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
            className="border-t border-border p-2 space-y-1 bg-card/30"
          >
            <div className="relative">
              <Waveform
                peaks={peaks}
                width={viewportWidth}
                height={WAVEFORM_HEIGHT}
                zoom={zoom}
                playheadMs={playheadMs}
                durationMs={durationMs}
                excludedRanges={excludedRanges}
                selectionRange={selectionRange}
                onSeek={seek}
                onScroll={(s) => setScrollLeft(s)}
              />
              <div
                className="absolute inset-0 pointer-events-none"
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
                    onCommit={(v) => {
                      // User just dropped a handle — commit the trim.
                      callTrim(v);
                    }}
                    durationMs={durationMs}
                    scrollLeft={scrollLeft}
                  />
                </div>
              </div>
            </div>

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

            <div className="text-[10px] text-muted-foreground font-mono flex justify-between pt-1">
              <span>
                {excludedRanges.length} trim(s) · {splitPoints.length} split(s)
              </span>
              <span>
                zoom {zoom}x · selection {formatMs(effectiveSelection.startMs)}–
                {formatMs(effectiveSelection.endMs)}
              </span>
            </div>
          </div>
        </div>

        {/* Sidebar: chapters */}
        <div className="border-l border-border flex flex-col min-h-0">
          {chaptersOpen && (
            <ChaptersEditor
              recordingId={recordingId}
              chapters={chapters}
              currentMs={playheadMs}
              onSeek={seek}
              className="flex-1"
            />
          )}
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
    </div>
  );
}
