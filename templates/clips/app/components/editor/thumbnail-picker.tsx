import { useEffect, useRef, useState } from "react";
import {
  IconPhoto,
  IconPhotoEdit,
  IconUpload,
  IconLoader2,
} from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useActionMutation } from "@agent-native/core/client";
import { exportGif, blobToDataUrl } from "@/lib/ffmpeg-export";
import { formatMs } from "@/lib/timestamp-mapping";

export interface ThumbnailPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordingId: string;
  videoUrl: string | null;
  videoFormat?: "webm" | "mp4";
  durationMs: number;
  currentThumbnailUrl?: string | null;
  currentAnimatedUrl?: string | null;
}

type Tab = "upload" | "frame" | "gif";

export function ThumbnailPicker({
  open,
  onOpenChange,
  recordingId,
  videoUrl,
  videoFormat = "webm",
  durationMs,
  currentThumbnailUrl,
}: ThumbnailPickerProps) {
  const [tab, setTab] = useState<Tab>("frame");
  const [frameTime, setFrameTime] = useState(0);
  const [gifStart, setGifStart] = useState(0);
  const [gifDuration, setGifDuration] = useState(3000);
  const [uploadDataUrl, setUploadDataUrl] = useState<string | null>(null);
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [gifProgress, setGifProgress] = useState<number | null>(null);
  const [gifDataUrl, setGifDataUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const mutation = useActionMutation("set-thumbnail" as any);

  // Clean up object URLs when dialog closes.
  useEffect(() => {
    if (!open) {
      setUploadDataUrl(null);
      setFrameDataUrl(null);
      setGifDataUrl(null);
      setGifProgress(null);
    }
  }, [open]);

  const handleFrameCapture = async () => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    try {
      // Seek to the chosen frame and draw to a canvas.
      await new Promise<void>((resolve, reject) => {
        const onSeek = () => {
          video.removeEventListener("seeked", onSeek);
          resolve();
        };
        video.addEventListener("seeked", onSeek);
        video.currentTime = frameTime / 1000;
        // Safety timeout
        setTimeout(() => reject(new Error("seek timeout")), 5000);
      }).catch(() => {});

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 2d context unavailable");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      setFrameDataUrl(dataUrl);
    } catch (err) {
      console.error(err);
      toast.error("Failed to capture frame");
    }
  };

  const handleGifGenerate = async () => {
    if (!videoUrl) return;
    try {
      setGifProgress(0);
      const blob = await exportGif(
        { id: recordingId, videoUrl, videoFormat, durationMs },
        gifStart,
        gifDuration,
        (p) => setGifProgress(p.progress),
      );
      const dataUrl = await blobToDataUrl(blob);
      setGifDataUrl(dataUrl);
      setGifProgress(null);
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate GIF — try a shorter range");
      setGifProgress(null);
    }
  };

  const handleApply = async () => {
    try {
      if (tab === "upload" && uploadDataUrl) {
        await mutation.mutateAsync({
          recordingId,
          kind: "upload",
          dataUrl: uploadDataUrl,
        } as any);
      } else if (tab === "frame" && frameDataUrl) {
        // First upload the captured frame as the static thumbnail, then also
        // record the frame time reference in editsJson.
        await mutation.mutateAsync({
          recordingId,
          kind: "upload",
          dataUrl: frameDataUrl,
        } as any);
        await mutation.mutateAsync({
          recordingId,
          kind: "frame",
          timeMs: frameTime,
        } as any);
      } else if (tab === "gif" && gifDataUrl) {
        await mutation.mutateAsync({
          recordingId,
          kind: "gif",
          dataUrl: gifDataUrl,
          startMs: gifStart,
          durationMs: gifDuration,
        } as any);
      } else {
        toast.error("Nothing to apply yet");
        return;
      }
      toast.success("Thumbnail updated");
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Failed to update thumbnail");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconPhotoEdit className="w-4 h-4 text-primary" />
            Thumbnail
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upload">
              <IconUpload className="w-4 h-4 mr-1" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="frame">
              <IconPhoto className="w-4 h-4 mr-1" />
              Frame
            </TabsTrigger>
            <TabsTrigger value="gif">Animated GIF</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="py-4 space-y-3">
            <Label>Upload an image</Label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => setUploadDataUrl(reader.result as string);
                reader.readAsDataURL(file);
              }}
              className="text-sm"
            />
            {uploadDataUrl ? (
              <img
                src={uploadDataUrl}
                alt="Uploaded preview"
                className="max-h-60 rounded border border-border"
              />
            ) : currentThumbnailUrl ? (
              <img
                src={currentThumbnailUrl}
                alt="Current thumbnail"
                className="max-h-60 rounded border border-border opacity-60"
              />
            ) : null}
          </TabsContent>

          <TabsContent value="frame" className="py-4 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <video
                  ref={videoRef}
                  src={videoUrl ?? undefined}
                  className="w-full rounded border border-border bg-black"
                  crossOrigin="anonymous"
                  preload="auto"
                  muted
                />
                <div className="mt-2 space-y-1">
                  <Label className="text-xs">
                    Frame at {formatMs(frameTime)}
                  </Label>
                  <Slider
                    min={0}
                    max={Math.max(1000, durationMs)}
                    step={100}
                    value={[frameTime]}
                    onValueChange={([v]) => setFrameTime(v)}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleFrameCapture}
                  >
                    Capture frame
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-xs">Preview</Label>
                {frameDataUrl ? (
                  <img
                    src={frameDataUrl}
                    alt="Captured frame"
                    className="w-full rounded border border-border mt-1"
                  />
                ) : (
                  <div className="w-full aspect-video rounded border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground mt-1">
                    Capture a frame to preview
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="gif" className="py-4 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <video
                  src={videoUrl ?? undefined}
                  className="w-full rounded border border-border bg-black"
                  crossOrigin="anonymous"
                  preload="metadata"
                  muted
                />
                <div className="mt-2 space-y-2">
                  <div>
                    <Label className="text-xs">
                      Start: {formatMs(gifStart)}
                    </Label>
                    <Slider
                      min={0}
                      max={Math.max(0, durationMs - gifDuration)}
                      step={100}
                      value={[gifStart]}
                      onValueChange={([v]) => setGifStart(v)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">
                      Duration: {formatMs(gifDuration)}
                    </Label>
                    <Slider
                      min={500}
                      max={10000}
                      step={100}
                      value={[gifDuration]}
                      onValueChange={([v]) => setGifDuration(v)}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!videoUrl || gifProgress !== null}
                    onClick={handleGifGenerate}
                  >
                    {gifProgress !== null ? (
                      <>
                        <IconLoader2 className="w-4 h-4 mr-1 animate-spin" />
                        {Math.round(gifProgress * 100)}%
                      </>
                    ) : (
                      "Generate GIF"
                    )}
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-xs">Preview</Label>
                {gifDataUrl ? (
                  <img
                    src={gifDataUrl}
                    alt="Animated thumbnail preview"
                    className="w-full rounded border border-border mt-1"
                  />
                ) : (
                  <div className="w-full aspect-video rounded border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground mt-1">
                    Generate a GIF to preview
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={
              mutation.isPending ||
              (tab === "upload" && !uploadDataUrl) ||
              (tab === "frame" && !frameDataUrl) ||
              (tab === "gif" && !gifDataUrl)
            }
          >
            {mutation.isPending && (
              <IconLoader2 className="w-4 h-4 mr-1 animate-spin" />
            )}
            Save thumbnail
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
