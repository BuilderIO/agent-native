import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IconPlayerPlay, IconPlayerPause } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useActionMutation } from "@agent-native/core/client";
import { formatMs } from "@/lib/timestamp-format";

export interface SnippetDialogProps {
  callId: string;
  mediaUrl?: string | null;
  durationMs: number;
  initialStartMs: number;
  initialEndMs: number;
  initialTitle?: string;
  initialText?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SnippetDialog(props: SnippetDialogProps) {
  const {
    callId,
    mediaUrl,
    durationMs,
    initialStartMs,
    initialEndMs,
    initialTitle,
    initialText,
    open,
    onOpenChange,
  } = props;

  const navigate = useNavigate();
  const [startMs, setStartMs] = useState(initialStartMs);
  const [endMs, setEndMs] = useState(
    Math.min(durationMs, Math.max(initialEndMs, initialStartMs + 3000)),
  );
  const [title, setTitle] = useState(initialTitle ?? "");
  const [description, setDescription] = useState(initialText ?? "");

  useEffect(() => {
    if (!open) return;
    setStartMs(initialStartMs);
    setEndMs(
      Math.min(durationMs, Math.max(initialEndMs, initialStartMs + 3000)),
    );
    setTitle(initialTitle ?? "");
    setDescription(initialText ?? "");
  }, [
    open,
    initialStartMs,
    initialEndMs,
    initialTitle,
    initialText,
    durationMs,
  ]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onPlay = () => setPreviewPlaying(true);
    const onPause = () => setPreviewPlaying(false);
    const onTime = () => {
      if (el.currentTime * 1000 >= endMs) el.pause();
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
    };
  }, [endMs]);

  function playPreview() {
    const el = videoRef.current;
    if (!el) return;
    if (previewPlaying) {
      el.pause();
      return;
    }
    el.currentTime = startMs / 1000;
    void el.play();
  }

  const create = useActionMutation<{ id: string }>("create-snippet", {
    onSuccess: (res) => {
      onOpenChange(false);
      if (res && (res as any).id) {
        navigate(`/snippets/${(res as any).id}`);
      }
    },
  });

  const autoTitle = useActionMutation("create-snippet", {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create snippet</DialogTitle>
          <DialogDescription>
            Clip a moment from this call. Drag the handles to adjust.
          </DialogDescription>
        </DialogHeader>

        {mediaUrl ? (
          <div className="rounded-md overflow-hidden bg-black relative">
            <video
              ref={videoRef}
              src={mediaUrl}
              className="w-full aspect-video"
              preload="metadata"
              playsInline
            />
            <Button
              type="button"
              size="icon"
              onClick={playPreview}
              className="absolute bottom-2 left-2"
            >
              {previewPlaying ? (
                <IconPlayerPause className="h-4 w-4" />
              ) : (
                <IconPlayerPlay className="h-4 w-4" />
              )}
            </Button>
          </div>
        ) : null}

        <RangeTimeline
          startMs={startMs}
          endMs={endMs}
          durationMs={durationMs}
          onChange={(s, e) => {
            setStartMs(s);
            setEndMs(e);
            const v = videoRef.current;
            if (v) v.currentTime = s / 1000;
          }}
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Start</Label>
            <Input
              value={formatMs(startMs)}
              readOnly
              className="h-8 font-mono text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">End</Label>
            <Input
              value={formatMs(endMs)}
              readOnly
              className="h-8 font-mono text-sm"
            />
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <div className="flex gap-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Snippet title"
                className="h-9"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  autoTitle.mutate({
                    callId,
                    startMs,
                    endMs,
                    autoTitle: true,
                  } as any)
                }
                disabled={autoTitle.isPending}
              >
                Auto-title
              </Button>
            </div>
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional context"
              className="min-h-[60px] resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              create.mutate({
                callId,
                startMs,
                endMs,
                title: title.trim() || undefined,
                description: description.trim() || undefined,
              } as any)
            }
            disabled={create.isPending || endMs <= startMs}
          >
            {create.isPending ? "Saving…" : "Save snippet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RangeTimeline({
  startMs,
  endMs,
  durationMs,
  onChange,
}: {
  startMs: number;
  endMs: number;
  durationMs: number;
  onChange: (startMs: number, endMs: number) => void;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);

  function msFromEvent(clientX: number): number {
    const el = barRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return Math.floor((x / rect.width) * durationMs);
  }

  function startDrag(which: "start" | "end" | "body", e: React.MouseEvent) {
    e.preventDefault();
    const initialMs = msFromEvent(e.clientX);
    const initialStart = startMs;
    const initialEnd = endMs;
    const onMove = (ev: MouseEvent) => {
      const m = msFromEvent(ev.clientX);
      if (which === "start") {
        onChange(Math.min(m, endMs - 500), endMs);
      } else if (which === "end") {
        onChange(startMs, Math.max(m, startMs + 500));
      } else {
        const delta = m - initialMs;
        const span = initialEnd - initialStart;
        const newStart = Math.max(
          0,
          Math.min(durationMs - span, initialStart + delta),
        );
        onChange(newStart, newStart + span);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const leftPct = durationMs > 0 ? (startMs / durationMs) * 100 : 0;
  const widthPct = durationMs > 0 ? ((endMs - startMs) / durationMs) * 100 : 0;

  return (
    <div className="relative">
      <div
        ref={barRef}
        className="relative w-full h-8 rounded-md bg-muted select-none"
      >
        <div
          className={cn(
            "absolute top-0 bottom-0 bg-foreground/20 border-l-2 border-r-2 border-foreground cursor-grab",
          )}
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          onMouseDown={(e) => startDrag("body", e)}
        />
        <div
          className="absolute top-0 bottom-0 w-2 -ml-1 bg-foreground rounded-sm cursor-ew-resize"
          style={{ left: `${leftPct}%` }}
          onMouseDown={(e) => {
            e.stopPropagation();
            startDrag("start", e);
          }}
        />
        <div
          className="absolute top-0 bottom-0 w-2 -ml-1 bg-foreground rounded-sm cursor-ew-resize"
          style={{ left: `${leftPct + widthPct}%` }}
          onMouseDown={(e) => {
            e.stopPropagation();
            startDrag("end", e);
          }}
        />
      </div>
    </div>
  );
}
