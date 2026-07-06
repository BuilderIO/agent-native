import { useT } from "@agent-native/core/client";
import {
  IconChevronDown,
  IconChevronUp,
  IconNotes,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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

// Splits `text` into plain/matched runs for a case-insensitive substring
// highlight. Returns the original text as a single run when there's no query
// or no match, so callers can render uniformly either way.
function highlightRuns(
  text: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  if (!query) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const runs: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const at = lower.indexOf(needle, cursor);
    if (at === -1) {
      runs.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (at > cursor) runs.push({ text: text.slice(cursor, at), match: false });
    runs.push({ text: text.slice(at, at + needle.length), match: true });
    cursor = at + needle.length;
  }
  return runs.length ? runs : [{ text, match: false }];
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
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const liveEndRef = useRef<HTMLDivElement>(null);
  const userPausedRef = useRef(false);
  const segmentRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const flashTimeoutRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchCursor, setMatchCursor] = useState(0);

  const groups = useMemo(() => groupConsecutive(segments), [segments]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const matchIndexes = useMemo(() => {
    if (!normalizedQuery) return [];
    const out: number[] = [];
    segments.forEach((seg, index) => {
      if (seg.text.toLowerCase().includes(normalizedQuery)) out.push(index);
    });
    return out;
  }, [segments, normalizedQuery]);

  // Keep the cursor in range as matches change (typing narrows the set).
  useEffect(() => {
    setMatchCursor(0);
  }, [normalizedQuery]);

  const scrollToSegmentRef = useRef<((segmentIndex: number) => void) | null>(
    null,
  );

  // Only scroll when the resolved target actually changes — during a live
  // meeting the segments array (and thus matchIndexes) gets a new identity on
  // every poll, and re-scrolling each time would fight the user's scrolling.
  const lastSearchScrollRef = useRef<string | null>(null);
  useEffect(() => {
    if (!normalizedQuery || !matchIndexes.length) {
      lastSearchScrollRef.current = null;
      return;
    }
    const target = matchIndexes[matchCursor % matchIndexes.length];
    const scrollKey = `${normalizedQuery}:${target}`;
    if (lastSearchScrollRef.current === scrollKey) return;
    lastSearchScrollRef.current = scrollKey;
    scrollToSegmentRef.current?.(target);
  }, [normalizedQuery, matchIndexes, matchCursor]);

  useEffect(() => {
    if (searchOpen) {
      const raf = requestAnimationFrame(() => searchInputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
  }, [searchOpen]);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
  };

  const goToMatch = (dir: 1 | -1) => {
    if (!matchIndexes.length) return;
    setMatchCursor(
      (prev) => (prev + dir + matchIndexes.length) % matchIndexes.length,
    );
  };

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

  // Shared imperative scroll-and-flash, used by both the parent's bullet-jump
  // wiring (registerScrollTo) and in-panel search navigation below.
  const scrollToAndFlash = useRef((segmentIndex: number) => {
    const node = segmentRefs.current[segmentIndex];
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    // Yellow-flash highlight for ~1.5s.
    node.classList.add("ring-2", "ring-yellow-400/70", "bg-yellow-400/10");
    if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = window.setTimeout(() => {
      node.classList.remove("ring-2", "ring-yellow-400/70", "bg-yellow-400/10");
    }, 1500);
  }).current;

  useEffect(() => {
    scrollToSegmentRef.current = scrollToAndFlash;
  }, [scrollToAndFlash]);

  useEffect(() => {
    if (!registerScrollTo) return;
    registerScrollTo(scrollToAndFlash);
  }, [registerScrollTo, scrollToAndFlash]);

  if (segments.length === 0) {
    if (isLive) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center text-sm text-muted-foreground gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          {t("transcriptBubbles.listening")}
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-sm text-muted-foreground gap-2 px-6">
        <IconNotes className="h-6 w-6 text-muted-foreground/50" />
        <span>{t("transcriptBubbles.noTranscript")}</span>
        <span className="text-xs">
          {t("transcriptBubbles.liveTranscriptDescription")}
        </span>
      </div>
    );
  }

  const activeMatchIndex = matchIndexes.length
    ? matchIndexes[matchCursor % matchIndexes.length]
    : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex shrink-0 items-center justify-end gap-1.5 border-b border-border px-2 py-1.5">
        {searchOpen ? (
          <>
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeSearch();
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  goToMatch(e.shiftKey ? -1 : 1);
                }
              }}
              onBlur={() => {
                if (!searchQuery.trim()) closeSearch();
              }}
              placeholder={t("transcriptBubbles.searchPlaceholder")}
              className="h-7 flex-1 text-xs"
            />
            {normalizedQuery && (
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {matchIndexes.length > 0
                  ? t("transcriptBubbles.searchMatchCount", {
                      current: (matchCursor % matchIndexes.length) + 1,
                      total: matchIndexes.length,
                    })
                  : t("transcriptBubbles.searchNoMatches")}
              </span>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 cursor-pointer"
              disabled={!matchIndexes.length}
              aria-label={t("transcriptBubbles.searchPrevMatch")}
              onClick={() => goToMatch(-1)}
            >
              <IconChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 cursor-pointer"
              disabled={!matchIndexes.length}
              aria-label={t("transcriptBubbles.searchNextMatch")}
              onClick={() => goToMatch(1)}
            >
              <IconChevronDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 cursor-pointer"
              aria-label={t("transcriptBubbles.searchClose")}
              onClick={closeSearch}
            >
              <IconX className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 cursor-pointer"
            aria-label={t("transcriptBubbles.searchTranscript")}
            onClick={() => setSearchOpen(true)}
          >
            <IconSearch className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
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
                  {isMe
                    ? t("transcriptBubbles.me")
                    : t("transcriptBubbles.them")}
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
                          <p className="whitespace-pre-wrap">
                            {normalizedQuery
                              ? highlightRuns(seg.text, normalizedQuery).map(
                                  (run, ri) =>
                                    run.match ? (
                                      <mark
                                        key={ri}
                                        className={cn(
                                          "rounded-sm bg-yellow-400/70 text-foreground",
                                          index === activeMatchIndex &&
                                            "bg-yellow-400 ring-1 ring-yellow-600",
                                        )}
                                      >
                                        {run.text}
                                      </mark>
                                    ) : (
                                      <span key={ri}>{run.text}</span>
                                    ),
                                )
                              : seg.text}
                          </p>
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
