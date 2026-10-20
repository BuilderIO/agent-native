import { useT } from "@agent-native/core/client/i18n";
import type { MotionAudioClip } from "@shared/motion-code";
import { MOTION_TIMELINE_MAX_DURATION_MS } from "@shared/motion-timeline";
import {
  IconPlus,
  IconTrash,
  IconVolume2,
  IconVolumeOff,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Slider } from "@/components/ui/slider";
import { uploadDesignAudioFile } from "@/lib/design-media-upload";
import { cn } from "@/lib/utils";

import { PanelSection } from "./edit-panel/panel-primitives";

const MIN_AUDIO_CLIP_WIDTH_PERCENT = 1;

type MotionAudioSurface = "inspector" | "sidebar" | "timeline";

interface MotionAudioTracksProps {
  surface: MotionAudioSurface;
  clips: MotionAudioClip[];
  playheadMs: number;
  timelineDurationMs: number;
  timelineScaleDurationMs: number;
  readOnly?: boolean;
  onClipsChange?: (clips: MotionAudioClip[]) => void;
  onDurationChange?: (durationMs: number) => void;
  onSeek?: (timelineMs: number) => void;
  uploadAudioFile?: (file: File) => Promise<string>;
  getDurationMs?: (file: File) => Promise<number>;
}

export async function readDesignAudioDurationMs(file: File): Promise<number> {
  const objectUrl = URL.createObjectURL(file);
  const audio = new Audio();

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      finish(new Error("motion-audio-duration-unavailable"));
    }, 10_000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("error", handleError);
      audio.pause();
      audio.removeAttribute("src");
      URL.revokeObjectURL(objectUrl);
    };
    const finish = (error?: Error, durationMs?: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else if (durationMs !== undefined) resolve(durationMs);
    };
    const handleLoadedMetadata = () => {
      const durationMs = Math.round(audio.duration * 1000);
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        finish(new Error("motion-audio-duration-unavailable"));
        return;
      }
      finish(undefined, durationMs);
    };
    const handleError = () => {
      finish(new Error("motion-audio-duration-unavailable"));
    };

    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", handleLoadedMetadata, {
      once: true,
    });
    audio.addEventListener("error", handleError, { once: true });
    audio.src = objectUrl;
    audio.load();
  });
}

export function MotionAudioTracks({
  surface,
  clips,
  playheadMs,
  timelineDurationMs,
  timelineScaleDurationMs,
  readOnly = false,
  onClipsChange,
  onDurationChange,
  onSeek,
  uploadAudioFile = uploadDesignAudioFile,
  getDurationMs = readDesignAudioDurationMs,
}: MotionAudioTracksProps) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [draggedStart, setDraggedStart] = useState<{
    clipId: string;
    startMs: number;
  } | null>(null);
  const dragRef = useRef<{
    clipId: string;
    pointerId: number;
    startClientX: number;
    startMs: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const updateClip = (clipId: string, patch: Partial<MotionAudioClip>) => {
    onClipsChange?.(
      clips.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)),
    );
  };

  const splitClipAtPlayhead = useCallback(
    (clipId: string) => {
      const clip = clips.find((candidate) => candidate.id === clipId);
      if (!clip || readOnly || !onClipsChange) return;
      const offsetMs = Math.round(playheadMs - clip.timelineStartMs);
      if (offsetMs <= 0 || offsetMs >= clip.durationMs) return;
      const rightClip: MotionAudioClip = {
        ...clip,
        id: crypto.randomUUID(),
        timelineStartMs: clip.timelineStartMs + offsetMs,
        sourceTrimStartMs: clip.sourceTrimStartMs + offsetMs,
        durationMs: clip.durationMs - offsetMs,
      };
      const leftClip: MotionAudioClip = { ...clip, durationMs: offsetMs };
      const index = clips.findIndex((candidate) => candidate.id === clipId);
      const nextClips = [...clips];
      nextClips.splice(index, 1, leftClip, rightClip);
      onClipsChange(nextClips);
      setSelectedClipId(rightClip.id);
    },
    [clips, onClipsChange, playheadMs, readOnly],
  );

  useEffect(() => {
    if (
      surface !== "timeline" ||
      !selectedClipId ||
      readOnly ||
      !onClipsChange
    ) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !event.altKey ||
        event.key.toLowerCase() !== "k" ||
        (event.target instanceof HTMLElement &&
          event.target.closest("input, textarea, select, [contenteditable]"))
      ) {
        return;
      }
      event.preventDefault();
      splitClipAtPlayhead(selectedClipId);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClipsChange, readOnly, selectedClipId, splitClipAtPlayhead, surface]);

  const handleFileChange = async (
    event: ReactChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !onClipsChange) return;
    if (!isSupportedAudioFile(file)) {
      toast.error(t("designEditor.motion.unsupportedAudio"));
      return;
    }

    setUploading(true);
    try {
      const sourceDurationMs = await getDurationMs(file);
      const sourceUrl = await uploadAudioFile(file);
      const durationMs = Math.min(
        sourceDurationMs,
        MOTION_TIMELINE_MAX_DURATION_MS,
      );
      const requestedStartMs = Math.max(0, Math.round(playheadMs));
      const startMs = Math.min(
        requestedStartMs,
        MOTION_TIMELINE_MAX_DURATION_MS - durationMs,
      );
      const clip: MotionAudioClip = {
        id: crypto.randomUUID(),
        name: file.name.trim().slice(0, 120) || t("designEditor.motion.audio"),
        sourceUrl,
        timelineStartMs: startMs,
        sourceTrimStartMs: 0,
        durationMs,
        volume: 1,
        muted: false,
      };
      onClipsChange([...clips, clip]);
      onDurationChange?.(Math.max(timelineDurationMs, startMs + durationMs));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "motion-audio-duration-unavailable") {
        toast.error(t("designEditor.motion.audioDurationUnavailable"));
      } else if (message.startsWith("Audio upload")) {
        toast.error(t("designEditor.motion.audioUploadFailed"));
      } else if (message === "Only audio files can be uploaded.") {
        toast.error(t("designEditor.motion.unsupportedAudio"));
      } else {
        toast.error(message || t("designEditor.motion.audioUploadFailed"));
      }
    } finally {
      setUploading(false);
    }
  };

  const handleClipPointerDown = (
    clip: MotionAudioClip,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (readOnly || !onClipsChange || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      clipId: clip.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startMs: clip.timelineStartMs,
      moved: false,
    };
    setSelectedClipId(clip.id);
  };

  const handleClipPointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const width =
      event.currentTarget.parentElement?.getBoundingClientRect().width;
    if (!width || width <= 0) return;
    const delta = Math.round(
      ((event.clientX - drag.startClientX) / width) * timelineScaleDurationMs,
    );
    if (Math.abs(delta) < 2 && !drag.moved) return;
    drag.moved = true;
    const clip = clips.find((candidate) => candidate.id === drag.clipId);
    if (!clip) return;
    setDraggedStart({
      clipId: drag.clipId,
      startMs: Math.max(
        0,
        Math.min(
          MOTION_TIMELINE_MAX_DURATION_MS - clip.durationMs,
          drag.startMs + delta,
        ),
      ),
    });
  };

  const handleClipPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved && draggedStart?.clipId === drag.clipId) {
      updateClip(drag.clipId, { timelineStartMs: draggedStart.startMs });
      onDurationChange?.(
        Math.max(
          timelineDurationMs,
          draggedStart.startMs +
            (clips.find((clip) => clip.id === drag.clipId)?.durationMs ?? 0),
        ),
      );
    }
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    setDraggedStart(null);
  };

  if (surface === "sidebar") {
    if (clips.length === 0) return null;

    return (
      <div data-motion-audio-sidebar>
        {clips.map((clip) => (
          <div
            key={clip.id}
            data-motion-audio-sidebar-clip={clip.id}
            className="flex h-6 shrink-0 items-center gap-0.5 border-b border-border/30 px-1"
          >
            <span className="min-w-0 flex-1 truncate pl-1 text-[10px] text-foreground/80">
              {clip.name ||
                audioClipNameFromUrl(clip.sourceUrl) ||
                t("designEditor.motion.audio")}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5 shrink-0"
              disabled={readOnly || !onClipsChange}
              aria-label={t(
                clip.muted
                  ? "designEditor.motion.unmuteAudio"
                  : "designEditor.motion.muteAudio",
              )}
              aria-pressed={clip.muted}
              onClick={() => updateClip(clip.id, { muted: !clip.muted })}
            >
              {clip.muted ? (
                <IconVolumeOff className="size-3.5" />
              ) : (
                <IconVolume2 className="size-3.5" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5 shrink-0 text-muted-foreground hover:text-destructive"
              disabled={readOnly || !onClipsChange}
              aria-label={t("designEditor.motion.removeAudio")}
              onClick={() =>
                onClipsChange?.(clips.filter((item) => item.id !== clip.id))
              }
            >
              <IconTrash className="size-3" />
            </Button>
          </div>
        ))}
      </div>
    );
  }

  if (surface === "inspector") {
    return (
      <PanelSection
        title={t("designEditor.motion.audio")}
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/aac,audio/mpa,audio/mpeg,audio/wav,audio/x-wav,.aac,.mpa,.mp3,.wav"
              className="sr-only"
              tabIndex={-1}
              aria-label={t("designEditor.motion.addAudio")}
              onChange={handleFileChange}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 rounded-md text-muted-foreground hover:text-foreground"
              disabled={readOnly || uploading || !onClipsChange}
              aria-label={t(
                uploading
                  ? "designEditor.motion.uploadingAudio"
                  : "designEditor.motion.addAudio",
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <span className="size-3 animate-pulse rounded-full bg-muted-foreground" />
              ) : (
                <IconPlus className="size-3.5" />
              )}
            </Button>
          </>
        }
      >
        {clips.map((clip) => (
          <div
            key={clip.id}
            data-motion-audio-inspector-clip={clip.id}
            className="space-y-1.5 px-3 py-2"
          >
            <div className="truncate text-[11px] text-muted-foreground">
              {clip.name ||
                audioClipNameFromUrl(clip.sourceUrl) ||
                t("designEditor.motion.audio")}
            </div>
            <div className="flex items-center gap-2">
              <IconVolume2 className="size-3.5 shrink-0 text-muted-foreground" />
              <Slider
                min={0}
                max={100}
                step={1}
                value={[Math.round(clip.volume * 100)]}
                disabled={readOnly || !onClipsChange}
                onValueChange={(value) => {
                  const volume = value[0];
                  if (typeof volume === "number") {
                    updateClip(clip.id, { volume: volume / 100 });
                  }
                }}
                thumbAriaLabel={t("designEditor.motion.volume")}
              />
            </div>
          </div>
        ))}
      </PanelSection>
    );
  }

  if (clips.length === 0) return null;

  return (
    <div data-motion-audio-timeline>
      {clips.map((clip) => {
        const startMs =
          draggedStart?.clipId === clip.id
            ? draggedStart.startMs
            : clip.timelineStartMs;
        const left = (startMs / timelineScaleDurationMs) * 100;
        const width = Math.max(
          MIN_AUDIO_CLIP_WIDTH_PERCENT,
          (clip.durationMs / timelineScaleDurationMs) * 100,
        );
        return (
          <div
            key={clip.id}
            data-motion-audio-timeline-row={clip.id}
            className="relative h-6 shrink-0 border-b border-border/30"
          >
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  data-motion-audio-clip={clip.id}
                  aria-label={`${clip.name || audioClipNameFromUrl(clip.sourceUrl) || t("designEditor.motion.audio")}, ${Math.round(startMs)} ms`}
                  className={cn(
                    "absolute top-0.5 h-5 min-w-0 truncate rounded-sm border border-primary/30 bg-primary/10 px-1 text-left text-[10px] leading-4 text-foreground/80 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                    readOnly && "cursor-default",
                    !readOnly && "cursor-grab active:cursor-grabbing",
                  )}
                  style={{
                    left: `${left}%`,
                    width: `${Math.min(width, 100 - left)}%`,
                  }}
                  onPointerDown={(event) => handleClipPointerDown(clip, event)}
                  onPointerMove={handleClipPointerMove}
                  onPointerUp={handleClipPointerUp}
                  onPointerCancel={handleClipPointerUp}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedClipId(clip.id);
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const fraction =
                      bounds.width > 0
                        ? Math.max(
                            0,
                            Math.min(
                              1,
                              (event.clientX - bounds.left) / bounds.width,
                            ),
                          )
                        : 0;
                    onSeek?.(startMs + fraction * clip.durationMs);
                  }}
                >
                  {clip.name ||
                    audioClipNameFromUrl(clip.sourceUrl) ||
                    t("designEditor.motion.audio")}
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  disabled={
                    readOnly ||
                    !onClipsChange ||
                    playheadMs <= clip.timelineStartMs ||
                    playheadMs >= clip.timelineStartMs + clip.durationMs
                  }
                  onSelect={() => splitClipAtPlayhead(clip.id)}
                >
                  {t("designEditor.motion.splitAudioAtPlayhead")}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        );
      })}
    </div>
  );
}

function audioClipNameFromUrl(sourceUrl: string): string | null {
  try {
    const pathname = new URL(sourceUrl, "https://design.invalid").pathname;
    const name = pathname.split("/").pop();
    return name ? decodeURIComponent(name) : null;
    // coercion-ok: this is display-only; the caller uses its generic audio label when parsing fails.
  } catch {
    return null;
  }
}

function isSupportedAudioFile(file: File): boolean {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return (
    extension === "aac" ||
    extension === "mpa" ||
    extension === "mp3" ||
    extension === "wav" ||
    [
      "audio/aac",
      "audio/mpa",
      "audio/mpeg",
      "audio/wav",
      "audio/x-wav",
    ].includes(file.type.toLowerCase())
  );
}
