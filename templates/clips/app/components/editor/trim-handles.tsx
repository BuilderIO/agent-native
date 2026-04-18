import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatMs } from "@/lib/timestamp-mapping";

export interface TrimHandlesProps {
  /** Total width of the track in px (matches the waveform's totalWidth). */
  width: number;
  height?: number;
  /** Current selection range (original ms) — drives the left/right handles. */
  value: { startMs: number; endMs: number };
  onChange: (next: { startMs: number; endMs: number }) => void;
  /** Fires when the user releases the mouse after drag — triggers trim-recording. */
  onCommit?: (value: { startMs: number; endMs: number }) => void;
  durationMs: number;
  /** Scroll offset of the parent container so handles track with zoom. */
  scrollLeft?: number;
  className?: string;
}

type DragMode = "start" | "end" | "range" | null;

const HANDLE_WIDTH = 12;

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

/** Drag handles for marking a trim range over the waveform. */
export function TrimHandles({
  width,
  height = 120,
  value,
  onChange,
  onCommit,
  durationMs,
  scrollLeft = 0,
  className,
}: TrimHandlesProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const dragOffsetRef = useRef(0);

  const toMs = useCallback(
    (clientX: number) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const x = clientX - rect.left + scrollLeft;
      return Math.max(0, Math.min(durationMs, (x / width) * durationMs));
    },
    [scrollLeft, durationMs, width],
  );

  const startDrag = (mode: DragMode) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragMode(mode);
    if (mode === "range") {
      dragOffsetRef.current = toMs(e.clientX) - value.startMs;
    }
  };

  // Global pointer handlers so we don't lose drag if cursor leaves element.
  useEffect(() => {
    if (!dragMode) return;
    const handleMove = (e: PointerEvent) => {
      const ms = toMsFromEvent(e);
      if (ms == null) return;
      let nextStart = value.startMs;
      let nextEnd = value.endMs;
      if (dragMode === "start") {
        nextStart = Math.min(ms, value.endMs);
      } else if (dragMode === "end") {
        nextEnd = Math.max(ms, value.startMs);
      } else if (dragMode === "range") {
        const dur = value.endMs - value.startMs;
        nextStart = Math.max(
          0,
          Math.min(durationMs - dur, ms - dragOffsetRef.current),
        );
        nextEnd = nextStart + dur;
      }
      onChange({ startMs: nextStart, endMs: nextEnd });
    };
    const handleUp = () => {
      setDragMode(null);
      onCommit?.(value);
    };
    const toMsFromEvent = (e: PointerEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const x = e.clientX - rect.left + scrollLeft;
      return Math.max(0, Math.min(durationMs, (x / width) * durationMs));
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragMode, value, onChange, onCommit, scrollLeft, durationMs, width]);

  const startX = (value.startMs / Math.max(durationMs, 1)) * width;
  const endX = (value.endMs / Math.max(durationMs, 1)) * width;

  return (
    <div
      ref={rootRef}
      className={cn("relative pointer-events-none", className)}
      style={{ width, height }}
    >
      {/* Range bar (draggable) */}
      <div
        className="absolute top-0 h-full pointer-events-auto cursor-grab active:cursor-grabbing"
        style={{
          left: startX,
          width: Math.max(2, endX - startX),
          background: getBrandColorAlpha(0.18),
          borderTop: `1px solid ${getBrandColor()}`,
          borderBottom: `1px solid ${getBrandColor()}`,
        }}
        onPointerDown={startDrag("range")}
      >
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full bg-foreground text-background text-[10px] px-1.5 py-0.5 rounded font-mono whitespace-nowrap">
          {formatMs(value.endMs - value.startMs)}
        </div>
      </div>

      {/* Left handle */}
      <div
        className="absolute top-0 h-full pointer-events-auto cursor-ew-resize flex items-center justify-center"
        style={{
          left: startX - HANDLE_WIDTH / 2,
          width: HANDLE_WIDTH,
          background: getBrandColor(),
          borderRadius: "2px 0 0 2px",
        }}
        onPointerDown={startDrag("start")}
      >
        <div className="w-[2px] h-4 bg-white/80 rounded" />
      </div>

      {/* Right handle */}
      <div
        className="absolute top-0 h-full pointer-events-auto cursor-ew-resize flex items-center justify-center"
        style={{
          left: endX - HANDLE_WIDTH / 2,
          width: HANDLE_WIDTH,
          background: getBrandColor(),
          borderRadius: "0 2px 2px 0",
        }}
        onPointerDown={startDrag("end")}
      >
        <div className="w-[2px] h-4 bg-white/80 rounded" />
      </div>
    </div>
  );
}
