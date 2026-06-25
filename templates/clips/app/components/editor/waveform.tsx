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
  /** Transcript-backed activity ranges used when browser audio decoding fails. */
  activityRanges?: Array<{ startMs: number; endMs: number }>;
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
const VISUAL_TARGET_PEAK = 0.78;
const VISUAL_MAX_GAIN = 24;
const VISUAL_GAIN_PERCENTILE = 0.95;
const VISUAL_SILENCE_FLOOR = 0.001;

function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function computeVisualGain(samples: number[]): number {
  const amplitudes = samples
    .map((value) => Math.abs(value))
    .filter((value) => value > VISUAL_SILENCE_FLOOR)
    .sort((a, b) => a - b);

  if (amplitudes.length === 0) return 1;

  const index = Math.min(
    amplitudes.length - 1,
    Math.floor(amplitudes.length * VISUAL_GAIN_PERCENTILE),
  );
  const reference = amplitudes[index] ?? amplitudes[amplitudes.length - 1];
  if (!reference || reference >= VISUAL_TARGET_PEAK) return 1;

  return Math.min(VISUAL_MAX_GAIN, VISUAL_TARGET_PEAK / reference);
}

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
  activityRanges = [],
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

    const hasPeaks = Boolean(
      peaks?.bucketCount &&
      peaks.peaks.some((value) => Math.abs(value) > 0.0001),
    );

    if (peaks && hasPeaks) {
      // Map each x pixel to a bucket range. Use a visual-only auto-gain so
      // quiet microphone recordings still read clearly in the trim track.
      const mid = height / 2;
      const visualGain = computeVisualGain(peaks.peaks);
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
        let topY = mid + clampSample(min * visualGain) * mid * 0.95;
        let botY = mid + clampSample(max * visualGain) * mid * 0.95;
        if (
          Math.max(Math.abs(min), Math.abs(max)) > VISUAL_SILENCE_FLOOR &&
          botY - topY < 2
        ) {
          const centerY = (topY + botY) / 2;
          topY = centerY - 1;
          botY = centerY + 1;
        }
        ctx.moveTo(x + 0.5, topY);
        ctx.lineTo(x + 0.5, botY);
      }
      ctx.stroke();
    } else {
      const mid = height / 2;
      ctx.strokeStyle = getBrandColorAlpha(0.2);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(totalWidth, mid);
      ctx.stroke();
      ctx.setLineDash([]);

      if (activityRanges.length) {
        const blockHeight = Math.max(18, Math.min(32, height * 0.32));
        const top = mid - blockHeight / 2;
        ctx.fillStyle = getBrandColorAlpha(0.24);
        for (const range of activityRanges) {
          const xStart =
            (Math.max(0, range.startMs) / Math.max(durationMs, 1)) * totalWidth;
          const xEnd =
            (Math.min(durationMs, range.endMs) / Math.max(durationMs, 1)) *
            totalWidth;
          ctx.fillRect(xStart, top, Math.max(2, xEnd - xStart), blockHeight);
        }
      }
    }

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
  }, [
    peaks,
    totalWidth,
    height,
    excludedRanges,
    selectionRange,
    durationMs,
    activityRanges,
  ]);

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
