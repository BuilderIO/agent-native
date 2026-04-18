import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import type { WaveformPeaks } from "@/lib/waveform-peaks";

export interface WaveformProps {
  /** Peaks computed via `computePeaks()`. */
  peaks: WaveformPeaks | null;
  /** Width in px of the viewport (the scroll container). */
  width: number;
  /** Height in px. */
  height?: number;
  /** Horizontal zoom — 1 = fit; up to 50x per editor spec. */
  zoom?: number;
  /** Current playhead in original ms. */
  playheadMs: number;
  /** Total duration in ms. */
  durationMs: number;
  /** Excluded ranges (original time) — drawn as striped overlays. */
  excludedRanges?: Array<{ startMs: number; endMs: number }>;
  /** Optional selection range (original time) highlighted in brand color. */
  selectionRange?: { startMs: number; endMs: number } | null;
  /** Click handler — returns the original ms at the click position. */
  onSeek?: (originalMs: number) => void;
  /** Called on scroll so the parent can sync ruler / chapter markers. */
  onScroll?: (scrollLeft: number, totalWidth: number) => void;
  className?: string;
}

const getBrandColor = () => {
  if (typeof window === "undefined") return "#0f172a";
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
  return v ? `hsl(${v})` : "#0f172a";
};

const getBrandColorAlpha = (alpha: number) => {
  if (typeof window === "undefined") return `rgba(15, 23, 42, ${alpha})`;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
  return v ? `hsl(${v} / ${alpha})` : `rgba(15, 23, 42, ${alpha})`;
};

const getWaveColor = () => getBrandColorAlpha(0.55);
const getWaveBg = () => getBrandColorAlpha(0.12);
const EXCLUDED_FILL = "rgba(15, 23, 42, 0.72)";
const EXCLUDED_STROKE = "rgba(148, 163, 184, 0.45)";

/** Canvas-rendered waveform. Supports up to 50x zoom with horizontal scroll. */
export function Waveform({
  peaks,
  width,
  height = 120,
  zoom = 1,
  playheadMs,
  durationMs,
  excludedRanges,
  selectionRange,
  onSeek,
  onScroll,
  className,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // The total drawable width (scrolls horizontally). zoom=1 fits exactly.
  const totalWidth = Math.max(width, Math.floor(width * Math.max(1, zoom)));

  // Re-draw whenever peaks, size, or excluded ranges change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(totalWidth * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${totalWidth}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = getWaveBg();
    ctx.fillRect(0, 0, totalWidth, height);

    if (!peaks || peaks.bucketCount === 0) {
      ctx.fillStyle = "rgba(148,163,184,0.45)";
      ctx.font = "12px Inter, sans-serif";
      ctx.fillText("No audio available for this recording", 12, height / 2 + 4);
      return;
    }

    // Map each x pixel to a bucket range. Use max abs so silent gaps stay visible.
    const mid = height / 2;
    ctx.strokeStyle = getWaveColor();
    ctx.lineWidth = 1;
    ctx.beginPath();
    const bucketsPerPx = peaks.bucketCount / totalWidth;
    for (let x = 0; x < totalWidth; x++) {
      const startBucket = Math.floor(x * bucketsPerPx);
      const endBucket = Math.max(
        startBucket + 1,
        Math.floor((x + 1) * bucketsPerPx),
      );
      let min = 0;
      let max = 0;
      for (let b = startBucket; b < endBucket && b < peaks.bucketCount; b++) {
        const lo = peaks.peaks[b * 2];
        const hi = peaks.peaks[b * 2 + 1];
        if (lo < min) min = lo;
        if (hi > max) max = hi;
      }
      const topY = mid + min * mid * 0.95;
      const botY = mid + max * mid * 0.95;
      ctx.moveTo(x + 0.5, topY);
      ctx.lineTo(x + 0.5, botY);
    }
    ctx.stroke();

    // Excluded ranges — dimmed striped overlay
    if (excludedRanges?.length) {
      for (const r of excludedRanges) {
        const xStart = (r.startMs / Math.max(durationMs, 1)) * totalWidth;
        const xEnd = (r.endMs / Math.max(durationMs, 1)) * totalWidth;
        ctx.fillStyle = EXCLUDED_FILL;
        ctx.fillRect(xStart, 0, xEnd - xStart, height);
        ctx.strokeStyle = EXCLUDED_STROKE;
        ctx.lineWidth = 1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(xStart, 0, xEnd - xStart, height);
        ctx.clip();
        for (let x = xStart - height; x < xEnd; x += 8) {
          ctx.beginPath();
          ctx.moveTo(x, height);
          ctx.lineTo(x + height, 0);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Selection overlay
    if (selectionRange) {
      const xStart =
        (Math.min(selectionRange.startMs, selectionRange.endMs) /
          Math.max(durationMs, 1)) *
        totalWidth;
      const xEnd =
        (Math.max(selectionRange.startMs, selectionRange.endMs) /
          Math.max(durationMs, 1)) *
        totalWidth;
      ctx.fillStyle = getBrandColorAlpha(0.28);
      ctx.fillRect(xStart, 0, xEnd - xStart, height);
      ctx.strokeStyle = getBrandColor();
      ctx.lineWidth = 1;
      ctx.strokeRect(xStart + 0.5, 0.5, xEnd - xStart - 1, height - 1);
    }
  }, [peaks, totalWidth, height, excludedRanges, selectionRange, durationMs]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = (
      e.currentTarget.firstElementChild as HTMLElement
    )?.getBoundingClientRect();
    if (!rect) return;
    const scroll = scrollRef.current?.scrollLeft ?? 0;
    const x = e.clientX - rect.left + scroll;
    const ms = Math.max(0, Math.min(durationMs, (x / totalWidth) * durationMs));
    onSeek(ms);
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    onScroll?.(el.scrollLeft, totalWidth);
  };

  // Playhead position
  const playheadX = useMemo(
    () => (playheadMs / Math.max(durationMs, 1)) * totalWidth,
    [playheadMs, durationMs, totalWidth],
  );

  return (
    <div
      ref={scrollRef}
      className={cn(
        "relative overflow-x-auto overflow-y-hidden border border-border rounded-md bg-background",
        className,
      )}
      style={{ width, height }}
      onScroll={handleScroll}
      onClick={handleClick}
    >
      <div className="relative" style={{ width: totalWidth, height }}>
        <canvas ref={canvasRef} />
        <div
          className="absolute top-0 h-full w-[2px] pointer-events-none"
          style={{
            left: playheadX,
            background: getBrandColor(),
            boxShadow: `0 0 0 1px ${getBrandColorAlpha(0.25)}`,
          }}
        />
      </div>
    </div>
  );
}
