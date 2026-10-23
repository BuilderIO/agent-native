// Copied from Clips' `app/components/player/scrubber.tsx` until the player
// moves to a shared package. Content shows comment markers only: no
// chapters or reactions.
import { useT } from "@agent-native/core/client/i18n";
import type { ClipCommentMarker } from "@shared/clips-peer-contract";
import { IconMessageFilled } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { COMMENT_PREVIEW_WIDTH_PX, CommentPreview } from "./comment-preview";
import {
  scrubberFillPercent,
  scrubberPositionFromClientX,
  timelineMarkerAlignment,
  timelineMarkerLanes,
  timelineMarkerMs,
} from "./scrubber-position";

export interface ScrubberProps {
  hoverPreviews?: boolean;
  currentMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
  comments?: ClipCommentMarker[];
  onMarkerLanesChange?: (lanes: Map<number, number>) => void;
}

const MARKER_CONTROL_SIZE_PX = 28;

export function Scrubber(props: ScrubberProps) {
  const t = useT();
  const {
    hoverPreviews = true,
    currentMs,
    durationMs,
    onSeek,
    comments,
    onMarkerLanesChange,
  } = props;
  const barRef = useRef<HTMLDivElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const [barWidth, setBarWidth] = useState(0);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);
  const [dragging, setDragging] = useState(false);
  const [tooltip, setTooltip] = useState<{
    comment: ClipCommentMarker;
    ms: number;
    lane: number;
  } | null>(null);

  const pct = scrubberFillPercent(currentMs, durationMs);

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
    // Older test/browser environments may not implement pointer capture.
    e.currentTarget.setPointerCapture?.(e.pointerId);
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
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  const commentsByMs = useMemo(() => {
    const map = new Map<number, ClipCommentMarker[]>();
    (comments ?? []).forEach((c) => {
      const key = timelineMarkerMs(c.videoTimestampMs);
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    });
    return map;
  }, [comments]);

  const markerTimes = useMemo(
    () => Array.from(commentsByMs.keys()).sort((a, b) => a - b),
    [commentsByMs],
  );

  const markerWidths = useMemo(
    () => new Map(markerTimes.map((ms) => [ms, MARKER_CONTROL_SIZE_PX])),
    [markerTimes],
  );
  const markerLanes = useMemo(
    () => timelineMarkerLanes(markerTimes, markerWidths, durationMs, barWidth),
    [barWidth, durationMs, markerTimes, markerWidths],
  );
  const previousMarkerLanesRef = useRef<Map<number, number> | null>(null);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? bar.clientWidth;
      setBarWidth(Math.max(1, width));
    });
    observer.observe(bar);
    setBarWidth(
      Math.max(1, bar.getBoundingClientRect().width || bar.clientWidth),
    );
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!onMarkerLanesChange) {
      previousMarkerLanesRef.current = null;
      return;
    }
    const previousMarkerLanes = previousMarkerLanesRef.current;
    if (
      previousMarkerLanes &&
      previousMarkerLanes.size === markerLanes.size &&
      [...markerLanes].every(
        ([time, lane]) => previousMarkerLanes.get(time) === lane,
      )
    ) {
      return;
    }
    previousMarkerLanesRef.current = markerLanes;
    onMarkerLanesChange(markerLanes);
  }, [markerLanes, onMarkerLanesChange]);
  const tooltipPositionPercent = tooltip
    ? Math.min(100, Math.max(0, (tooltip.ms / Math.max(1, durationMs)) * 100))
    : 50;
  const tooltipAlignment = tooltip
    ? timelineMarkerAlignment(
        tooltip.ms,
        durationMs,
        Math.min(COMMENT_PREVIEW_WIDTH_PX, barWidth),
        barWidth,
      )
    : "center";

  return (
    <div
      className="relative flex h-10 cursor-pointer touch-none items-center"
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
      {hoverPreviews && hoverMs !== null && !tooltip ? (
        <div
          className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded bg-player-control/90 px-2 py-1 text-[11px] leading-none text-player-control-foreground"
          style={{ left: hoverX }}
        >
          {msToClock(hoverMs)}
        </div>
      ) : null}

      {tooltip ? (
        <div
          data-player-comment-hover
          className={cn(
            "pointer-events-none absolute bottom-[calc(100%+1rem)] z-50 w-80 max-w-full leading-normal",
            tooltipAlignment === "center" && "-translate-x-1/2",
          )}
          style={{
            ...(tooltipAlignment === "start"
              ? { left: "0%" }
              : tooltipAlignment === "end"
                ? { right: "0%" }
                : { left: tooltipPositionPercent + "%" }),
            bottom: `calc(100% + ${1 + tooltip.lane * 1.75}rem)`,
          }}
        >
          <CommentPreview
            comment={tooltip.comment}
            className="animate-in fade-in slide-in-from-bottom-2 duration-200"
          />
        </div>
      ) : null}

      <div
        ref={barRef}
        data-player-scrubber-bar
        className="group/bar relative h-1.5 w-full cursor-pointer rounded-full bg-player-control-foreground/35"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-player-control-foreground"
          style={{ width: pct + "%" }}
        />

        {markerTimes.map((ms) => {
          const commentList = commentsByMs.get(ms)!;
          const markerLane = markerLanes.get(ms) ?? 0;
          const markerAlignment = timelineMarkerAlignment(
            ms,
            durationMs,
            MARKER_CONTROL_SIZE_PX,
            barWidth,
          );
          const time = msToClock(ms);

          return (
            <div
              key={`marker-${ms}`}
              data-player-marker-group
              className={cn(
                "absolute flex h-7 items-center",
                markerAlignment === "center" && "-translate-x-1/2",
                markerLane ? "-top-14" : "-top-7",
              )}
              style={{
                ...(markerAlignment === "start"
                  ? { left: "0%" }
                  : markerAlignment === "end"
                    ? { right: "0%" }
                    : { left: (ms / Math.max(1, durationMs)) * 100 + "%" }),
                ...(markerLane > 1
                  ? { top: `-${(markerLane + 1) * 1.75}rem` }
                  : {}),
              }}
            >
              <button
                type="button"
                data-player-comment-marker
                onPointerDown={(event) => event.stopPropagation()}
                onMouseEnter={() =>
                  setTooltip({
                    comment: commentList[0]!,
                    ms,
                    lane: markerLane,
                  })
                }
                onMouseLeave={() => setTooltip(null)}
                onFocus={() =>
                  setTooltip({
                    comment: commentList[0]!,
                    ms,
                    lane: markerLane,
                  })
                }
                onBlur={() => setTooltip(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  onSeek(ms);
                }}
                className="relative flex h-7 w-7 shrink-0 items-center justify-center text-player-control-foreground drop-shadow-md transition-transform hover:scale-110 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-player-control-foreground/80"
                aria-label={
                  commentList.length === 1
                    ? t("clipEmbed.commentsAtOne", { time })
                    : t("clipEmbed.commentsAt", {
                        count: commentList.length,
                        time,
                      })
                }
              >
                <IconMessageFilled className="h-6 w-6" />
                {commentList.length > 1 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-player-control/75 px-0.5 text-[8px] font-bold leading-none text-player-control-foreground shadow-sm">
                    {commentList.length}
                  </span>
                )}
              </button>
            </div>
          );
        })}

        <div
          className={cn(
            "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-player-control-foreground opacity-0 shadow transition-[transform,opacity] duration-150 ease-out motion-reduce:scale-100 motion-reduce:transition-none",
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
