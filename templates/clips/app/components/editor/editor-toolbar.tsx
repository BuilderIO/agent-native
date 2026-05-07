import { useState } from "react";
import {
  IconArrowBackUp,
  IconChevronDown,
  IconCut,
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
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useActionMutation } from "@agent-native/core/client";
import { toast } from "sonner";
import {
  exportMp4,
  LONG_EXPORT_THRESHOLD_MS,
  type ExportProgress,
} from "@/lib/ffmpeg-export";
import {
  effectiveDuration,
  formatMs,
  type EditsJson,
} from "@/lib/timestamp-mapping";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface EditorToolbarProps {
  recordingId: string;
  playheadMs: number;
  durationMs: number;
  playing: boolean;
  onPlayPause: () => void;
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
  const undo = useActionMutation("undo-edit" as any);
  const clear = useActionMutation("clear-edits" as any);
  const trim = useActionMutation("trim-recording" as any);
  const split = useActionMutation("split-recording" as any);

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(
    null,
  );
  const [longWarnOpen, setLongWarnOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  const effectiveMs = effectiveDuration(durationMs, edits);

  const handleUndo = async () => {
    try {
      const r = await undo.mutateAsync({ recordingId } as any);
      if (!(r as any)?.undone) toast.info("Nothing to undo");
    } catch (err: any) {
      toast.error(err?.message ?? "Undo failed");
    }
  };

  const handleClear = async () => {
    try {
      await clear.mutateAsync({ recordingId } as any);
      toast.success("Edits cleared");
    } catch (err: any) {
      toast.error(err?.message ?? "Clear failed");
    }
  };

  const handleTrimSelection = async () => {
    if (!selectionRange) {
      toast.info("Select a range on the waveform or transcript first");
      return;
    }
    try {
      await trim.mutateAsync({
        recordingId,
        startMs: Math.round(selectionRange.startMs),
        endMs: Math.round(selectionRange.endMs),
      } as any);
      toast.success("Selection cut");
    } catch (err: any) {
      toast.error(err?.message ?? "Trim failed");
    }
  };

  const handleTrimStart = async () => {
    const endMs = Math.round(playheadMs);
    if (endMs < 500) {
      toast.info("Move the playhead past the intro you want to cut");
      return;
    }
    try {
      await trim.mutateAsync({
        recordingId,
        startMs: 0,
        endMs,
      } as any);
      toast.success("Start cut");
    } catch (err: any) {
      toast.error(err?.message ?? "Trim failed");
    }
  };

  const handleTrimEnd = async () => {
    const startMs = Math.round(playheadMs);
    if (durationMs - startMs < 500) {
      toast.info("Move the playhead before the ending you want to cut");
      return;
    }
    try {
      await trim.mutateAsync({
        recordingId,
        startMs,
        endMs: Math.round(durationMs),
      } as any);
      toast.success("End cut");
    } catch (err: any) {
      toast.error(err?.message ?? "Trim failed");
    }
  };

  const handleSplit = async () => {
    try {
      await split.mutateAsync({
        recordingId,
        atMs: Math.round(playheadMs),
      } as any);
      toast.success("Split added");
    } catch (err: any) {
      toast.error(err?.message ?? "Split failed");
    }
  };

  const runExport = async () => {
    if (!video.videoUrl) {
      toast.error("Video not ready yet");
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
      toast.success("Exported MP4");
    } catch (err: any) {
      console.error(err);
      toast.error(
        "Export failed — ffmpeg.wasm can't always handle long videos. Try shorter edits or use the original file.",
      );
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
        <TooltipContent>Undo (Cmd/Ctrl+Z)</TooltipContent>
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
        <TooltipContent>Play / Pause (Space)</TooltipContent>
      </Tooltip>

      <div className="min-w-fit px-2 font-mono text-xs text-muted-foreground">
        {formatMs(playheadMs)} / {formatMs(effectiveMs)}
        {durationMs !== effectiveMs && (
          <span className="hidden opacity-60 lg:inline">
            {" "}
            ({formatMs(durationMs)} src)
          </span>
        )}
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
                Cut selection
              </Button>
            </TooltipTrigger>
            <TooltipContent>Cut selected range</TooltipContent>
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
            Edit
            <IconChevronDown className="h-3.5 w-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Playhead edits</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={split.isPending} onSelect={handleSplit}>
            <IconCut className="mr-2 h-4 w-4" />
            Split at playhead
            <DropdownMenuShortcut>S</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={trim.isPending || playheadMs < 500}
            onSelect={handleTrimStart}
          >
            <IconScissors className="mr-2 h-4 w-4" />
            Cut before playhead
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={trim.isPending || durationMs - playheadMs < 500}
            onSelect={handleTrimEnd}
          >
            <IconScissors className="mr-2 h-4 w-4" />
            Cut after playhead
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Panels</DropdownMenuLabel>
          <DropdownMenuItem onSelect={onOpenChapters}>
            <IconBookmarks className="mr-2 h-4 w-4" />
            {chaptersOpen ? "Hide chapters" : "Show chapters"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenThumbnailPicker}>
            <IconPhotoEdit className="mr-2 h-4 w-4" />
            Thumbnail
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenStitch}>
            <IconPuzzle className="mr-2 h-4 w-4" />
            Stitch clips
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <IconZoomIn className="mr-2 h-4 w-4" />
              Zoom
              <span className="ml-auto text-xs text-muted-foreground">
                {zoom}x
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              <DropdownMenuItem
                disabled={zoom <= 1}
                onSelect={() => onZoomChange(Math.max(1, zoom - 5))}
              >
                <IconZoomOut className="mr-2 h-4 w-4" />
                Zoom out
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onZoomChange(1)}>
                Fit to width
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={zoom >= 50}
                onSelect={() => onZoomChange(Math.min(50, zoom + 5))}
              >
                <IconZoomIn className="mr-2 h-4 w-4" />
                Zoom in
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setClearOpen(true)}>
            <IconTrash className="mr-2 h-4 w-4" />
            Clear all edits
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
            ? "Loading ffmpeg…"
            : `${Math.round((exportProgress?.progress ?? 0) * 100)}%`
          : "Export MP4"}
      </Button>

      <AlertDialog open={longWarnOpen} onOpenChange={setLongWarnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This export is long</AlertDialogTitle>
            <AlertDialogDescription>
              The edited video is {formatMs(effectiveMs)}. ffmpeg.wasm runs in
              your browser and may run out of memory for very long exports. You
              can try anyway or download the original file instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="secondary"
              onClick={() => {
                setLongWarnOpen(false);
                handleDownloadOriginal();
              }}
            >
              Download original
            </Button>
            <AlertDialogAction
              onClick={() => {
                setLongWarnOpen(false);
                runExport();
              }}
            >
              Export anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all edits?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every trim, blur, and the custom thumbnail from this
              recording. The original video is never modified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setClearOpen(false);
                handleClear();
              }}
            >
              Clear edits
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
