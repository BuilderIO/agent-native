import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatMs } from "@/lib/timestamp-format";

export interface Chapter {
  title: string;
  startMs: number;
  endMs?: number;
}

export interface ChaptersRailProps {
  chapters: Chapter[];
  durationMs: number;
  currentMs: number;
  onSeek: (ms: number) => void;
  className?: string;
}

export function ChaptersRail(props: ChaptersRailProps) {
  const { chapters, durationMs, currentMs, onSeek, className } = props;
  if (!chapters?.length || durationMs <= 0) return null;

  const sorted = [...chapters].sort((a, b) => a.startMs - b.startMs);

  return (
    <TooltipProvider delayDuration={100}>
      <div className={cn("flex w-full gap-[2px]", className)}>
        {sorted.map((ch, i) => {
          const startMs = ch.startMs;
          const endMs = ch.endMs ?? sorted[i + 1]?.startMs ?? durationMs;
          const width = Math.max(0, endMs - startMs);
          const pct = (width / durationMs) * 100;
          const active = currentMs >= startMs && currentMs < endMs;
          return (
            <Tooltip key={`${startMs}-${i}`}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSeek(startMs)}
                  style={{ width: `${pct}%` }}
                  className={cn(
                    "h-1.5 rounded-full bg-muted hover:bg-muted-foreground/40",
                    active && "bg-foreground",
                  )}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <span className="font-medium">{ch.title}</span>
                <span className="ml-2 font-mono text-muted-foreground">
                  {formatMs(startMs)}
                </span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
