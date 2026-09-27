import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCut,
  IconEyeOff,
  IconFlame,
  IconGauge,
  IconZoomIn,
  IconZoomOut,
  IconPlayerPlay,
  IconPlayerPause,
  IconScissors,
  IconPhotoEdit,
  IconBookmarks,
  IconPuzzle,
  IconDownload,
  IconLoader2,
  IconTrash,
  IconHistory,
} from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  exportMp4,
  LONG_EXPORT_THRESHOLD_MS,
  type ExportProgress,
} from "@/lib/ffmpeg-export";
import {
  PLAYBACK_SPEED_OPTIONS,
  SLOW_PLAYBACK_SPEED_OPTIONS,
} from "@/lib/playback-speed";
import {
  effectiveDuration,
  formatMs,
  type EditsJson,
} from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";

const MIN_TIMELINE_ZOOM = 1;
const MAX_TIMELINE_ZOOM = 50;

const LABEL_WHEN_ROOMY = "hidden @min-[900px]/bar:inline";

const CONTENT_SCROLL =
  "max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto";

export interface EditorToolbarProps {
  recordingId: string;
  playheadMs: number;
  durationMs: number;
  playing: boolean;
  onPlayPause: () => void;
  playbackSpeed: number;
  onPlaybackSpeedChange: (speed: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  timelineActive?: boolean;
  edits: EditsJson;
  selectionRange?: { startMs: number; endMs: number } | null;
  onCutRange: (range: { startMs: number; endMs: number }) => Promise<boolean>;
  onSplit: () => Promise<boolean>;
  redactMode?: boolean;
  onToggleRedact?: () => void;
  pendingRedactions?: number;
  onBurnRedactions?: () => Promise<void>;
  burningRedactions?: boolean;
  burnPercent?: number;
  onUndo: () => void;
  onRedo: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  video: {
    videoUrl: string | null;
    videoFormat?: "webm" | "mp4";
    title?: string;
  };
  onOpenThumbnailPicker: () => void;
  onOpenChapters: () => void;
  onOpenStitch: () => void;
  onOpenRewind: () => void;
  rewindAlreadyAdded?: boolean;
  rewindAvailable?: boolean;
  rewindRequiresPrivate?: boolean;
  chaptersOpen?: boolean;
}

export function EditorToolbar({
  recordingId,
  playheadMs,
  durationMs,
  playing,
  onPlayPause,
  playbackSpeed,
  onPlaybackSpeedChange,
  zoom,
  onZoomChange,
  timelineActive = false,
  edits,
  selectionRange,
  onCutRange,
  onSplit,
  redactMode = false,
  onToggleRedact,
  pendingRedactions = 0,
  onBurnRedactions,
  burningRedactions = false,
  burnPercent = 0,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  video,
  onOpenThumbnailPicker,
  onOpenChapters,
  onOpenStitch,
  onOpenRewind,
  rewindAlreadyAdded,
  rewindAvailable = true,
  rewindRequiresPrivate = false,
  chaptersOpen,
}: EditorToolbarProps) {
  const t = useT();
  const clear = useActionMutation("clear-edits");
  const [busy, setBusy] = useState(false);

  const stripRef = useRef<HTMLDivElement | null>(null);
  const [moreAt, setMoreAt] = useState({ start: false, end: false });

  const scrollStrip = (direction: 1 | -1) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({
      left: direction * Math.max(120, el.clientWidth * 0.8),
      behavior: "smooth",
    });
  };

  const readEdges = () => {
    const el = stripRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setMoreAt({ start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 }); // i18n-ignore — comparisons, not copy
  };

  useLayoutEffect(readEdges, [
    burningRedactions,
    pendingRedactions,
    redactMode,
    selectionRange,
    timelineActive,
    t,
  ]);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    el.addEventListener("scroll", readEdges, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(readEdges);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", readEdges);
      observer?.disconnect();
    };
  }, []);

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(
    null,
  );
  const [longWarnOpen, setLongWarnOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [burnOpen, setBurnOpen] = useState(false);
  const [exportUnredactedOpen, setExportUnredactedOpen] = useState(false);

  const effectiveMs = effectiveDuration(durationMs, edits);

  const runEdit = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    try {
      await clear.mutateAsync({ recordingId });
      toast.success(t("editorToolbar.editsCleared"));
    } catch (err: any) {
      toast.error(err?.message ?? t("editorToolbar.clearFailed"));
    }
  };

  const handleTrimSelection = async () => {
    if (!selectionRange) {
      toast.info(t("editorToolbar.selectRangeFirst"));
      return;
    }
    if (await runEdit(() => onCutRange(selectionRange))) {
      toast.success(t("editorToolbar.selectionCut"));
    }
  };

  const handleTrimStart = async () => {
    const endMs = Math.round(playheadMs);
    if (endMs < 500) {
      toast.info(t("editorToolbar.movePlayheadPastIntro"));
      return;
    }
    if (await runEdit(() => onCutRange({ startMs: 0, endMs }))) {
      toast.success(t("editorToolbar.startCut"));
    }
  };

  const handleTrimEnd = async () => {
    const startMs = Math.round(playheadMs);
    if (durationMs - startMs < 500) {
      toast.info(t("editorToolbar.movePlayheadBeforeEnding"));
      return;
    }
    if (
      await runEdit(() =>
        onCutRange({ startMs, endMs: Math.round(durationMs) }),
      )
    ) {
      toast.success(t("editorToolbar.endCut"));
    }
  };

  const handleSplit = async () => {
    if (await runEdit(onSplit)) {
      toast.success(t("editorToolbar.splitAdded"));
    }
  };

  const runExport = async () => {
    if (!video.videoUrl) {
      toast.error(t("editorToolbar.videoNotReady"));
      return;
    }
    setExporting(true);
    setExportProgress({ progress: 0, stage: "loading-ffmpeg" });
    try {
      const result = await exportMp4(
        {
          id: recordingId,
          videoUrl: video.videoUrl,
          durationMs,
          videoFormat: video.videoFormat,
          title: video.title,
        },
        edits,
        (p) => setExportProgress(p),
      );
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(t("editorToolbar.exportedMp4"));
    } catch (err: any) {
      console.error(err);
      toast.error(t("editorToolbar.exportFailed"));
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  };

  const handleExportClick = () => {
    if (pendingRedactions > 0) {
      setExportUnredactedOpen(true);
      return;
    }
    if (effectiveMs > LONG_EXPORT_THRESHOLD_MS) {
      setLongWarnOpen(true);
      return;
    }
    void runExport();
  };

  const handleDownloadOriginal = () => {
    if (!video.videoUrl) return;
    if (pendingRedactions > 0) {
      setExportUnredactedOpen(true);
      return;
    }
    const a = document.createElement("a");
    a.href = video.videoUrl;
    a.download = `${(video.title ?? recordingId).replace(/[^a-z0-9-_]+/gi, "-")}.${video.videoFormat ?? "webm"}`;
    a.click();
  };

  return (
    <div className="flex h-11 min-w-0 items-center gap-1 border-b border-border bg-card/40 px-2">
      {/*
        Everything but Export lives in this strip, and the strip scrolls.
        A fade alone was not obvious enough — on a Mac the scrollbar is hidden
        until something is already scrolling, so a shaded edge reads as styling
        rather than as "there is more this way". So each end with more behind it
        gets a button: something to notice, and something to press. The fade
        stays underneath it, `pointer-events-none`, purely so controls do not
        appear to be sliced off mid-label.
      */}
      <div className="@container/bar relative flex min-w-0 flex-1 items-center">
        {moreAt.start ? (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 start-0 z-10 w-10 bg-gradient-to-r from-card via-card/80 to-transparent"
            />
            <button
              type="button"
              aria-label={t("editorToolbar.scrollBack")}
              title={t("editorToolbar.scrollBack")}
              onClick={() => scrollStrip(-1)}
              className="absolute start-0 z-20 inline-flex size-6 items-center justify-center rounded-full border border-border bg-background/95 text-muted-foreground shadow-sm hover:text-foreground"
            >
              <IconChevronLeft className="size-4" aria-hidden="true" />
            </button>
          </>
        ) : null}
        {moreAt.end ? (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 end-0 z-10 w-10 bg-gradient-to-l from-card via-card/80 to-transparent"
            />
            <button
              type="button"
              aria-label={t("editorToolbar.scrollOn")}
              title={t("editorToolbar.scrollOn")}
              onClick={() => scrollStrip(1)}
              className="absolute end-0 z-20 inline-flex size-6 items-center justify-center rounded-full border border-border bg-background/95 text-muted-foreground shadow-sm hover:text-foreground"
            >
              <IconChevronRight className="size-4" aria-hidden="true" />
            </button>
          </>
        ) : null}
        <div
          ref={stripRef}
          className={cn(
            "clips-toolbar-strip flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden py-0.5",
            moreAt.start && "ps-7",
            moreAt.end && "pe-7",
          )}
        >
          <div className="min-w-fit px-2 font-mono text-xs text-muted-foreground">
            {formatMs(playheadMs)} / {formatMs(effectiveMs)}
            {durationMs !== effectiveMs && (
              <span className="hidden opacity-60 lg:inline">
                {" "}
                {t("editorToolbar.sourceDuration", {
                  duration: formatMs(durationMs),
                })}
              </span>
            )}
          </div>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 shrink-0 gap-1.5 px-2 font-mono text-xs tabular-nums"
                    aria-label={t("editorToolbar.previewSpeed")}
                  >
                    <IconGauge className="h-4 w-4" />
                    {formatSpeedLabel(playbackSpeed)}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {t("editorToolbar.previewSpeedTooltip")}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              align="start"
              collisionPadding={8}
              className={cn("min-w-[120px]", CONTENT_SCROLL)}
            >
              <DropdownMenuLabel>
                {t("editorToolbar.previewSpeed")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {/*
                The crawling speeds only appear while redacting: they are for
                checking a box against a moving picture, and they would be noise
                in the list the rest of the time.
              */}
              {(redactMode
                ? [...SLOW_PLAYBACK_SPEED_OPTIONS, ...PLAYBACK_SPEED_OPTIONS]
                : PLAYBACK_SPEED_OPTIONS
              ).map((rate) => (
                <DropdownMenuItem
                  key={rate}
                  onSelect={() => onPlaybackSpeedChange(rate)}
                  className={cn(
                    "font-mono tabular-nums",
                    rate === playbackSpeed && "bg-accent font-semibold",
                  )}
                >
                  {formatSpeedLabel(rate)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {timelineActive ? (
            <>
              <Separator orientation="vertical" className="mx-1 h-6" />
              <div
                className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-background/70 px-1"
                aria-label={t("editorToolbar.zoom")}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      aria-label={t("editorToolbar.zoomOut")}
                      disabled={zoom <= MIN_TIMELINE_ZOOM}
                      onClick={() =>
                        onZoomChange(Math.max(MIN_TIMELINE_ZOOM, zoom - 1))
                      }
                    >
                      <IconZoomOut className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("editorToolbar.zoomOut")}</TooltipContent>
                </Tooltip>

                <Slider
                  value={[zoom]}
                  min={MIN_TIMELINE_ZOOM}
                  max={MAX_TIMELINE_ZOOM}
                  step={0.1}
                  aria-label={t("editorToolbar.zoom")}
                  onValueChange={(value) => onZoomChange(value[0] ?? zoom)}
                  className="hidden w-28 lg:flex"
                />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant={
                        zoom === MIN_TIMELINE_ZOOM ? "secondary" : "ghost"
                      }
                      className="h-6 min-w-10 px-1.5 font-mono text-[11px] tabular-nums"
                      aria-label={t("editorToolbar.fitToWidth")}
                      onClick={() => onZoomChange(MIN_TIMELINE_ZOOM)}
                    >
                      {formatZoomLabel(zoom)}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("editorToolbar.fitToWidth")}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      aria-label={t("editorToolbar.zoomIn")}
                      disabled={zoom >= MAX_TIMELINE_ZOOM}
                      onClick={() =>
                        onZoomChange(Math.min(MAX_TIMELINE_ZOOM, zoom + 1))
                      }
                    >
                      <IconZoomIn className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("editorToolbar.zoomIn")}</TooltipContent>
                </Tooltip>
              </div>
            </>
          ) : null}

          {/*
            Transport and history sit between the zoom and the cutting tools: in
            the middle of the bar, where the hands already are.
          */}
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={onPlayPause}
              >
                {playing ? (
                  <IconPlayerPause className="h-4 w-4" />
                ) : (
                  <IconPlayerPlay className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("editorToolbar.playPauseTooltip")}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={onUndo}
                disabled={busy || canUndo === false}
              >
                <IconArrowBackUp className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("editorToolbar.undoTooltip")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={onRedo}
                disabled={busy || canRedo === false}
              >
                <IconArrowForwardUp className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("editorToolbar.redoTooltip")}</TooltipContent>
          </Tooltip>
          {selectionRange ? (
            <>
              <Separator orientation="vertical" className="mx-1 h-6" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleTrimSelection}
                    disabled={busy}
                  >
                    <IconScissors className="h-4 w-4 @min-[900px]/bar:mr-1" />
                    <span className={LABEL_WHEN_ROOMY}>
                      {t("editorToolbar.cutSelection")}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="flex items-center gap-1.5">
                  {t("editorToolbar.cutSelectedRange")}
                  <Kbd className="h-auto min-w-0 px-1 py-0 text-[10px]">
                    {t("editorToolbar.deleteKey")}
                  </Kbd>
                </TooltipContent>
              </Tooltip>
            </>
          ) : null}

          {onToggleRedact ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={redactMode ? "default" : "ghost"}
                  aria-pressed={redactMode}
                  className={cn(
                    redactMode &&
                      // guard:allow-raw-color — black on a fixed amber chip: following the theme here would put light text on it.
                      "bg-amber-500 text-black shadow-sm ring-2 ring-amber-300 hover:bg-amber-500/90",
                  )}
                  onClick={onToggleRedact}
                  disabled={busy}
                >
                  <IconEyeOff className="h-4 w-4 @min-[900px]/bar:mr-1" />
                  <span className={LABEL_WHEN_ROOMY}>
                    {redactMode
                      ? t("editorToolbar.redactOn")
                      : t("editorToolbar.redact")}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("editorToolbar.redactHint")}</TooltipContent>
            </Tooltip>
          ) : null}

          {/*
            The percentage is shown in two places and that is enough: here, on
            the button that started it, and in the toast, which follows the
            user off the toolbar. A third read-out — a bar with its own
            percentage sitting next to a button showing the same number — was
            just the same fact three times, in a bar that is short of room.
          */}
          {(pendingRedactions > 0 || burningRedactions) && onBurnRedactions ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setBurnOpen(true)}
                  disabled={busy || burningRedactions}
                >
                  {burningRedactions ? (
                    <IconLoader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <IconFlame className="mr-1 h-4 w-4" />
                  )}
                  {burningRedactions
                    ? burnPercent > 0
                      ? t("editorToolbar.burningPercent", {
                          percent: burnPercent,
                        })
                      : t("editorToolbar.burning")
                    : t("editorToolbar.burnIn", { count: pendingRedactions })}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("editorToolbar.burnInHint")}</TooltipContent>
            </Tooltip>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant={chaptersOpen ? "secondary" : "ghost"}
                className="shrink-0 gap-1.5"
              >
                <IconScissors className="h-4 w-4" />
                <span className={LABEL_WHEN_ROOMY}>
                  {t("editorToolbar.edit")}
                </span>
                <IconChevronDown className="h-3.5 w-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            {/*
              Capped to the room Radix says it has, and scrollable inside that. The
              toolkit's menu is `overflow-hidden` with no height limit of its own,
              so a menu taller than the space above it opens upwards with its first
              items off the top of the screen and no way to reach them.
            */}
            <DropdownMenuContent
              align="start"
              collisionPadding={8}
              className={cn("w-64", CONTENT_SCROLL)}
            >
              <DropdownMenuLabel>
                {t("editorToolbar.playheadEdits")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={busy} onSelect={handleSplit}>
                <IconCut className="mr-2 h-4 w-4" />
                {t("editorToolbar.splitAtPlayhead")}
                <Kbd className="ms-auto h-auto min-w-0 px-1 py-0 text-[10px]">
                  S
                </Kbd>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy || playheadMs < 500}
                onSelect={handleTrimStart}
              >
                <IconScissors className="mr-2 h-4 w-4" />
                {t("editorToolbar.cutBeforePlayhead")}
                <Kbd className="ms-auto h-auto min-w-0 px-1 py-0 text-[10px]">
                  B
                </Kbd>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy || durationMs - playheadMs < 500}
                onSelect={handleTrimEnd}
              >
                <IconScissors className="mr-2 h-4 w-4" />
                {t("editorToolbar.cutAfterPlayhead")}
                <Kbd className="ms-auto h-auto min-w-0 px-1 py-0 text-[10px]">
                  A
                </Kbd>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("editorToolbar.panels")}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={onOpenChapters}>
                <IconBookmarks className="mr-2 h-4 w-4" />
                {chaptersOpen
                  ? t("editorToolbar.hideChapters")
                  : t("editorToolbar.showChapters")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onOpenThumbnailPicker}>
                <IconPhotoEdit className="mr-2 h-4 w-4" />
                {t("editorToolbar.thumbnail")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onOpenStitch}>
                <IconPuzzle className="mr-2 h-4 w-4" />
                {t("editorToolbar.stitchClips")}
              </DropdownMenuItem>
              {rewindAvailable ? (
                <DropdownMenuItem
                  disabled={rewindAlreadyAdded}
                  onSelect={onOpenRewind}
                >
                  <IconHistory className="mr-2 h-4 w-4" />
                  {rewindAlreadyAdded
                    ? "Rewind history added"
                    : rewindRequiresPrivate
                      ? "Make private and add Rewind history…"
                      : "Add what happened before…"}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setTimeout(() => setClearOpen(true), 0)}
              >
                <IconTrash className="mr-2 h-4 w-4" />
                {t("editorToolbar.clearAllEdits")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Separator orientation="vertical" className="mx-1 h-6 shrink-0" />

      <Button
        size="sm"
        className="shrink-0"
        onClick={handleExportClick}
        disabled={exporting || !video.videoUrl}
      >
        {exporting ? (
          <IconLoader2 className="w-4 h-4 mr-1 animate-spin" />
        ) : (
          <IconDownload className="w-4 h-4 mr-1" />
        )}
        {exporting
          ? exportProgress?.stage === "loading-ffmpeg"
            ? t("editorToolbar.loadingFfmpeg")
            : `${Math.round((exportProgress?.progress ?? 0) * 100)}%`
          : t("editorToolbar.exportMp4")}
      </Button>

      <AlertDialog
        open={exportUnredactedOpen}
        onOpenChange={setExportUnredactedOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-amber-600 dark:text-amber-400">
              {t("editorToolbar.exportUnredactedTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-amber-700/90 dark:text-amber-300/90">
              {t("editorToolbar.exportUnredactedWarning", {
                count: pendingRedactions,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("editorToolbar.backToEditing")}
            </AlertDialogCancel>
            {/*
              No "export anyway": the file it would render from still shows
              everything under the boxes, so this is the same refusal the
              share controls give, for the same reason.
            */}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={burnOpen} onOpenChange={setBurnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("editorToolbar.burnInTitle", { count: pendingRedactions })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("editorToolbar.burnInWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setBurnOpen(false);
                void onBurnRedactions?.();
              }}
            >
              {t("editorToolbar.burnInConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={longWarnOpen} onOpenChange={setLongWarnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("editorToolbar.longExportTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("editorToolbar.longExportDescription", {
                duration: formatMs(effectiveMs),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button
              variant="secondary"
              onClick={() => {
                setLongWarnOpen(false);
                handleDownloadOriginal();
              }}
            >
              {t("editorToolbar.downloadOriginal")}
            </Button>
            <AlertDialogAction
              onClick={() => {
                setLongWarnOpen(false);
                void runExport();
              }}
            >
              {t("editorToolbar.exportAnyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("editorToolbar.clearAllEditsTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("editorToolbar.clearAllEditsDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setClearOpen(false);
                void handleClear();
              }}
            >
              {t("editorToolbar.clearEdits")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatSpeedLabel(rate: number): string {
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}x`;
}

function formatZoomLabel(zoom: number): string {
  return `${Number.isInteger(zoom) ? zoom : zoom.toFixed(1)}x`;
}
