import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  IconSearch,
  IconChevronUp,
  IconChevronDown,
  IconX,
  IconFilter,
} from "@tabler/icons-react";
import { TranscriptLine } from "./transcript-line";
import type { SpeakerParticipant } from "./speaker-avatars";
import { useTranscriptSearch } from "@/hooks/use-transcript-search";
import type { TranscriptSegment, TrackerHit } from "@/../shared/api";

export interface TranscriptPaneProps {
  segments: TranscriptSegment[];
  participants: SpeakerParticipant[];
  currentMs: number;
  onSeek: (ms: number) => void;
  trackerHitsBySegment?: Record<number, TrackerHit[]>;
  onCreateSnippet?: (segment: TranscriptSegment) => void;
  onShareMoment?: (segment: TranscriptSegment) => void;
  onComment?: (segment: TranscriptSegment) => void;
  onCopyQuote?: (segment: TranscriptSegment) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  status?: "pending" | "ready" | "failed";
  failureReason?: string | null;
  className?: string;
}

export function TranscriptPane(props: TranscriptPaneProps) {
  const {
    segments,
    participants,
    currentMs,
    onSeek,
    trackerHitsBySegment,
    onCreateSnippet,
    onShareMoment,
    onComment,
    onCopyQuote,
    searchInputRef,
    status,
    failureReason,
    className,
  } = props;

  const [query, setQuery] = useState("");
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const [selectionText, setSelectionText] = useState<string>("");
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);

  const { hits, activeHitIndex, next, prev } = useTranscriptSearch(
    segments,
    query,
  );

  const participantByLabel = useMemo(() => {
    const m = new Map<string, SpeakerParticipant>();
    for (const p of participants) m.set(p.speakerLabel, p);
    return m;
  }, [participants]);

  const visibleSegments = useMemo(() => {
    if (activeSpeakers.size === 0) return segments;
    return segments.filter((s) => activeSpeakers.has(s.speakerLabel));
  }, [segments, activeSpeakers]);

  const activeSegmentIndex = useMemo(() => {
    let found = -1;
    for (let i = 0; i < segments.length; i++) {
      if (currentMs >= segments[i].startMs && currentMs <= segments[i].endMs) {
        found = i;
        break;
      }
      if (segments[i].startMs > currentMs) break;
    }
    return found;
  }, [segments, currentMs]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const userScrolledAtRef = useRef<number>(0);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const registerLine = useCallback(
    (idx: number) => (el: HTMLDivElement | null) => {
      if (el) lineRefs.current.set(idx, el);
      else lineRefs.current.delete(idx);
    },
    [],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      userScrolledAtRef.current = Date.now();
    };
    el.addEventListener("wheel", onScroll, { passive: true });
    el.addEventListener("touchmove", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onScroll);
      el.removeEventListener("touchmove", onScroll);
    };
  }, []);

  useEffect(() => {
    if (activeSegmentIndex < 0) return;
    if (Date.now() - userScrolledAtRef.current < 4000) return;
    const el = lineRefs.current.get(activeSegmentIndex);
    if (!el) return;
    const handle = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [activeSegmentIndex]);

  useEffect(() => {
    if (!hits.length) return;
    const hit = hits[activeHitIndex];
    if (!hit) return;
    const el = lineRefs.current.get(hit.segmentIndex);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeHitIndex, hits]);

  useEffect(() => {
    function onSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !scrollRef.current) {
        setSelectionText("");
        setSelectionRect(null);
        return;
      }
      const node = sel.anchorNode;
      if (!(node instanceof Node)) return;
      if (!scrollRef.current.contains(node)) {
        setSelectionText("");
        setSelectionRect(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSelectionText("");
        setSelectionRect(null);
        return;
      }
      setSelectionText(sel.toString());
      setSelectionRect(rect);
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  const currentHitSegmentIndex = hits[activeHitIndex]?.segmentIndex;
  const activeMatchStart = hits[activeHitIndex]?.matchRanges[0]?.[0] ?? null;

  const toggleSpeaker = (label: string) => {
    setActiveSpeakers((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const copySelection = () => {
    if (!selectionText) return;
    navigator.clipboard.writeText(selectionText).catch(() => {});
    const sel = window.getSelection();
    sel?.removeAllRanges();
  };

  if (status === "pending") {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        <div className="p-6 text-sm text-muted-foreground">Transcribing…</div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        <div className="p-6 text-sm text-destructive">
          Transcription failed: {failureReason ?? "Unknown error"}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="sticky top-0 z-10 bg-background border-b border-border p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef ?? undefined}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (e.shiftKey) prev();
                  else next();
                }
                if (e.key === "Escape") {
                  setQuery("");
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Search transcript"
              className="pl-8 h-8 text-sm"
            />
          </div>
          {query ? (
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                {hits.length === 0
                  ? "0/0"
                  : `${activeHitIndex + 1}/${hits.length}`}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={prev}
                disabled={!hits.length}
              >
                <IconChevronUp className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={next}
                disabled={!hits.length}
              >
                <IconChevronDown className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setQuery("")}
              >
                <IconX className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>
        {participants.length > 1 ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <IconFilter className="h-3.5 w-3.5 text-muted-foreground" />
            {participants.map((p) => {
              const active =
                activeSpeakers.size === 0 || activeSpeakers.has(p.speakerLabel);
              return (
                <button
                  key={p.speakerLabel}
                  onClick={() => toggleSpeaker(p.speakerLabel)}
                  className={cn(
                    "text-[11px] rounded-full px-2 py-0.5 border",
                    active
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background text-muted-foreground border-border hover:text-foreground",
                  )}
                >
                  {p.displayName || p.speakerLabel}
                </button>
              );
            })}
            {activeSpeakers.size > 0 ? (
              <button
                onClick={() => setActiveSpeakers(new Set())}
                className="text-[11px] text-muted-foreground hover:text-foreground ml-1"
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
        {visibleSegments.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No transcript yet.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {visibleSegments.map((seg) => {
              const absoluteIndex = segments.indexOf(seg);
              const isActive = absoluteIndex === activeSegmentIndex;
              const isHitActive = absoluteIndex === currentHitSegmentIndex;
              return (
                <TranscriptLine
                  key={`${seg.startMs}-${absoluteIndex}`}
                  ref={registerLine(absoluteIndex)}
                  segment={seg}
                  segmentIndex={absoluteIndex}
                  participant={participantByLabel.get(seg.speakerLabel)}
                  isActive={isActive}
                  isSelectedByUser={isHitActive && !isActive}
                  highlightTerm={query || undefined}
                  activeMatchStart={isHitActive ? activeMatchStart : null}
                  trackerHits={trackerHitsBySegment?.[absoluteIndex]}
                  onSeek={onSeek}
                  onCreateSnippet={
                    onCreateSnippet ? () => onCreateSnippet(seg) : undefined
                  }
                  onShareMoment={
                    onShareMoment ? () => onShareMoment(seg) : undefined
                  }
                  onComment={onComment ? () => onComment(seg) : undefined}
                  onCopyQuote={
                    onCopyQuote
                      ? () => onCopyQuote(seg)
                      : () => {
                          navigator.clipboard
                            .writeText(seg.text)
                            .catch(() => {});
                        }
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      {selectionText && selectionRect ? (
        <FloatingSelectionBar
          rect={selectionRect}
          onCreateSnippet={() => {
            onCreateSnippet?.({
              startMs: 0,
              endMs: 0,
              text: selectionText,
              speakerLabel: "",
            } as TranscriptSegment);
          }}
          onShareMoment={() => {
            onShareMoment?.({
              startMs: 0,
              endMs: 0,
              text: selectionText,
              speakerLabel: "",
            } as TranscriptSegment);
          }}
          onCopy={copySelection}
        />
      ) : null}
    </div>
  );
}

function FloatingSelectionBar({
  rect,
  onCreateSnippet,
  onShareMoment,
  onCopy,
}: {
  rect: DOMRect;
  onCreateSnippet?: () => void;
  onShareMoment?: () => void;
  onCopy: () => void;
}) {
  const top = Math.max(8, rect.top - 42);
  const left = Math.max(8, rect.left + rect.width / 2);

  return (
    <div
      className="fixed z-50 rounded-md border border-border bg-background shadow-md px-1 py-1 flex items-center gap-0.5"
      style={{ top, left, transform: "translateX(-50%)" }}
    >
      {onCreateSnippet ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={onCreateSnippet}
        >
          Snippet
        </Button>
      ) : null}
      {onShareMoment ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={onShareMoment}
        >
          Share
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        onClick={onCopy}
      >
        Copy
      </Button>
    </div>
  );
}
