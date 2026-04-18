import { useEffect, useRef, useState } from "react";
import {
  IconBookmarks,
  IconPlus,
  IconTrash,
  IconGripVertical,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMs } from "@/lib/timestamp-mapping";
import { useActionMutation } from "@agent-native/core/client";
import { toast } from "sonner";

export interface Chapter {
  startMs: number;
  title: string;
}

export interface ChaptersEditorProps {
  recordingId: string;
  chapters: Chapter[];
  currentMs: number;
  onSeek?: (ms: number) => void;
  className?: string;
}

export function ChaptersEditor({
  recordingId,
  chapters,
  currentMs,
  onSeek,
  className,
}: ChaptersEditorProps) {
  const [local, setLocal] = useState<Chapter[]>(chapters);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useActionMutation("set-chapters" as any);

  useEffect(() => {
    // Sync from server while we're not actively dragging.
    if (dragIndex == null) setLocal(chapters);
  }, [chapters, dragIndex]);

  const commit = (next: Chapter[]) => {
    setLocal(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        await mutation.mutateAsync({
          recordingId,
          chapters: next.map((c) => ({ startMs: c.startMs, title: c.title })),
        } as any);
      } catch (err: any) {
        console.error(err);
        toast.error(err?.message ?? "Failed to save chapters");
      }
    }, 300);
  };

  const addAtCurrent = () => {
    const startMs = Math.round(currentMs);
    const existingAt = local.some((c) => c.startMs === startMs);
    if (existingAt) {
      toast.info("A chapter already exists at this point");
      return;
    }
    const title = `Chapter ${local.length + 1}`;
    commit(
      [...local, { startMs, title }].sort((a, b) => a.startMs - b.startMs),
    );
  };

  const rename = (i: number, title: string) => {
    const next = [...local];
    next[i] = { ...next[i], title };
    commit(next);
  };

  const remove = (i: number) => {
    commit(local.filter((_, j) => j !== i));
  };

  const handleDragStart = (i: number) => setDragIndex(i);
  const handleDragOver = (i: number, e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex == null || dragIndex === i) return;
    const next = [...local];
    const [m] = next.splice(dragIndex, 1);
    next.splice(i, 0, m);
    setDragIndex(i);
    setLocal(next);
  };
  const handleDragEnd = () => {
    // Re-sort by startMs after drag so ordering always matches timeline.
    setDragIndex(null);
    commit([...local].sort((a, b) => a.startMs - b.startMs));
  };

  return (
    <div className={cn("flex flex-col h-full min-h-0", className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <IconBookmarks className="w-4 h-4 text-primary" />
          Chapters
        </div>
        <Button size="sm" variant="secondary" onClick={addAtCurrent}>
          <IconPlus className="w-3.5 h-3.5 mr-1" />
          Add here
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {local.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">
            No chapters yet. Play to a point and click "Add here" to create one.
          </div>
        ) : (
          local.map((c, i) => (
            <div
              key={`${c.startMs}-${i}`}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(i, e)}
              onDragEnd={handleDragEnd}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 border-b border-border/60 group",
                dragIndex === i && "bg-accent",
              )}
            >
              <IconGripVertical className="w-3.5 h-3.5 text-muted-foreground cursor-grab" />
              <button
                type="button"
                onClick={() => onSeek?.(c.startMs)}
                className="text-[11px] font-mono text-muted-foreground w-14 shrink-0 text-left hover:text-foreground"
                title={`Seek to ${formatMs(c.startMs)}`}
              >
                {formatMs(c.startMs)}
              </button>
              <Input
                value={c.title}
                onChange={(e) => rename(i, e.target.value)}
                className="h-7 text-xs"
              />
              <Button
                size="sm"
                variant="ghost"
                className="opacity-0 group-hover:opacity-100 h-7 w-7 p-0"
                onClick={() => remove(i)}
                title="Remove chapter"
              >
                <IconTrash className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
