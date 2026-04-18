import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatMs } from "@/lib/timestamp-mapping";

export interface TimelineChapter {
  startMs: number;
  title: string;
}

export interface TimelineProps {
  width: number;
  durationMs: number;
  /** Current playhead in original ms. */
  playheadMs: number;
  chapters?: TimelineChapter[];
  excludedRanges?: Array<{ startMs: number; endMs: number }>;
  splitPoints?: number[];
  scrollLeft?: number;
  onSeek?: (originalMs: number) => void;
  onClickChapter?: (chapter: TimelineChapter) => void;
  className?: string;
}

const RULER_HEIGHT = 26;

const getBrandColor = () => {
  if (typeof window === "undefined") return "#0f172a";
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
  return v ? `hsl(${v})` : "#0f172a";
};

/** Timestamp ruler + playhead + chapter markers + excluded overlays. */
export function Timeline({
  width,
  durationMs,
  playheadMs,
  chapters = [],
  excludedRanges = [],
  splitPoints = [],
  scrollLeft = 0,
  onSeek,
  onClickChapter,
  className,
}: TimelineProps) {
  const ticks = useMemo(() => {
    if (durationMs <= 0) return [];
    // Target ~1 tick per 100px at the current zoom, rounded to a human interval.
    const targetTickCount = Math.max(4, Math.floor(width / 100));
    const rawInterval = durationMs / targetTickCount;
    const niceIntervals = [
      500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000,
      600_000, 1_800_000, 3_600_000,
    ];
    const interval =
      niceIntervals.find((i) => i >= rawInterval) ??
      niceIntervals[niceIntervals.length - 1];
    const out: Array<{ ms: number; label: string }> = [];
    for (let t = 0; t <= durationMs; t += interval) {
      out.push({ ms: t, label: formatMs(t) });
    }
    return out;
  }, [durationMs, width]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft;
    const ms = Math.max(0, Math.min(durationMs, (x / width) * durationMs));
    onSeek(ms);
  };

  const playheadX = (playheadMs / Math.max(durationMs, 1)) * width;

  return (
    <div className={cn("relative", className)}>
      {/* Ruler */}
      <div
        className="relative border-b border-border bg-card/40 cursor-pointer"
        style={{ width, height: RULER_HEIGHT }}
        onClick={handleSeek}
      >
        {ticks.map((t) => {
          const x = (t.ms / Math.max(durationMs, 1)) * width;
          return (
            <div
              key={t.ms}
              className="absolute top-0 h-full flex items-end text-[10px] text-muted-foreground font-mono select-none"
              style={{ left: x }}
            >
              <div
                className="w-px bg-border"
                style={{ height: RULER_HEIGHT - 10 }}
              />
              <span className="ml-1 mb-[2px]">{t.label}</span>
            </div>
          );
        })}

        {/* Split markers */}
        {splitPoints.map((ms, i) => {
          const x = (ms / Math.max(durationMs, 1)) * width;
          return (
            <div
              key={`split-${i}-${ms}`}
              className="absolute top-0 h-full w-px"
              style={{ left: x, background: "rgba(244,63,94,0.8)" }}
              title={`Split @ ${formatMs(ms)}`}
            />
          );
        })}

        {/* Excluded overlays */}
        {excludedRanges.map((r, i) => {
          const xStart = (r.startMs / Math.max(durationMs, 1)) * width;
          const xEnd = (r.endMs / Math.max(durationMs, 1)) * width;
          return (
            <div
              key={`ex-${i}`}
              className="absolute top-0 h-full pointer-events-none"
              style={{
                left: xStart,
                width: Math.max(1, xEnd - xStart),
                background:
                  "repeating-linear-gradient(-45deg, rgba(15,23,42,0.55) 0 4px, rgba(15,23,42,0.25) 4px 8px)",
              }}
            />
          );
        })}

        {/* Playhead */}
        <div
          className="absolute top-0 h-full pointer-events-none"
          style={{
            left: playheadX - 1,
            width: 2,
            background: getBrandColor(),
          }}
        >
          <div
            className="absolute top-0 -left-[3px] w-2 h-2 rounded-full"
            style={{ background: getBrandColor() }}
          />
        </div>
      </div>

      {/* Chapter markers row */}
      {chapters.length > 0 && (
        <div
          className="relative h-5 border-b border-border bg-card/30"
          style={{ width }}
        >
          {chapters.map((c, i) => {
            const x = (c.startMs / Math.max(durationMs, 1)) * width;
            return (
              <button
                type="button"
                key={`ch-${i}-${c.startMs}`}
                onClick={() => onClickChapter?.(c)}
                className="absolute top-0 h-full px-2 text-[10px] text-foreground/80 hover:bg-foreground/10 flex items-center border-l border-border"
                style={{ left: x, maxWidth: 140 }}
                title={`${c.title} · ${formatMs(c.startMs)}`}
              >
                <span className="truncate">{c.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
