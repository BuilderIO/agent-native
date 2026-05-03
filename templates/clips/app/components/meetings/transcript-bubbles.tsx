import { useEffect, useMemo, useRef } from "react";
import { IconNotes } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface TranscriptSegment {
  startMs: number;
  endMs?: number;
  text: string;
  speaker?: string | null;
  source?: "mic" | "system" | null;
}

interface TranscriptBubblesProps {
  segments: TranscriptSegment[];
  isLive: boolean;
  recordingId?: string | null;
  onSeek: (ms: number) => void;
  /**
   * Imperative ref hook: parent can scroll a particular segment into view.
   * Receives a function (segmentIndex) => void.
   */
  registerScrollTo?: (fn: (segmentIndex: number) => void) => void;
}

function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface BubbleGroup {
  source: "mic" | "system";
  segments: { seg: TranscriptSegment; index: number }[];
}

function groupConsecutive(segments: TranscriptSegment[]): BubbleGroup[] {
  const groups: BubbleGroup[] = [];
  segments.forEach((seg, index) => {
    // Default unknown source to "system" (Them) — Granola convention.
    const source: "mic" | "system" = seg.source === "mic" ? "mic" : "system";
    const last = groups[groups.length - 1];
    if (last && last.source === source) {
      last.segments.push({ seg, index });
    } else {
      groups.push({ source, segments: [{ seg, index }] });
    }
  });
  return groups;
}

export function TranscriptBubbles({
  segments,
  isLive,
  recordingId,
  onSeek,
  registerScrollTo,
}: TranscriptBubblesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const liveEndRef = useRef<HTMLDivElement>(null);
  const userPausedRef = useRef(false);
  const segmentRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const flashTimeoutRef = useRef<number | null>(null);

  const groups = useMemo(() => groupConsecutive(segments), [segments]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = () => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      userPausedRef.current = distanceFromBottom > 80;
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    if (isLive && !userPausedRef.current) {
      liveEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isLive, segments.length]);

  useEffect(() => {
    if (!registerScrollTo) return;
    registerScrollTo((segmentIndex: number) => {
      const node = segmentRefs.current[segmentIndex];
      if (!node) return;
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      // Yellow-flash highlight for ~1.5s.
      node.classList.add("ring-2", "ring-yellow-400/70", "bg-yellow-400/10");
      if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = window.setTimeout(() => {
        node.classList.remove(
          "ring-2",
          "ring-yellow-400/70",
          "bg-yellow-400/10",
        );
      }, 1500);
    });
  }, [registerScrollTo]);

  if (segments.length === 0) {
    if (isLive) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center text-sm text-muted-foreground gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          Listening…
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-sm text-muted-foreground gap-2 px-6">
        <IconNotes className="h-6 w-6 text-muted-foreground/50" />
        <span>No transcript yet.</span>
        <span className="text-xs">
          Recording will appear here once the meeting starts.
        </span>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {groups.map((group, gi) => {
            const isMe = group.source === "mic";
            return (
              <div
                key={gi}
                className={cn(
                  "flex flex-col gap-1",
                  isMe ? "items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70 px-1",
                  )}
                >
                  {isMe ? "Me" : "Them"}
                </div>
                {group.segments.map(({ seg, index }) => {
                  const clickable = !!recordingId;
                  return (
                    <Tooltip key={index}>
                      <TooltipTrigger asChild>
                        <div
                          ref={(el) => {
                            segmentRefs.current[index] = el;
                          }}
                          role={clickable ? "button" : undefined}
                          tabIndex={clickable ? 0 : -1}
                          onClick={() => clickable && onSeek(seg.startMs)}
                          onKeyDown={(e) => {
                            if (
                              clickable &&
                              (e.key === "Enter" || e.key === " ")
                            ) {
                              e.preventDefault();
                              onSeek(seg.startMs);
                            }
                          }}
                          className={cn(
                            "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed transition-shadow",
                            isMe
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-foreground",
                            clickable && "cursor-pointer hover:opacity-90",
                          )}
                        >
                          {seg.speaker && !isMe && (
                            <div className="text-[10px] font-medium opacity-70 mb-0.5">
                              {seg.speaker}
                            </div>
                          )}
                          <p className="whitespace-pre-wrap">{seg.text}</p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side={isMe ? "left" : "right"}>
                        <span className="font-mono tabular-nums text-[11px]">
                          {formatTimestamp(seg.startMs)}
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            );
          })}
          <div ref={liveEndRef} />
        </div>
      </div>
    </TooltipProvider>
  );
}
