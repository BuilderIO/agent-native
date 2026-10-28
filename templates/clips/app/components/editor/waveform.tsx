import { useEffect, useMemo, useRef } from "react";

import { cn } from "@/lib/utils";
import type { FilmstripFrame, FilmstripSprite } from "@/lib/video-filmstrip";
import type { WaveformPeaks } from "@/lib/waveform-peaks";

import { getTimelineTotalWidth } from "./timeline-geometry";

export interface WaveformProps {
  peaks: WaveformPeaks | null;
  sprite?: FilmstripSprite | null;
  frames?: FilmstripFrame[];
  width: number;
  height?: number;
  zoom?: number;
  playheadMs: number;
  durationMs: number;
  excludedRanges?: Array<{ startMs: number; endMs: number }>;
  activityRanges?: Array<{ startMs: number; endMs: number }>;
  onSeek?: (originalMs: number) => void;
  scrollLeft?: number;
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

const getWaveColor = (overImagery = false) =>
  getBrandColorAlpha(overImagery ? 0.98 : 0.85);
const getQuietColor = (overImagery = false) =>
  // guard:allow-raw-color — as above: read against the frames, not the theme.
  overImagery ? "rgba(226, 232, 240, 0.45)" : getBrandColorAlpha(0.2);
const getWaveBg = () => getBrandColorAlpha(0.08);
/** Darkens the band behind the bars when they sit over filmstrip frames. */
// guard:allow-raw-color — a scrim over video frames, which are whatever the recording holds; it has to darken them in either theme.
const WAVE_SCRIM = "rgba(2, 6, 23, 0.46)";
const EXCLUDED_FILL = "rgba(15, 23, 42, 0.65)";
const EXCLUDED_STROKE = "rgba(148, 163, 184, 0.4)";
const EMPTY_FRAMES: FilmstripFrame[] = [];
const VISUAL_TARGET_PEAK = 0.78;
const VISUAL_MAX_GAIN = 24;
const VISUAL_GAIN_PERCENTILE = 0.95;
const VISUAL_SILENCE_FLOOR = 0.001;

const MAX_CANVAS_PIXELS_WIDTH = 4096;

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

function drawPillBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const radius = Math.min(width / 2, height / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
  } else {
    ctx.rect(x, y, width, height);
  }
  ctx.fill();
}

export function Waveform({
  peaks,
  sprite,
  frames = EMPTY_FRAMES,
  width,
  height = 120,
  zoom = 1,
  playheadMs,
  durationMs,
  excludedRanges,
  activityRanges = [],
  onSeek,
  scrollLeft = 0,
  onScroll,
  className,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const totalWidth = getTimelineTotalWidth(width, zoom);

  const spriteCells = useMemo(() => {
    if (!sprite?.url || sprite.frameCount <= 0 || sprite.columns <= 0)
      return [];
    const aspect =
      sprite.frameHeight > 0 ? sprite.frameWidth / sprite.frameHeight : 16 / 9;
    const cellWidth = Math.max(24, height * aspect);
    const count = Math.max(
      1,
      Math.min(sprite.frameCount, Math.round(totalWidth / cellWidth)),
    );
    return Array.from({ length: count }, (_, i) => {
      const frame = Math.min(
        sprite.frameCount - 1,
        Math.floor(((i + 0.5) * sprite.frameCount) / count),
      );
      return {
        key: `${i}-${frame}`,
        column: frame % sprite.columns,
        row: Math.floor(frame / sprite.columns),
      };
    });
  }, [sprite, totalWidth, height]);

  const hasImagery = spriteCells.length > 0 || frames.length > 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min(scrollLeft, totalWidth - width));
    if (Math.abs(el.scrollLeft - next) > 0.5) {
      el.scrollLeft = next;
    }
  }, [scrollLeft, totalWidth, width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.min(
      MAX_CANVAS_PIXELS_WIDTH,
      Math.floor(totalWidth * dpr),
    );
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${totalWidth}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scaleX = canvas.width / totalWidth;
    ctx.setTransform(scaleX, 0, 0, dpr, 0, 0);

    const hasPeaks = Boolean(
      peaks?.bucketCount &&
      peaks.peaks.some((value) => Math.abs(value) > 0.0001),
    );

    ctx.clearRect(0, 0, totalWidth, height);
    if (hasImagery) {
      const bandHeight = Math.min(height, Math.max(28, height * 0.62));
      ctx.fillStyle = WAVE_SCRIM;
      ctx.fillRect(0, (height - bandHeight) / 2, totalWidth, bandHeight);
    } else {
      ctx.fillStyle = getWaveBg();
      ctx.fillRect(0, 0, totalWidth, height);
    }

    const barWidth = 3;
    const barGap = 1.5;
    const step = barWidth + barGap;
    const barCount = Math.floor(totalWidth / step);
    const maxWaveHeight = Math.min(height * 0.5, 52);
    const minBarHeight = 3;
    const midY = height / 2;

    if (peaks && hasPeaks) {
      const visualGain = computeVisualGain(peaks.peaks);
      const bucketsPerBar = peaks.bucketCount / barCount;

      for (let i = 0; i < barCount; i++) {
        const x = i * step;
        const startBucket = Math.floor(i * bucketsPerBar);
        const endBucket = Math.max(
          startBucket + 1,
          Math.floor((i + 1) * bucketsPerBar),
        );

        let maxAmp = 0;
        for (let b = startBucket; b < endBucket && b < peaks.bucketCount; b++) {
          const lo = Math.abs(peaks.peaks[b * 2] ?? 0);
          const hi = Math.abs(peaks.peaks[b * 2 + 1] ?? 0);
          if (lo > maxAmp) maxAmp = lo;
          if (hi > maxAmp) maxAmp = hi;
        }

        const scaledAmp = clampSample(maxAmp * visualGain);
        const barHeight = Math.max(minBarHeight, scaledAmp * maxWaveHeight);
        const topY = midY - barHeight / 2;

        ctx.fillStyle =
          maxAmp > VISUAL_SILENCE_FLOOR
            ? getWaveColor(hasImagery)
            : getQuietColor(hasImagery);

        drawPillBar(ctx, x, topY, barWidth, barHeight);
      }
    } else {
      for (let i = 0; i < barCount; i++) {
        const x = i * step;
        const barMs = (i / Math.max(1, barCount)) * durationMs;
        const inActivity = activityRanges.some(
          (r) => barMs >= r.startMs && barMs <= r.endMs,
        );

        const barHeight = inActivity ? 12 : minBarHeight;
        const topY = midY - barHeight / 2;

        ctx.fillStyle = inActivity
          ? getWaveColor(hasImagery)
          : getQuietColor(hasImagery);

        drawPillBar(ctx, x, topY, barWidth, barHeight);
      }
    }

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
  }, [
    peaks,
    hasImagery,
    totalWidth,
    height,
    excludedRanges,
    durationMs,
    activityRanges,
  ]);

  const scrubRef = useRef<{ pointerId: number; startX: number } | null>(null);

  const seekToEvent = (
    e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>, // i18n-ignore
  ) => {
    if (!onSeek) return;
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scroll = el.scrollLeft;
    const x = e.clientX - rect.left + scroll;
    const ms = Math.max(0, Math.min(durationMs, (x / totalWidth) * durationMs));
    onSeek(ms);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onSeek || e.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;
    if (e.clientY - el.getBoundingClientRect().top >= el.clientHeight) return;
    scrubRef.current = { pointerId: e.pointerId, startX: e.clientX };
    if (e.pointerType === "touch") return;
    el.setPointerCapture(e.pointerId);
    seekToEvent(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.pointerId !== e.pointerId) return;
    if (e.pointerType === "touch") return;
    seekToEvent(e);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.pointerId !== e.pointerId) return;
    scrubRef.current = null;
    const el = scrollRef.current;
    if (el?.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    if (e.pointerType === "touch" && Math.abs(e.clientX - scrub.startX) < 8) {
      seekToEvent(e);
    }
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    onScroll?.(el.scrollLeft, totalWidth);
  };

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
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="relative" style={{ width: totalWidth, height }}>
        {spriteCells.length > 0 && sprite ? (
          <div className="absolute inset-0 flex overflow-hidden pointer-events-none">
            {spriteCells.map((cell) => (
              <div
                key={cell.key}
                className="h-full animate-in fade-in duration-500"
                style={{
                  width: `${100 / spriteCells.length}%`,
                  backgroundImage: `url(${sprite.url})`,
                  backgroundSize: `${sprite.columns * 100}% ${sprite.rows * 100}%`,
                  backgroundPosition: `${
                    sprite.columns > 1
                      ? (cell.column * 100) / (sprite.columns - 1)
                      : 0
                  }% ${
                    sprite.rows > 1 ? (cell.row * 100) / (sprite.rows - 1) : 0
                  }%`,
                  backgroundRepeat: "no-repeat",
                }}
              />
            ))}
          </div>
        ) : (
          frames.length > 0 && (
            <div className="absolute inset-0 flex overflow-hidden pointer-events-none">
              {frames.map((frame) => (
                <img
                  key={frame.timeMs}
                  src={frame.dataUrl}
                  alt=""
                  className="h-full object-cover animate-in fade-in duration-500"
                  style={{ width: `${100 / frames.length}%` }}
                />
              ))}
            </div>
          )
        )}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none"
        />
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
