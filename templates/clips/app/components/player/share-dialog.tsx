import { useMemo, useState } from "react";
import { ShareDialog } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface ShareRecordingDialogProps {
  recordingId: string;
  recordingTitle?: string;
  videoUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Thin wrapper around the framework `<ShareDialog>` that adds the
 * Clips-specific link-tab extras (GIF preview + MP4 download) and a
 * recording-aware embed configurator (autoplay, start time, responsive /
 * fixed size). The framework owns the core Link / Invite / Embed tab
 * structure — this file only fills in the recording-specific pieces.
 */
export function ShareRecordingDialog({
  recordingId,
  recordingTitle,
  videoUrl,
  animatedThumbnailUrl,
  open,
  onOpenChange,
}: ShareRecordingDialogProps) {
  const shareUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/share/${recordingId}`;
  const embedUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/embed/${recordingId}`;

  return (
    <ShareDialog
      open={open}
      onClose={() => onOpenChange(false)}
      resourceType="recording"
      resourceId={recordingId}
      resourceTitle={recordingTitle}
      shareUrl={shareUrl}
      embedUrl={embedUrl}
      linkTabExtras={
        <LinkTabExtras
          videoUrl={videoUrl}
          animatedThumbnailUrl={animatedThumbnailUrl}
        />
      }
      embedTabContent={<ClipsEmbedConfigurator recordingId={recordingId} />}
    />
  );
}

function LinkTabExtras({
  videoUrl,
  animatedThumbnailUrl,
}: {
  videoUrl?: string | null;
  animatedThumbnailUrl?: string | null;
}) {
  if (!videoUrl && !animatedThumbnailUrl) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {animatedThumbnailUrl ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(animatedThumbnailUrl, "_blank")}
        >
          GIF preview
        </Button>
      ) : null}
      {videoUrl ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(videoUrl, "_blank")}
        >
          Download MP4
        </Button>
      ) : null}
    </div>
  );
}

function ClipsEmbedConfigurator({ recordingId }: { recordingId: string }) {
  const [autoplay, setAutoplay] = useState(false);
  const [startMs, setStartMs] = useState(0);
  const [mode, setMode] = useState<"responsive" | "fixed">("responsive");
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(360);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const src = useMemo(() => {
    const params: string[] = [];
    if (autoplay) params.push("autoplay=1");
    if (startMs > 0) params.push(`t=${Math.round(startMs / 1000)}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    return `${origin}/embed/${recordingId}${qs}`;
  }, [origin, recordingId, autoplay, startMs]);

  const code =
    mode === "responsive"
      ? `<div style="position:relative;padding-bottom:56.25%;height:0"><iframe src="${src}" frameborder="0" allowfullscreen allow="autoplay; picture-in-picture" style="position:absolute;inset:0;width:100%;height:100%"></iframe></div>`
      : `<iframe src="${src}" width="${width}" height="${height}" frameborder="0" allowfullscreen allow="autoplay; picture-in-picture"></iframe>`;

  return (
    <div className="space-y-3">
      <div className="flex gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={mode === "responsive"}
            onChange={() => setMode("responsive")}
          />
          Responsive (16:9)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={mode === "fixed"}
            onChange={() => setMode("fixed")}
          />
          Fixed size
        </label>
      </div>

      {mode === "fixed" ? (
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs">Width</Label>
            <Input
              type="number"
              value={width}
              onChange={(e) => setWidth(parseInt(e.target.value) || 640)}
            />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Height</Label>
            <Input
              type="number"
              value={height}
              onChange={(e) => setHeight(parseInt(e.target.value) || 360)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <Label className="text-sm">Autoplay</Label>
        <Switch checked={autoplay} onCheckedChange={setAutoplay} />
      </div>

      <div>
        <Label className="text-xs">Start at (seconds)</Label>
        <Input
          type="number"
          min={0}
          value={Math.round(startMs / 1000)}
          onChange={(e) => setStartMs((parseInt(e.target.value) || 0) * 1000)}
        />
      </div>

      <div>
        <Label className="text-xs mb-1 block">Embed code</Label>
        <textarea
          readOnly
          value={code}
          className="w-full h-20 px-3 py-2 text-xs font-mono rounded-md border border-input bg-background resize-none"
        />
      </div>
    </div>
  );
}
