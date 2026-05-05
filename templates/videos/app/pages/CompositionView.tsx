import { useRef, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";
import { Timeline } from "@/components/Timeline";
import { CameraToolbar } from "@/components/CameraToolbar";
import { CursorPositioningOverlay } from "@/components/CursorPositioningOverlay";
import {
  IconDeviceFloppy,
  IconTrash,
  IconAdjustments,
} from "@tabler/icons-react";
import {
  agentNativePath,
  appBasePath,
  useDevMode,
  ShareButton,
  useSession,
} from "@agent-native/core/client";
import type { CollabUser } from "@agent-native/core/client";
import { Pinpoint } from "@agent-native/pinpoint/react";
import { useComposition } from "@/contexts/CompositionContext";
import { useTimeline } from "@/contexts/TimelineContext";
import { usePlayback } from "@/contexts/PlaybackContext";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { cn } from "@/lib/utils";
import {
  TweaksPanel,
  DEFAULT_COMPOSITION_TWEAKS,
} from "@/components/TweaksPanel";
import { CollabPresenceBar } from "@/components/CollabPresenceBar";
import NewComposition from "@/pages/NewComposition";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type CompositionViewProps = {
  onCameraKeyframeClick?: (trackType: "camera" | "cursor") => void;
  onCompSettingsClick?: () => void;
  isGenerating?: boolean;
  activeUsers?: CollabUser[];
  agentActive?: boolean;
  agentPresent?: boolean;
};

export default function CompositionView({
  onCameraKeyframeClick,
  onCompSettingsClick,
  isGenerating = false,
  activeUsers = [],
  agentActive = false,
  agentPresent = false,
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

  const { isDevMode } = useDevMode();
  const { session } = useSession();

  // Get state from contexts
  const {
    isNew,
    effectiveComposition: composition,
    currentProps,
    onDelete,
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

  // Tweaks panel
  const [tweaksVisible, setTweaksVisible] = useState(false);
  const [tweakValues, setTweakValues] = useState<
    Record<string, string | number | boolean>
  >(() => {
    const defaults: Record<string, string | number | boolean> = {};
    for (const t of DEFAULT_COMPOSITION_TWEAKS) {
      defaults[t.id] = t.defaultValue;
    }
    return defaults;
  });

  const handleTweakChange = useCallback(
    (id: string, value: string | number | boolean) => {
      setTweakValues((prev) => ({ ...prev, [id]: value }));
    },
    [],
  );

  // Dialog states for save confirmation and status alerts
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [showSaveError, setShowSaveError] = useState(false);
  const [saveErrorMessage, setSaveErrorMessage] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const canSave =
    !!composition && (isDevMode || composition.storage === "database");

  // All hooks must be called before any early returns (React rules of hooks)
  const playerRef = useRef<VideoPlayerHandle>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [currentFrameLocal, setCurrentFrameLocal] = useState(initialFrame);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  // ── View window (shared between Timeline and VideoPlayer) ─────────────────
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(composition?.durationInFrames ?? 240);

  // Reset to full view when composition (or its duration) changes
  useEffect(() => {
    if (!composition) return;
    setViewStart(0);
    setViewEnd(composition.durationInFrames);
  }, [composition?.id, composition?.durationInFrames]);

  const handleViewChange = useCallback((start: number, end: number) => {
    setViewStart(start);
    setViewEnd(end);
  }, []);

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

  // IconDeviceFloppy as default handler - uses both composition and timeline contexts
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

        const saveToDatabase = async (signal: AbortSignal) => {
          const response = await fetch(
            agentNativePath("/_agent-native/actions/update-composition"),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal,
              body: JSON.stringify({
                id: composition.id,
                data: JSON.stringify({
                  description: composition.description,
                  durationInFrames: composition.durationInFrames,
                  fps: composition.fps,
                  width: composition.width,
                  height: composition.height,
                  defaultProps: currentProps,
                  tracks: formattedTracks,
                }),
              }),
            },
          );

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
          }

          const result = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (result?.error) throw new Error(result.error);
        };

        const saveToRegistry = async (signal: AbortSignal) => {
          const response = await fetch(
            `${appBasePath()}/api/save-composition-defaults`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal,
              body: JSON.stringify(update),
            },
          );

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
          }
        };

        const maxRetries = 3;
        let lastError: Error | null = null;
        let saveSucceeded = false;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            // Add timeout to fetch request
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
            try {
              if (composition.storage === "database") {
                await saveToDatabase(controller.signal);
              } else {
                await saveToRegistry(controller.signal);
              }
            } finally {
              clearTimeout(timeoutId);
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

          console.log(`[Save] Saved "${composition.title}" defaults`);

          if (!silent) {
            setShowSaveSuccess(true);
          } else {
            // Reload to pick up fresh registry data
            window.location.reload();
          }
        } else if (lastError) {
          // Network error or server not available after all retries
          const errorMessage = lastError.message;
          console.error("[Save] Failed to save after retries:", errorMessage);

          if (!silent) {
            setSaveErrorMessage(errorMessage);
            setShowSaveError(true);
          }

          throw lastError; // Re-throw to be caught by outer catch
        }
      } catch (error) {
        console.error("[Save] Failed to save:", error);
        // Error already handled above, just log it
      }
    },
    [composition, tracks, currentProps],
  );

  // Manual save handler (shows confirmation)
  const handleSaveAsDefault = useCallback(() => {
    if (!composition) return;
    setShowSaveConfirm(true);
  }, [composition]);

  const confirmSave = useCallback(async () => {
    setShowSaveConfirm(false);
    await performSave(false); // Not silent - show dialogs
  }, [performSave]);

  // Listen for auto-save events from AI generation
  useEffect(() => {
    const handleAutoSave = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.compositionId === composition?.id) {
        console.log("[Auto-save] Triggered for:", composition?.id);
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

  // ── Early returns after all hooks ──────────────────────────────────────────

  // If this is a new composition, render the new composition view
  if (isNew) {
    return <NewComposition isGenerating={isGenerating} />;
  }

  // If no composition selected yet, return null
  if (!composition) return null;

  // Merge live track state into the props passed to the Remotion player.
  const compositionWithProps = {
    ...composition,
    defaultProps: {
      ...currentProps,
      tracks,
    },
  };

  return (
    <div className="flex flex-col items-center p-2 sm:p-4 lg:p-6 min-w-0 bg-background">
      <div className="w-full max-w-5xl flex flex-col gap-0">
        {/* Composition info */}
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-foreground/90">
              {composition.title}
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 max-w-lg leading-relaxed line-clamp-2 sm:line-clamp-none">
              {composition.description}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <CollabPresenceBar
              activeUsers={activeUsers}
              agentActive={agentActive}
              agentPresent={agentPresent}
            />
            <ShareButton
              resourceType="composition"
              resourceId={composition.id}
              resourceTitle={composition.title}
            />
          </div>
        </div>

        {/* Camera toolbar with composition details */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
          <div className="overflow-x-auto -mx-2 px-2 sm:mx-0 sm:px-0">
            <CameraToolbar
              currentFrame={currentFrameLocal}
              fps={composition.fps}
              tracks={tracks}
              onUpdateTrack={onUpdateTrack}
              onAddTrack={onAddTrack}
              durationInFrames={composition.durationInFrames}
              videoContainerRef={videoContainerRef}
            />
          </div>

          {/* Composition details */}
          <div className="flex items-center gap-1.5 sm:ml-auto flex-shrink-0 flex-wrap">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onCompSettingsClick}
                  className="text-[10px] px-2 py-1 rounded-md bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/50 hover:border-border font-mono cursor-pointer"
                >
                  {composition.width}x{composition.height}
                </button>
              </TooltipTrigger>
              <TooltipContent>Click to edit output size</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onCompSettingsClick}
                  className="text-[10px] px-2 py-1 rounded-md bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/50 hover:border-border font-mono cursor-pointer"
                >
                  {composition.fps}fps
                </button>
              </TooltipTrigger>
              <TooltipContent>Click to edit frame rate</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onCompSettingsClick}
                  className="text-[10px] px-2 py-1 rounded-md bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/50 hover:border-border font-mono cursor-pointer"
                >
                  {(composition.durationInFrames / composition.fps).toFixed(1)}s
                </button>
              </TooltipTrigger>
              <TooltipContent>Click to edit duration</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setTweaksVisible((v) => !v)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer",
                    tweaksVisible
                      ? "bg-primary/10 text-primary border border-primary/30"
                      : "bg-secondary/50 hover:bg-secondary text-muted-foreground border border-border/50",
                  )}
                >
                  <IconAdjustments className="w-3.5 h-3.5" />
                  Tweaks
                </button>
              </TooltipTrigger>
              <TooltipContent>Toggle tweaks panel</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleSaveAsDefault}
                  disabled={!canSave}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium",
                    !canSave
                      ? "bg-secondary/30 text-muted-foreground/40 border border-border/30 cursor-not-allowed"
                      : hasUnsavedChanges
                        ? "bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30"
                        : "bg-secondary/50 hover:bg-secondary text-muted-foreground border border-border/50",
                  )}
                >
                  <IconDeviceFloppy className="w-3.5 h-3.5" />
                  Save
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {!canSave
                  ? "Save to registry requires local development mode"
                  : hasUnsavedChanges
                    ? "Save current settings as default for this composition"
                    : composition.storage === "database"
                      ? "All changes saved to database"
                      : "All changes saved to registry"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20"
                >
                  <IconTrash className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Delete composition</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Video player with cursor positioning overlay + tweaks panel */}
        <div ref={videoContainerRef} style={{ position: "relative" }}>
          <TweaksPanel
            tweaks={DEFAULT_COMPOSITION_TWEAKS}
            values={tweakValues}
            onChange={handleTweakChange}
            visible={tweaksVisible}
          />
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

      {/* Save confirmation dialog */}
      <AlertDialog open={showSaveConfirm} onOpenChange={setShowSaveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save composition</AlertDialogTitle>
            <AlertDialogDescription>
              Save current settings as defaults for "{composition.title}"? This
              will update its tracks, animations, properties, and composition
              settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSave}>Save</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save success dialog */}
      <AlertDialog
        open={showSaveSuccess}
        onOpenChange={(open) => {
          setShowSaveSuccess(open);
          if (!open) window.location.reload();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Saved</AlertDialogTitle>
            <AlertDialogDescription>
              Saved "{composition.title}". The page will reload to pick up the
              changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => window.location.reload()}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save error dialog */}
      <AlertDialog open={showSaveError} onOpenChange={setShowSaveError}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save failed</AlertDialogTitle>
            <AlertDialogDescription>
              Failed to save to registry: {saveErrorMessage}
              {"\n\n"}This usually means the dev server needs to be restarted or
              the API endpoint is not available. Your changes are still saved in
              browser storage and will persist until you reload.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* TODO: Fix Pinpoint React is not defined error
      <Pinpoint
        author={session?.email || "anonymous"}
        colorScheme="dark"
        compactPopup
      />
      */}

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{composition.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                // Await the delete so the dialog stays open if it fails
                // (handleDelete bails out silently on error). On success,
                // navigate() inside handleDelete will unmount this view.
                await onDelete(composition.id);
                setShowDeleteConfirm(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
