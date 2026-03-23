import { useRef, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";
import { Timeline } from "@/components/Timeline";
import { CameraToolbar } from "@/components/CameraToolbar";
import { CursorPositioningOverlay } from "@/components/CursorPositioningOverlay";
import { Save } from "lucide-react";
import { useComposition } from "@/contexts/CompositionContext";
import { useTimeline } from "@/contexts/TimelineContext";
import { usePlayback } from "@/contexts/PlaybackContext";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { cn } from "@/lib/utils";
import NewComposition from "@/pages/NewComposition";

type CompositionViewProps = {
  onCameraKeyframeClick?: (trackType: "camera" | "cursor") => void;
  onCompSettingsClick?: () => void;
  isGenerating?: boolean;
};

export default function CompositionView({
  onCameraKeyframeClick,
  onCompSettingsClick,
  isGenerating = false,
}: CompositionViewProps) {
  // Get frame from URL parameter (?frame=150)
  const [searchParams] = useSearchParams();
  const frameFromUrl = searchParams.get("frame");
  const initialFrame = frameFromUrl ? parseInt(frameFromUrl, 10) : 0;

  // Debug log
  useEffect(() => {
    console.log(
      "CompositionView - initialFrame from URL:",
      initialFrame,
      "frameFromUrl:",
      frameFromUrl,
    );
  }, [initialFrame, frameFromUrl]);

  // Get state from contexts
  const {
    isNew,
    effectiveComposition: composition,
    currentProps,
  } = useComposition();

  const {
    tracks,
    selectedTrackId,
    selectTrack: onSelectTrack,
    updateTrack: onUpdateTrack,
    addTrack: onAddTrack,
    deleteTrack: onDeleteTrack,
  } = useTimeline();

  const { setCurrentFrame, registerSeek } = usePlayback();

  // Detect if there are unsaved changes in localStorage
  const hasUnsavedChanges = useUnsavedChanges();

  // If this is a new composition, render the new composition view
  if (isNew) {
    return <NewComposition isGenerating={isGenerating} />;
  }

  // If no composition selected yet, return null
  if (!composition) return null;

  const playerRef = useRef<VideoPlayerHandle>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [currentFrameLocal, setCurrentFrameLocal] = useState(initialFrame);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  // ── View window (shared between Timeline and VideoPlayer) ─────────────────
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(composition.durationInFrames);

  // Reset to full view when composition (or its duration) changes
  useEffect(() => {
    setViewStart(0);
    setViewEnd(composition.durationInFrames);
  }, [composition.id, composition.durationInFrames]);

  const handleViewChange = useCallback((start: number, end: number) => {
    setViewStart(start);
    setViewEnd(end);
  }, []);

  // Merge live track state into the props passed to the Remotion player.
  const compositionWithProps = {
    ...composition,
    defaultProps: {
      ...currentProps,
      tracks,
    },
  };

  const handleTimelineSeek = useCallback((frame: number) => {
    playerRef.current?.seekTo(frame);
  }, []);

  const handleFrameUpdate = useCallback(
    (frame: number) => {
      setCurrentFrameLocal(frame);
      setCurrentFrame(frame);
    },
    [setCurrentFrame],
  );

  // Register the seek function with parent component
  useEffect(() => {
    registerSeek(() => handleTimelineSeek);
  }, [registerSeek, handleTimelineSeek]);

  // Save as default handler - uses both composition and timeline contexts
  // Core save logic (reusable for both manual and auto-save)
  const performSave = useCallback(
    async (silent = false) => {
      if (!composition) return;

      try {
        // Deduplicate tracks by id (keep first occurrence) to prevent duplicate keys
        const seenIds = new Set<string>();
        const dedupedTracks = tracks.filter((track) => {
          if (seenIds.has(track.id)) return false;
          seenIds.add(track.id);
          return true;
        });

        // Format the tracks for the registry
        const formattedTracks = dedupedTracks.map((track) => {
          const formatted: any = {
            id: track.id,
            label: track.label,
            startFrame: track.startFrame,
            endFrame: track.endFrame,
            easing: track.easing,
          };

          if (track.animatedProps && track.animatedProps.length > 0) {
            formatted.animatedProps = track.animatedProps;
          }

          return formatted;
        });

        // Prepare the update payload
        const update = {
          compositionId: composition.id,
          tracks: formattedTracks,
          defaultProps: currentProps,
          durationInFrames: composition.durationInFrames,
          fps: composition.fps,
          width: composition.width,
          height: composition.height,
        };

        console.log("Saving as default:", update);

        // Save via API endpoint with retry logic
        const maxRetries = 3;
        let lastError: Error | null = null;
        let saveSucceeded = false;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            // Add timeout to fetch request
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

            const response = await fetch("/api/save-composition-defaults", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(update),
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(
                `Server error: ${response.status} - ${errorText}`,
              );
            }

            // Success!
            saveSucceeded = true;
            lastError = null;
            break;
          } catch (fetchError) {
            lastError =
              fetchError instanceof Error
                ? fetchError
                : new Error(String(fetchError));

            // If this is the last attempt, don't retry
            if (attempt === maxRetries - 1) {
              break;
            }

            // Wait before retrying (exponential backoff: 500ms, 1000ms, 2000ms)
            const delay = 500 * Math.pow(2, attempt);
            console.log(
              `[Save] Retry ${attempt + 1}/${maxRetries} after ${delay}ms...`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        // Handle the result
        if (saveSucceeded) {
          // Clear localStorage since registry now has these values
          localStorage.removeItem(`videos-tracks:${composition.id}`);
          localStorage.removeItem(`videos-props:${composition.id}`);
          localStorage.removeItem(`videos-comp-settings:${composition.id}`);
          localStorage.removeItem(`videos-tracks-version:${composition.id}`);

          console.log(`[Save] ✅ Saved "${composition.title}" to registry`);

          if (!silent) {
            alert(
              `✅ Saved "${composition.title}" to registry!\n\nThe page will reload to pick up the changes.`,
            );
          }

          // Reload to pick up fresh registry data
          window.location.reload();
        } else if (lastError) {
          // Network error or server not available after all retries
          const errorMessage = lastError.message;
          console.error(
            "[Save] ❌ Failed to save after retries:",
            errorMessage,
          );

          if (!silent) {
            alert(
              `❌ Failed to save to registry:\n\n${errorMessage}\n\n` +
                `This usually means:\n` +
                `• The dev server needs to be restarted\n` +
                `• The API endpoint is not available\n\n` +
                `Your changes are still saved in browser storage and will persist until you reload the page.`,
            );
          }

          throw lastError; // Re-throw to be caught by outer catch
        }
      } catch (error) {
        console.error("[Save] ❌ Failed to save:", error);
        // Error already handled above, just log it
      }
    },
    [composition, tracks, currentProps],
  );

  // Manual save handler (shows confirmation)
  const handleSaveAsDefault = useCallback(async () => {
    if (!composition) return;

    const confirmed = window.confirm(
      `Save current settings as default for "${composition.title}"?\n\nThis will update the registry file with:\n- Current tracks and animations\n- Current properties\n- Current composition settings`,
    );

    if (!confirmed) return;

    await performSave(false); // Not silent - show alerts
  }, [composition, performSave]);

  // Listen for auto-save events from AI generation
  useEffect(() => {
    const handleAutoSave = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.compositionId === composition?.id) {
        console.log("[Auto-Save] Triggered for:", composition.id);
        await performSave(true); // Silent mode - no alerts
      }
    };

    window.addEventListener("videos.auto-save", handleAutoSave);
    return () => window.removeEventListener("videos.auto-save", handleAutoSave);
  }, [composition?.id, performSave]);

  // Spacebar to play/pause (doesn't trigger when typing in input fields)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        playerRef.current?.toggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col items-center p-4 lg:p-6 min-w-0 bg-background">
      <div className="w-full max-w-5xl flex flex-col gap-0">
        {/* Composition info */}
        <div className="mb-2">
          <h2 className="text-base font-semibold text-foreground/90">
            {composition.title}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5 max-w-lg leading-relaxed">
            {composition.description}
          </p>
        </div>

        {/* Camera toolbar with composition details */}
        <div className="flex items-center gap-2 mb-2">
          <CameraToolbar
            currentFrame={currentFrameLocal}
            fps={composition.fps}
            tracks={tracks}
            onUpdateTrack={onUpdateTrack}
            onAddTrack={onAddTrack}
            durationInFrames={composition.durationInFrames}
            videoContainerRef={videoContainerRef}
          />

          {/* Composition details */}
          <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
            <button
              onClick={onCompSettingsClick}
              className="text-[10px] px-2 py-1 rounded-md bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/50 hover:border-border font-mono transition-colors cursor-pointer"
              title="Click to edit output size"
            >
              {composition.width}×{composition.height}
            </button>
            <button
              onClick={onCompSettingsClick}
              className="text-[10px] px-2 py-1 rounded-md bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/50 hover:border-border font-mono transition-colors cursor-pointer"
              title="Click to edit frame rate"
            >
              {composition.fps}fps
            </button>
            <button
              onClick={onCompSettingsClick}
              className="text-[10px] px-2 py-1 rounded-md bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/50 hover:border-border font-mono transition-colors cursor-pointer"
              title="Click to edit duration"
            >
              {(composition.durationInFrames / composition.fps).toFixed(1)}s
            </button>
            <button
              onClick={handleSaveAsDefault}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors text-xs font-medium",
                hasUnsavedChanges
                  ? "bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30"
                  : "bg-secondary/50 hover:bg-secondary text-muted-foreground border border-border/50",
              )}
              title={
                hasUnsavedChanges
                  ? "Save current settings as default for this composition"
                  : "All changes saved to registry"
              }
            >
              <Save className="w-3.5 h-3.5" />
              Save
            </button>
          </div>
        </div>

        {/* Video player with cursor positioning overlay */}
        <div ref={videoContainerRef} style={{ position: "relative" }}>
          <VideoPlayer
            ref={playerRef}
            key={composition.id}
            composition={compositionWithProps}
            onFrameUpdate={handleFrameUpdate}
            onPlayingChange={setIsPlaying}
            playbackRate={playbackRate}
            onPlaybackRateChange={setPlaybackRate}
            viewStart={viewStart}
            viewEnd={viewEnd}
            initialFrame={initialFrame}
          />
          <CursorPositioningOverlay
            compositionWidth={composition.width}
            compositionHeight={composition.height}
            currentFrame={currentFrameLocal}
            fps={composition.fps}
            tracks={tracks}
            onUpdateTrack={onUpdateTrack}
            isPlaying={isPlaying}
          />
        </div>

        <Timeline
          currentFrame={currentFrameLocal}
          durationInFrames={composition.durationInFrames}
          fps={composition.fps}
          onSeek={handleTimelineSeek}
          tracks={tracks}
          selectedTrackId={selectedTrackId}
          onSelectTrack={onSelectTrack}
          onUpdateTrack={onUpdateTrack}
          onDeleteTrack={onDeleteTrack}
          viewStart={viewStart}
          viewEnd={viewEnd}
          onViewChange={handleViewChange}
          onCameraKeyframeClick={onCameraKeyframeClick}
          isPlaying={isPlaying}
        />
      </div>
    </div>
  );
}
