import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ScrubberProps {
  currentMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
  comments?: { id: string; videoTimestampMs: number; content: string }[];
  chapters?: { startMs: number; title: string }[];
  reactions?: { id: string; emoji: string; videoTimestampMs: number }[];
  excludedRanges?: { startMs: number; endMs: number }[];
}

export function Scrubber(props: ScrubberProps) {
  const {
    currentMs,
    durationMs,
    onSeek,
    comments,
    chapters,
    reactions,
    excludedRanges,
  } = props;
  const barRef = useRef<HTMLDivElement | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);
  const [dragging, setDragging] = useState(false);
  const [tooltip, setTooltip] = useState<
    | { kind: "comment"; content: string; ms: number }
    | { kind: "chapter"; title: string; ms: number }
    | null
  >(null);

  const pct = durationMs > 0 ? (currentMs / durationMs) * 100 : 0;

  const recentReactions = useMemo(
    () => (reactions ? reactions.slice(-50) : []),
    [reactions],
  );

  function msFromEvent(e: { clientX: number }): number {
    const el = barRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const ratio = rect.width > 0 ? x / rect.width : 0;
    return Math.floor(ratio * durationMs);
  }

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    setDragging(true);
    const ms = msFromEvent(e);
    onSeek(ms);

    const onMove = (ev: MouseEvent) => {
      onSeek(msFromEvent(ev));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function onHover(e: React.MouseEvent) {
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    setHoverX(x);
    setHoverMs(msFromEvent(e));
  }

  const commentsByMs = useMemo(() => {
    const map = new Map<number, { id: string; content: string }[]>();
    (comments ?? []).forEach((c) => {
      // Bucket by 500ms so overlapping comments cluster.
      const key = Math.round(c.videoTimestampMs / 500) * 500;
      const list = map.get(key) ?? [];
      list.push({ id: c.id, content: c.content });
      map.set(key, list);
    });
    return map;
  }, [comments]);

  return (
    <div className="relative h-10 flex items-center" data-player-ui>
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
          className="absolute -top-10 -translate-x-1/2 max-w-[240px] rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground"
          style={{ left: (tooltip.ms / Math.max(1, durationMs)) * 100 + "%" }}
        >
          {tooltip.kind === "comment" ? tooltip.content : tooltip.title}
        </div>
      ) : null}

      <div
        ref={barRef}
        className="relative w-full h-1.5 bg-white/20 rounded-full cursor-pointer group/bar"
        onMouseDown={onMouseDown}
        onMouseMove={onHover}
        onMouseLeave={() => setHoverMs(null)}
      >
        {/* Filled portion */}
        <div
          className="absolute inset-y-0 left-0 bg-primary rounded-full"
          style={{ width: pct + "%" }}
        />

        {/* Cut ranges */}
        {excludedRanges?.map((range, i) => {
          const startPct =
            (Math.max(0, range.startMs) / Math.max(1, durationMs)) * 100;
          const endPct =
            (Math.min(durationMs, range.endMs) / Math.max(1, durationMs)) * 100;
          return (
            <div
              key={`${range.startMs}-${range.endMs}-${i}`}
              className="absolute inset-y-0 rounded-sm bg-black/70"
              style={{
                left: `${startPct}%`,
                width: `${Math.max(0.5, endPct - startPct)}%`,
                backgroundImage:
                  "repeating-linear-gradient(45deg, rgba(255,255,255,0.2) 0 3px, transparent 3px 7px)",
              }}
              title={`Cut: ${msToClock(range.startMs)}-${msToClock(
                range.endMs,
              )}`}
            />
          );
        })}

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
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-0.5 bg-white/80 hover:h-4 hover:w-1 transition-all"
            style={{
              left: (ch.startMs / Math.max(1, durationMs)) * 100 + "%",
            }}
            aria-label={`Chapter: ${ch.title}`}
          />
        ))}

        {/* Comment dots */}
        {Array.from(commentsByMs.entries()).map(([ms, list]) => (
          <button
            key={ms}
            type="button"
            onMouseEnter={() =>
              setTooltip({
                kind: "comment",
                content: list[0].content.slice(0, 100),
                ms,
              })
            }
            onMouseLeave={() => setTooltip(null)}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(ms);
            }}
            className="absolute -top-1 -translate-x-1/2 h-3.5 w-3.5 rounded-full bg-yellow-400 border-2 border-black/50 hover:scale-125 transition-transform"
            style={{ left: (ms / Math.max(1, durationMs)) * 100 + "%" }}
            aria-label={`${list.length} comment${list.length > 1 ? "s" : ""}`}
          />
        ))}

        {/* Reaction dots */}
        {recentReactions.map((r) => (
          <div
            key={r.id}
            className="absolute -bottom-4 -translate-x-1/2 text-[11px] pointer-events-none"
            style={{
              left: (r.videoTimestampMs / Math.max(1, durationMs)) * 100 + "%",
            }}
          >
            {r.emoji}
          </div>
        ))}

        {/* Thumb */}
        <div
          className={cn(
            "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-white shadow transition-transform",
            dragging ? "scale-125" : "scale-0 group-hover/bar:scale-100",
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
