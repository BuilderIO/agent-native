import {
  appBasePath,
  callAction,
  useDevMode,
  ShareButton,
  useSession,
  useT,
} from "@agent-native/core/client";
import type { CollabUser } from "@agent-native/core/client";
import {
  IconDeviceFloppy,
  IconTrash,
  IconAdjustments,
} from "@tabler/icons-react";
import { useRef, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router";

import { CameraToolbar } from "@/components/CameraToolbar";
import { CollabPresenceBar } from "@/components/CollabPresenceBar";
import { CursorPositioningOverlay } from "@/components/CursorPositioningOverlay";
import { Timeline } from "@/components/Timeline";
import {
  TweaksPanel,
  DEFAULT_COMPOSITION_TWEAKS,
} from "@/components/TweaksPanel";
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
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";
import { useComposition } from "@/contexts/CompositionContext";
import { usePlayback } from "@/contexts/PlaybackContext";
import { useTimeline } from "@/contexts/TimelineContext";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { cn } from "@/lib/utils";
import NewComposition from "@/pages/NewComposition";

type CompositionViewProps = {
  onCameraKeyframeClick?: (trackType: "camera" | "cursor") => void;
  onCompSettingsClick?: () => void;
  isGenerating?: boolean;
  activeUsers?: CollabUser[];
  agentActive?: boolean;
  agentPresent?: boolean;
};

function rejectOnAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  message: string,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new Error(message));
  }

  return new Promise((resolve, reject) => {
    const handleAbort = () => reject(new Error(message));
    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", handleAbort);
    });
  });
}

export default function CompositionView({
  onCameraKeyframeClick,
  onCompSettingsClick,
  isGenerating = false,
  activeUsers = [],
  agentActive = false,
  agentPresent = false,
}: CompositionViewProps) {
  const t = useT();
  // Get frame from URL parameter (?frame=150)
  const [searchParams] = useSearchParams();
  const frameFromUrl = searchParams.get("frame");
  const initialFrame = frameFromUrl ? parseInt(frameFromUrl, 10) : 0;

  const { isDevMode } = useDevMode();
  useSession();

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

        const saveToDatabase = async (signal: AbortSignal) => {
          const result = (await rejectOnAbort(
            callAction("update-composition", {
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
            signal,
            t("editor.composition.requestTimedOut"),
          )) as {
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
            throw new Error(
              t("editor.composition.serverError", {
                status: response.status,
                message: errorText,
              }),
            );
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
              <TooltipContent>
                {t("editor.composition.editOutputSize")}
              </TooltipContent>
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
              <TooltipContent>
                {t("editor.composition.editFrameRate")}
              </TooltipContent>
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
              <TooltipContent>
                {t("editor.composition.editDuration")}
              </TooltipContent>
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
                  {t("editor.tweaks.title")}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("editor.tweaks.togglePanel")}</TooltipContent>
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
                  {t("editor.composition.save")}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {!canSave
                  ? t("editor.composition.saveRequiresLocalDev")
                  : hasUnsavedChanges
                    ? t("editor.composition.saveCurrentAsDefault")
                    : composition.storage === "database"
                      ? t("editor.composition.allChangesSavedDatabase")
                      : t("editor.composition.allChangesSavedRegistry")}
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
              <TooltipContent>
                {t("editor.composition.deleteComposition")}
              </TooltipContent>
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
            onClose={() => setTweaksVisible(false)}
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
            <AlertDialogTitle>
              {t("editor.composition.saveComposition")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("editor.composition.saveCompositionDescription", {
                title: composition.title,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("editor.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSave}>
              {t("editor.composition.save")}
            </AlertDialogAction>
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
            <AlertDialogTitle>{t("editor.composition.saved")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("editor.composition.savedDescription", {
                title: composition.title,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => window.location.reload()}>
              {t("editor.common.ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save error dialog */}
      <AlertDialog open={showSaveError} onOpenChange={setShowSaveError}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("editor.composition.saveFailed")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("editor.composition.saveFailedDescription", {
                message: saveErrorMessage,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>{t("editor.common.ok")}</AlertDialogAction>
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
            <AlertDialogTitle>
              {t("editor.composition.deleteCompositionTitle", {
                title: composition.title,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("editor.composition.deleteCompositionDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("editor.common.cancel")}</AlertDialogCancel>
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
              {t("editor.composition.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
