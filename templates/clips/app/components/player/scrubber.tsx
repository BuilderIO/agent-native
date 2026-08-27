import { IconMessageFilled } from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import {
  CommentPreview,
  type CommentPreviewData,
} from "./playback-comment-overlay";
import {
  scrubberFillPercent,
  scrubberPositionFromClientX,
  timelineMarkerMs,
} from "./scrubber-position";

export interface ScrubberProps {
  currentMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
  comments?: (CommentPreviewData & {
    videoTimestampMs: number;
  })[];
  chapters?: { startMs: number; title: string }[];
  reactions?: { id: string; emoji: string; videoTimestampMs: number }[];
}

export function Scrubber(props: ScrubberProps) {
  const { currentMs, durationMs, onSeek, comments, chapters, reactions } =
    props;
  const barRef = useRef<HTMLDivElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);
  const [dragging, setDragging] = useState(false);
  const [tooltip, setTooltip] = useState<
    | { kind: "comment"; comment: CommentPreviewData; ms: number }
    | { kind: "chapter"; title: string; ms: number }
    | { kind: "reaction"; content: string; ms: number }
    | null
  >(null);

  const pct = scrubberFillPercent(currentMs, durationMs);

  const recentReactions = useMemo(
    () => (reactions ? reactions.slice(-50) : []),
    [reactions],
  );

  function positionFromClientX(clientX: number): { ms: number; x: number } {
    const el = barRef.current;
    if (!el) return { ms: 0, x: 0 };
    return scrubberPositionFromClientX(
      clientX,
      el.getBoundingClientRect(),
      durationMs,
    );
  }

  function seekFromClientX(clientX: number): void {
    const next = positionFromClientX(clientX);
    setHoverX(next.x);
    setHoverMs(next.ms);
    onSeek(next.ms);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    activePointerIdRef.current = e.pointerId;
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Older test/browser environments may not implement pointer capture.
    }
    seekFromClientX(e.clientX);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current === e.pointerId) {
      e.preventDefault();
      seekFromClientX(e.clientX);
      return;
    }

    if (e.pointerType === "mouse") {
      const next = positionFromClientX(e.clientX);
      setHoverX(next.x);
      setHoverMs(next.ms);
    }
  }

  function endPointerDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== e.pointerId) return;
    activePointerIdRef.current = null;
    setDragging(false);
    if (e.pointerType !== "mouse") setHoverMs(null);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Older test/browser environments may not implement pointer capture.
    }
  }

  const commentsByMs = useMemo(() => {
    const map = new Map<number, CommentPreviewData[]>();
    (comments ?? []).forEach((c) => {
      // Bucket by 500ms so overlapping comments cluster.
      const key = timelineMarkerMs(c.videoTimestampMs);
      const list = map.get(key) ?? [];
      list.push({
        id: c.id,
        content: c.content,
        authorEmail: c.authorEmail,
        authorName: c.authorName,
      });
      map.set(key, list);
    });
    return map;
  }, [comments]);

  const reactionsByMs = useMemo(() => {
    const map = new Map<number, { id: string; emoji: string }[]>();
    recentReactions.forEach((reaction) => {
      const key = timelineMarkerMs(reaction.videoTimestampMs);
      const list = map.get(key) ?? [];
      list.push({ id: reaction.id, emoji: reaction.emoji });
      map.set(key, list);
    });
    return map;
  }, [recentReactions]);

  const markerTimes = useMemo(
    () =>
      Array.from(
        new Set([...commentsByMs.keys(), ...reactionsByMs.keys()]),
      ).sort((a, b) => a - b),
    [commentsByMs, reactionsByMs],
  );

  return (
    <div
      className="relative h-10 flex items-center touch-none cursor-pointer"
      data-player-ui
      data-player-scrubber
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointerDrag}
      onPointerCancel={endPointerDrag}
      onLostPointerCapture={() => {
        activePointerIdRef.current = null;
        setDragging(false);
      }}
      onPointerLeave={() => {
        if (activePointerIdRef.current === null) setHoverMs(null);
      }}
    >
      {/* Hover bubble */}
      {hoverMs !== null && !tooltip ? (
        <div
          className="absolute -top-8 -translate-x-1/2 rounded bg-black/90 px-2 py-1 text-[11px] text-white pointer-events-none"
          style={{ left: hoverX }}
        >
          {msToClock(hoverMs)}
        </div>
      ) : null}

      {/* Tooltip (comment / chapter) */}
      {tooltip ? (
        <div
          data-player-comment-hover
          className="pointer-events-none absolute bottom-[calc(100%+1rem)] z-50 -translate-x-1/2"
          style={{ left: (tooltip.ms / Math.max(1, durationMs)) * 100 + "%" }}
        >
          {tooltip.kind === "comment" ? (
            <CommentPreview
              comment={tooltip.comment}
              className="animate-in fade-in slide-in-from-bottom-2 duration-200"
            />
          ) : (
            <div className="max-w-[min(36rem,calc(100vw-1.5rem))] rounded-xl bg-foreground/95 px-3 py-2.5 text-left text-[11px] text-background shadow-2xl ring-1 ring-background/15 backdrop-blur-md dark:bg-background/95 dark:text-foreground dark:ring-foreground/15">
              {tooltip.kind === "reaction" ? tooltip.content : tooltip.title}
            </div>
          )}
        </div>
      ) : null}

      <div
        ref={barRef}
        data-player-scrubber-bar
        className="relative w-full h-1.5 bg-white/35 rounded-full cursor-pointer group/bar shadow-[0_0_0_1px_rgba(0,0,0,0.16)]"
      >
        {/* Filled portion */}
        <div
          className="absolute inset-y-0 left-0 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.45)]"
          style={{ width: pct + "%" }}
        />

        {/* Chapter notches */}
        {chapters?.map((ch, i) => (
          <button
            key={i}
            type="button"
            onMouseEnter={() =>
              setTooltip({ kind: "chapter", title: ch.title, ms: ch.startMs })
            }
            onMouseLeave={() => setTooltip(null)}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(ch.startMs);
            }}
            className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-white/80 transition-[transform,opacity] duration-150 ease-out hover:scale-x-[2] hover:scale-y-125 motion-reduce:transition-none motion-reduce:hover:scale-100"
            style={{
              left: (ch.startMs / Math.max(1, durationMs)) * 100 + "%",
            }}
            aria-label={`Chapter: ${ch.title}`}
          />
        ))}

        {/* Timeline markers */}
        {markerTimes.map((ms) => {
          const commentList = commentsByMs.get(ms);
          const reactionList = reactionsByMs.get(ms);

          return (
            <div
              key={`marker-${ms}`}
              data-player-marker-group
              className="absolute -top-7 flex h-7 -translate-x-1/2 items-center gap-0.5"
              style={{ left: (ms / Math.max(1, durationMs)) * 100 + "%" }}
            >
              {commentList ? (
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseEnter={() =>
                    setTooltip({
                      kind: "comment",
                      comment: commentList[0],
                      ms,
                    })
                  }
                  onMouseLeave={() => setTooltip(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSeek(ms);
                  }}
                  className="relative flex h-7 w-7 shrink-0 items-center justify-center text-background drop-shadow-md transition-transform hover:scale-110 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/80 dark:text-foreground dark:focus-visible:ring-foreground/80"
                  aria-label={`${commentList.length} comment${commentList.length > 1 ? "s" : ""}`}
                >
                  <IconMessageFilled className="h-6 w-6" />
                  {commentList.length > 1 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground/75 px-0.5 text-[8px] font-bold leading-none text-background shadow-sm dark:bg-background/75 dark:text-foreground">
                      {commentList.length}
                    </span>
                  )}
                </button>
              ) : null}

              {reactionList ? (
                <button
                  type="button"
                  data-player-reaction-marker
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseEnter={() =>
                    setTooltip({
                      kind: "reaction",
                      content: `${reactionList.map((reaction) => reaction.emoji).join(" ")} · ${reactionList.length} reaction${reactionList.length === 1 ? "" : "s"}`,
                      ms,
                    })
                  }
                  onMouseLeave={() => setTooltip(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSeek(ms);
                  }}
                  className="relative flex h-7 min-w-7 shrink-0 items-center justify-center px-0.5 text-2xl leading-none text-background drop-shadow-sm transition-transform hover:scale-110 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/80 dark:text-foreground dark:focus-visible:ring-foreground/80"
                  aria-label={`${reactionList.length} reaction${reactionList.length === 1 ? "" : "s"} at ${msToClock(ms)}`}
                >
                  {reactionList[0].emoji}
                  {reactionList.length > 1 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground/75 px-0.5 text-[8px] font-bold leading-none text-background shadow-sm dark:bg-background/75 dark:text-foreground">
                      {reactionList.length}
                    </span>
                  ) : null}
                </button>
              ) : null}
            </div>
          );
        })}

        {/* Thumb */}
        <div
          className={cn(
            "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-[transform,opacity] duration-150 ease-out motion-reduce:scale-100 motion-reduce:transition-none",
            dragging
              ? "scale-125 opacity-100"
              : "scale-95 group-hover/bar:scale-100 group-hover/bar:opacity-100",
          )}
          style={{ left: pct + "%" }}
        />
      </div>
    </div>
  );
}

export function msToClock(ms: number): string {
  if (!isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
