import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { CHAPTERS_CHANGED, sameChapters } from "@shared/stored-chapters";
import {
  IconBookmarks,
  IconPlus,
  IconTrash,
  IconGripVertical,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatMs } from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";

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
  const t = useT();
  const [local, setLocal] = useState<Chapter[]>(chapters);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The stored list each save is checked against, so a save never replaces
  // chapters changed elsewhere (the chapter list, the agent) meanwhile.
  const storedRef = useRef<Chapter[]>(chapters);
  // Edits not yet settled: one for a waiting debounce, one per queued save.
  // While any are, refetched props are ignored; they may predate the edit.
  const busyRef = useRef(0);
  // Saves run one at a time; a failure drops the ones queued behind it.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const failedRef = useRef(0);

  const mutation = useActionMutation("set-chapters");
  const queryClient = useQueryClient();

  useEffect(() => {
    if (dragIndex != null || busyRef.current > 0) return;
    // Our own save coming back; resetting would drop a trailing space.
    if (sameChapters(chapters, storedRef.current)) return;
    storedRef.current = chapters;
    setLocal(chapters);
  }, [chapters, dragIndex]);

  const save = async (next: Chapter[], failed: number) => {
    if (failed !== failedRef.current) return;
    try {
      const result = await mutation.mutateAsync({
        recordingId,
        chapters: next.map((c) => ({ startMs: c.startMs, title: c.title })),
        expectedChapters: storedRef.current,
      });
      storedRef.current =
        (result as { chapters?: Chapter[] })?.chapters ?? next;
    } catch (err: any) {
      failedRef.current++;
      const changed = err?.errorCode === CHAPTERS_CHANGED;
      const latest = err?.details?.chapters;
      if (changed && Array.isArray(latest)) storedRef.current = latest;
      setLocal(storedRef.current);
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-recording-player-data", { recordingId }],
      });
      // The hook's error text is English and for developers.
      console.error("[clips] set-chapters failed", err);
      toast.error(
        t(changed ? "chapters.changedElsewhere" : "chapters.saveFailed"),
      );
    }
  };

  const commit = (next: Chapter[]) => {
    setLocal(next);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      busyRef.current--;
    }
    // A cleared title is mid-edit, and set-chapters refuses empty titles.
    if (next.some((c) => !c.title.trim())) return;
    busyRef.current++;
    const failed = failedRef.current;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      queueRef.current = queueRef.current
        .then(() => save(next, failed))
        .finally(() => {
          busyRef.current--;
        });
    }, 300);
  };

  const addAtCurrent = () => {
    const startMs = Math.round(currentMs);
    const existingAt = local.some((c) => c.startMs === startMs);
    if (existingAt) {
      toast.info(t("chapters.duplicateAtPoint"));
      return;
    }
    const title = t("chapters.defaultTitle", { count: local.length + 1 });
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
    setDragIndex(null);
    commit([...local].sort((a, b) => a.startMs - b.startMs));
  };

  return (
    <div className={cn("flex flex-col h-full min-h-0", className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <IconBookmarks className="w-4 h-4 text-primary" />
          {t("chapters.title")}
        </div>
        <Button size="sm" variant="secondary" onClick={addAtCurrent}>
          <IconPlus className="w-3.5 h-3.5 mr-1" />
          {t("chapters.addHere")}
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {local.length === 0 ? (
          <Empty className="gap-2 rounded-none px-3 py-6 md:p-6">
            <EmptyHeader>
              <EmptyTitle className="text-xs font-normal text-muted-foreground">
                {t("chapters.empty")}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onSeek?.(c.startMs)}
                    className="text-[11px] font-mono text-muted-foreground w-14 shrink-0 text-left hover:text-foreground"
                  >
                    {formatMs(c.startMs)}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("chapters.seekTo", { time: formatMs(c.startMs) })}
                </TooltipContent>
              </Tooltip>
              <Input
                value={c.title}
                onChange={(e) => rename(i, e.target.value)}
                className="h-7 text-xs"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 h-7 w-7 p-0"
                    onClick={() => remove(i)}
                  >
                    <IconTrash className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("chapters.remove")}</TooltipContent>
              </Tooltip>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
