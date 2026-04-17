import { useState } from "react";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
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
import { SplitButton } from "./split-button";

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
}: EditorToolbarProps) {
  const undo = useActionMutation("undo-edit" as any);
  const clear = useActionMutation("clear-edits" as any);
  const trim = useActionMutation("trim-recording" as any);

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
      toast.success("Selection trimmed");
    } catch (err: any) {
      toast.error(err?.message ?? "Trim failed");
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
    <div className="flex items-center gap-1 px-2 h-11 border-b border-border bg-card/40">
      <Button
        size="sm"
        variant="ghost"
        onClick={handleUndo}
        disabled={undo.isPending}
        title="Undo (Cmd/Ctrl+Z)"
      >
        <IconArrowBackUp className="w-4 h-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled
        title="Redo (not supported — there is no redo stack)"
      >
        <IconArrowForwardUp className="w-4 h-4 opacity-40" />
      </Button>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <Button
        size="sm"
        variant="ghost"
        onClick={onPlayPause}
        title="Play / Pause (Space)"
      >
        {playing ? (
          <IconPlayerPause className="w-4 h-4" />
        ) : (
          <IconPlayerPlay className="w-4 h-4" />
        )}
      </Button>

      <div className="text-xs font-mono text-muted-foreground px-2">
        {formatMs(playheadMs)} / {formatMs(effectiveMs)}
        {durationMs !== effectiveMs && (
          <span className="opacity-60"> ({formatMs(durationMs)} src)</span>
        )}
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <SplitButton recordingId={recordingId} playheadMs={playheadMs} />
      <Button
        size="sm"
        variant="ghost"
        onClick={handleTrimSelection}
        disabled={!selectionRange || trim.isPending}
        title="Trim selection"
      >
        <IconScissors className="w-4 h-4 mr-1" />
        Trim
      </Button>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <Button
        size="sm"
        variant="ghost"
        onClick={onOpenThumbnailPicker}
        title="Edit thumbnail"
      >
        <IconPhotoEdit className="w-4 h-4 mr-1" />
        Thumbnail
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onOpenChapters}
        title="Chapters"
      >
        <IconBookmarks className="w-4 h-4 mr-1" />
        Chapters
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onOpenStitch}
        title="Stitch recordings"
      >
        <IconPuzzle className="w-4 h-4 mr-1" />
        Stitch
      </Button>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <Button
        size="sm"
        variant="ghost"
        onClick={() => setClearOpen(true)}
        title="Clear all edits"
      >
        <IconTrash className="w-4 h-4" />
      </Button>

      <div className="flex-1" />

      {/* Zoom slider */}
      <div className="flex items-center gap-1.5 w-40">
        <IconZoomOut className="w-3.5 h-3.5 text-muted-foreground" />
        <Slider
          min={1}
          max={50}
          step={1}
          value={[zoom]}
          onValueChange={([v]) => onZoomChange(v)}
        />
        <IconZoomIn className="w-3.5 h-3.5 text-muted-foreground" />
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <Button
        size="sm"
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
          : "Download MP4"}
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
