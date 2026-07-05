import { useActionMutation, useT } from "@agent-native/core/client";
import {
  IconArrowBackUp,
  IconChevronDown,
  IconCut,
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
} from "@tabler/icons-react";
import { useState } from "react";
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
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { PLAYBACK_SPEED_OPTIONS } from "@/lib/playback-speed";
import {
  effectiveDuration,
  formatMs,
  type EditsJson,
} from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";

const MIN_TIMELINE_ZOOM = 1;
const MAX_TIMELINE_ZOOM = 50;

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
  edits: EditsJson;
  /** Current selection (original ms) — used by "Trim selection". */
  selectionRange?: { startMs: number; endMs: number } | null;
  video: {
    videoUrl: string | null;
    videoFormat?: "webm" | "mp4";
    title?: string;
  };
  onOpenThumbnailPicker: () => void;
  onOpenChapters: () => void;
  onOpenStitch: () => void;
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
  edits,
  selectionRange,
  video,
  onOpenThumbnailPicker,
  onOpenChapters,
  onOpenStitch,
  chaptersOpen,
}: EditorToolbarProps) {
  const t = useT();
  const undo = useActionMutation("undo-edit");
  const clear = useActionMutation("clear-edits");
  const trim = useActionMutation("trim-recording");
  const split = useActionMutation("split-recording");

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(
    null,
  );
  const [longWarnOpen, setLongWarnOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  const effectiveMs = effectiveDuration(durationMs, edits);

  const handleUndo = async () => {
    try {
      const r = await undo.mutateAsync({ recordingId });
      if (!r?.undone) toast.info(t("editorToolbar.nothingToUndo"));
    } catch (err: any) {
      toast.error(err?.message ?? t("editorToolbar.undoFailed"));
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
    try {
      await trim.mutateAsync({
        recordingId,
        startMs: Math.round(selectionRange.startMs),
        endMs: Math.round(selectionRange.endMs),
      });
      toast.success(t("editorToolbar.selectionCut"));
    } catch (err: any) {
      toast.error(err?.message ?? t("editorToolbar.trimFailed"));
    }
  };

  const handleTrimStart = async () => {
    const endMs = Math.round(playheadMs);
    if (endMs < 500) {
      toast.info(t("editorToolbar.movePlayheadPastIntro"));
      return;
    }
    try {
      await trim.mutateAsync({
        recordingId,
        startMs: 0,
        endMs,
      });
      toast.success(t("editorToolbar.startCut"));
    } catch (err: any) {
      toast.error(err?.message ?? t("editorToolbar.trimFailed"));
    }
  };

  const handleTrimEnd = async () => {
    const startMs = Math.round(playheadMs);
    if (durationMs - startMs < 500) {
      toast.info(t("editorToolbar.movePlayheadBeforeEnding"));
      return;
    }
    try {
      await trim.mutateAsync({
        recordingId,
        startMs,
        endMs: Math.round(durationMs),
      });
      toast.success(t("editorToolbar.endCut"));
    } catch (err: any) {
      toast.error(err?.message ?? t("editorToolbar.trimFailed"));
    }
  };

  const handleSplit = async () => {
    try {
      await split.mutateAsync({
        recordingId,
        atMs: Math.round(playheadMs),
      });
      toast.success(t("editorToolbar.splitAdded"));
    } catch (err: any) {
      toast.error(err?.message ?? t("editorToolbar.splitFailed"));
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
    if (effectiveMs > LONG_EXPORT_THRESHOLD_MS) {
      setLongWarnOpen(true);
      return;
    }
    runExport();
  };

  const handleDownloadOriginal = () => {
    if (!video.videoUrl) return;
    const a = document.createElement("a");
    a.href = video.videoUrl;
    a.download = `${(video.title ?? recordingId).replace(/[^a-z0-9-_]+/gi, "-")}.${video.videoFormat ?? "webm"}`;
    a.click();
  };

  return (
    <div className="flex h-11 min-w-0 items-center gap-1 overflow-hidden border-b border-border bg-card/40 px-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleUndo}
            disabled={undo.isPending}
          >
            <IconArrowBackUp className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("editorToolbar.undoTooltip")}</TooltipContent>
      </Tooltip>
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
        <TooltipContent>{t("editorToolbar.playPauseTooltip")}</TooltipContent>
      </Tooltip>

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
        <DropdownMenuContent align="start" className="min-w-[120px]">
          <DropdownMenuLabel>
            {t("editorToolbar.previewSpeed")}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {PLAYBACK_SPEED_OPTIONS.map((rate) => (
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
              variant={zoom === MIN_TIMELINE_ZOOM ? "secondary" : "ghost"}
              className="h-6 min-w-10 px-1.5 font-mono text-[11px] tabular-nums"
              aria-label={t("editorToolbar.fitToWidth")}
              onClick={() => onZoomChange(MIN_TIMELINE_ZOOM)}
            >
              {formatZoomLabel(zoom)}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("editorToolbar.fitToWidth")}</TooltipContent>
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

      {selectionRange ? (
        <>
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleTrimSelection}
                disabled={trim.isPending}
              >
                <IconScissors className="mr-1 h-4 w-4" />
                {t("editorToolbar.cutSelection")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("editorToolbar.cutSelectedRange")}
            </TooltipContent>
          </Tooltip>
        </>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant={chaptersOpen ? "secondary" : "ghost"}
            className="gap-1.5"
          >
            <IconScissors className="h-4 w-4" />
            {t("editorToolbar.edit")}
            <IconChevronDown className="h-3.5 w-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>
            {t("editorToolbar.playheadEdits")}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={split.isPending} onSelect={handleSplit}>
            <IconCut className="mr-2 h-4 w-4" />
            {t("editorToolbar.splitAtPlayhead")}
            <DropdownMenuShortcut>S</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={trim.isPending || playheadMs < 500}
            onSelect={handleTrimStart}
          >
            <IconScissors className="mr-2 h-4 w-4" />
            {t("editorToolbar.cutBeforePlayhead")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={trim.isPending || durationMs - playheadMs < 500}
            onSelect={handleTrimEnd}
          >
            <IconScissors className="mr-2 h-4 w-4" />
            {t("editorToolbar.cutAfterPlayhead")}
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
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setClearOpen(true)}>
            <IconTrash className="mr-2 h-4 w-4" />
            {t("editorToolbar.clearAllEdits")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="min-w-3 flex-1" />

      <Separator orientation="vertical" className="mx-1 h-6" />

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
                runExport();
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
                handleClear();
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
