import { useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

export interface WaveformProps {
  callId: string;
  durationMs: number;
  currentMs: number;
  onSeek: (ms: number) => void;
  peaks?: number[];
  className?: string;
  height?: number;
  bars?: number;
}

export function Waveform(props: WaveformProps) {
  const {
    callId,
    durationMs,
    currentMs,
    onSeek,
    peaks,
    className,
    height = 48,
    bars = 240,
  } = props;
  const ref = useRef<HTMLDivElement | null>(null);

  const silhouette = useMemo(
    () => peaks ?? synthesizePeaks(callId, bars, durationMs),
    [peaks, callId, bars, durationMs],
  );

  const pct = durationMs > 0 ? (currentMs / durationMs) * 100 : 0;

  function msFromEvent(clientX: number) {
    const el = ref.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const ratio = rect.width > 0 ? x / rect.width : 0;
    return Math.floor(ratio * durationMs);
  }

  return (
    <div
      ref={ref}
      className={cn(
        "relative w-full select-none cursor-pointer group",
        className,
      )}
      style={{ height }}
      onMouseDown={(e) => {
        e.preventDefault();
        onSeek(msFromEvent(e.clientX));
        const onMove = (ev: MouseEvent) => onSeek(msFromEvent(ev.clientX));
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${silhouette.length} ${height}`}
        preserveAspectRatio="none"
        className="absolute inset-0"
      >
        <g>
          {silhouette.map((p, i) => {
            const h = Math.max(2, p * (height - 4));
            const y = (height - h) / 2;
            return (
              <rect
                key={i}
                x={i + 0.15}
                y={y}
                width={0.7}
                height={h}
                fill="hsl(var(--muted-foreground) / 0.45)"
              />
            );
          })}
        </g>
        <defs>
          <clipPath id={`wf-progress-${callId}`}>
            <rect
              x={0}
              y={0}
              width={(silhouette.length * pct) / 100}
              height={height}
            />
          </clipPath>
        </defs>
        <g clipPath={`url(#wf-progress-${callId})`}>
          {silhouette.map((p, i) => {
            const h = Math.max(2, p * (height - 4));
            const y = (height - h) / 2;
            return (
              <rect
                key={i}
                x={i + 0.15}
                y={y}
                width={0.7}
                height={h}
                fill="hsl(var(--foreground))"
              />
            );
          })}
        </g>
      </svg>
      <div
        className="absolute top-0 bottom-0 w-px bg-foreground pointer-events-none"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

function synthesizePeaks(
  seed: string,
  count: number,
  durationMs: number,
): number[] {
  const rand = mulberry32(hashString(seed) ^ Math.max(1, durationMs));
  const out = new Array<number>(count);
  let prev = 0.5;
  for (let i = 0; i < count; i++) {
    const wave = 0.35 + 0.25 * Math.sin(i * 0.18) + 0.15 * Math.sin(i * 0.05);
    const jitter = (rand() - 0.5) * 0.6;
    const val = clamp01(prev * 0.35 + wave * 0.55 + jitter * 0.4);
    out[i] = val;
    prev = val;
  }
  return out;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
