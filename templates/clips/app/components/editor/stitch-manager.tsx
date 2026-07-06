import {
  agentNativePath,
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@agent-native/toolkit/ui/dialog";
import { ScrollArea } from "@agent-native/toolkit/ui/scroll-area";
import {
  IconPuzzle,
  IconGripVertical,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { exportConcat } from "@/lib/ffmpeg-export";
import { formatMs } from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";

/** Client-side upload via the framework's auto-mounted `/file-upload` route. */
async function uploadFileClient(
  blob: Blob,
  filename: string,
): Promise<{ url: string } | null> {
  const form = new FormData();
  form.append("file", blob, filename);
  const res = await fetch(agentNativePath("/_agent-native/file-upload"), {
    method: "POST",
    body: form,
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.url ? { url: json.url as string } : null;
}

export interface StitchManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When the source recording is known, pre-seed the list with it. */
  seedRecordingId?: string;
}

interface RecordingLite {
  id: string;
  title: string;
  durationMs: number;
  thumbnailUrl?: string | null;
  videoFormat?: "webm" | "mp4";
  videoUrl?: string | null;
}

export function StitchManager({
  open,
  onOpenChange,
  seedRecordingId,
}: StitchManagerProps) {
  const t = useT();
  const [queue, setQueue] = useState<RecordingLite[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [title, setTitle] = useState(t("stitchManager.defaultTitle"));
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const listQuery = useActionQuery("list-recordings", {});
  const stitch = useActionMutation("stitch-recordings");

  useEffect(() => {
    if (!open) {
      setQueue([]);
      setProgress(0);
      setBusy(false);
    }
  }, [open]);

  const available = useMemo(() => {
    const rows: RecordingLite[] = (listQuery.data?.recordings ??
      []) as RecordingLite[];
    return rows.filter((r) => !queue.some((q) => q.id === r.id));
  }, [listQuery.data, queue]);

  // Pre-seed the queue with the current recording when provided.
  useEffect(() => {
    if (!open || !seedRecordingId) return;
    const rows: RecordingLite[] = (listQuery.data?.recordings ??
      []) as RecordingLite[];
    const seed = rows.find((r) => r.id === seedRecordingId);
    if (seed && !queue.some((q) => q.id === seed.id)) {
      setQueue([seed]);
    }
  }, [open, seedRecordingId, listQuery.data, queue]);

  const addToQueue = (r: RecordingLite) => setQueue((q) => [...q, r]);
  const removeFromQueue = (i: number) =>
    setQueue((q) => q.filter((_, j) => j !== i));

  const handleDragStart = (i: number) => setDragIndex(i);
  const handleDragOver = (i: number, e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex == null || dragIndex === i) return;
    setQueue((q) => {
      const next = [...q];
      const [m] = next.splice(dragIndex, 1);
      next.splice(i, 0, m);
      return next;
    });
    setDragIndex(i);
  };
  const handleDragEnd = () => setDragIndex(null);

  const handleCombine = async () => {
    if (queue.length < 2) {
      toast.error(t("stitchManager.pickAtLeastTwo"));
      return;
    }
    if (queue.some((r) => !r.videoUrl)) {
      toast.error(t("stitchManager.videoUrlMissing"));
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      // 1) Client-side ffmpeg concat.
      const blob = await exportConcat(
        queue.map((r) => ({
          url: r.videoUrl!,
          format: r.videoFormat ?? "webm",
        })),
        (p) => setProgress(p.progress),
      );

      // 2) Upload the combined video.
      const upload = await uploadFileClient(
        blob,
        `${title.replace(/[^a-z0-9-_]+/gi, "-")}.mp4`,
      );
      const videoUrl = upload?.url ?? null;
      if (!videoUrl) {
        throw new Error(t("stitchManager.connectStorage"));
      }

      // 3) Create the stitched recording row.
      const totalDuration = queue.reduce((sum, r) => sum + r.durationMs, 0);
      const result = await stitch.mutateAsync({
        title,
        sourceRecordingIds: queue.map((r) => r.id),
        videoUrl,
        durationMs: totalDuration,
      });
      toast.success(t("stitchManager.created"));
      onOpenChange(false);
      return result;
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? t("stitchManager.failed"));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconPuzzle className="w-4 h-4 text-primary" />
            {t("stitchManager.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 min-h-[320px]">
          <div className="flex flex-col border rounded-md">
            <div className="px-3 py-2 text-xs font-medium border-b">
              {t("navigation.library")}
            </div>
            <ScrollArea className="flex-1">
              {available.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">
                  {t("stitchManager.noOtherRecordings")}
                </div>
              ) : (
                available.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => addToQueue(r)}
                    className="w-full text-left flex items-center gap-2 px-2 py-1.5 hover:bg-accent text-xs"
                  >
                    {r.thumbnailUrl ? (
                      <img
                        src={r.thumbnailUrl}
                        className="w-10 h-6 object-cover rounded bg-black"
                        alt=""
                      />
                    ) : (
                      <div className="w-10 h-6 rounded bg-black/40" />
                    )}
                    <div className="flex-1 truncate">{r.title}</div>
                    <div className="text-muted-foreground font-mono">
                      {formatMs(r.durationMs)}
                    </div>
                  </button>
                ))
              )}
            </ScrollArea>
          </div>

          <div className="flex flex-col border rounded-md">
            <div className="px-3 py-2 text-xs font-medium border-b flex items-center justify-between">
              <span>{t("stitchManager.combineOrder")}</span>
              <span className="text-muted-foreground">
                {queue.length} ·{" "}
                {formatMs(queue.reduce((s, r) => s + r.durationMs, 0))}
              </span>
            </div>
            <ScrollArea className="flex-1">
              {queue.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">
                  {t("stitchManager.emptyQueue")}
                </div>
              ) : (
                queue.map((r, i) => (
                  <div
                    key={r.id}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={(e) => handleDragOver(i, e)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 border-b border-border/60 text-xs",
                      dragIndex === i && "bg-accent",
                    )}
                  >
                    <IconGripVertical className="w-3.5 h-3.5 text-muted-foreground cursor-grab" />
                    <span className="w-5 text-[10px] text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="flex-1 truncate">{r.title}</div>
                    <div className="text-muted-foreground font-mono">
                      {formatMs(r.durationMs)}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => removeFromQueue(i)}
                    >
                      <IconX className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </ScrollArea>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">
            {t("stitchManager.titleLabel")}
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 h-8 px-2 text-sm bg-transparent border rounded"
          />
        </div>

        {busy && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <IconLoader2 className="w-4 h-4 animate-spin" />
            {t("stitchManager.combining", {
              progress: Math.round(progress * 100),
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleCombine} disabled={busy || queue.length < 2}>
            {busy ? (
              <IconLoader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <IconPuzzle className="w-4 h-4 mr-1" />
            )}
            {t("stitchManager.combine")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
