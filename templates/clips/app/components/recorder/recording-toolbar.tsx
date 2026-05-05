import { useEffect, useRef, useState } from "react";
import {
  IconConfetti,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconX,
} from "@tabler/icons-react";
import {
  clampToViewport,
  snapToCorner,
  type BubblePosition,
} from "./camera-positioner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface RecordingToolbarProps {
  elapsedMs: number;
  isPaused: boolean;
  isDrawing: boolean;
  onTogglePause: () => void;
  onStop: () => void;
  onToggleDrawing: () => void;
  onConfetti: () => void;
  onCancel: () => void;
}

const TOOLBAR_WIDTH = 320;
const TOOLBAR_HEIGHT = 56;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function RecordingToolbar({
  elapsedMs,
  isPaused,
  isDrawing,
  onTogglePause,
  onStop,
  onToggleDrawing,
  onConfetti,
  onCancel,
}: RecordingToolbarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<BubblePosition>(() =>
    typeof window === "undefined"
      ? { left: 16, top: 16, corner: "tl" }
      : {
          left: Math.max(16, (window.innerWidth - TOOLBAR_WIDTH) / 2),
          top: window.innerHeight - TOOLBAR_HEIGHT - 32,
          corner: "bl",
        },
  );
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });

  useEffect(() => {
    function onResize() {
      setPos((p) =>
        snapToCorner(p.left, p.top, Math.max(TOOLBAR_WIDTH, TOOLBAR_HEIGHT), {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-toolbar-btn]")) return;
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    dragOffsetRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
    };
    setDragging(true);
    rootRef.current.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const { dx, dy } = dragOffsetRef.current;
    const left = e.clientX - dx;
    const top = e.clientY - dy;
    const clamped = clampToViewport(
      left,
      top,
      Math.max(TOOLBAR_WIDTH, TOOLBAR_HEIGHT),
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos((prev) => ({ ...prev, left: clamped.left, top: clamped.top }));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!rootRef.current) return;
    rootRef.current.releasePointerCapture(e.pointerId);
    setDragging(false);
  }

  const bg = isPaused ? "bg-amber-500 text-black" : "bg-black/85 text-white";

  return (
    <div
      ref={rootRef}
      role="toolbar"
      aria-label="Recording controls"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={
        "fixed z-[95] flex items-center gap-1 rounded-full px-3 py-2 shadow-2xl backdrop-blur " +
        bg +
        (dragging ? " cursor-grabbing" : " cursor-grab")
      }
      style={{
        left: pos.left,
        top: pos.top,
        minWidth: TOOLBAR_WIDTH,
        height: TOOLBAR_HEIGHT,
        touchAction: "none",
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-toolbar-btn
            type="button"
            onClick={onTogglePause}
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15"
            aria-label={isPaused ? "Resume recording" : "Pause recording"}
          >
            {isPaused ? (
              <IconPlayerPlay className="h-4 w-4" />
            ) : (
              <IconPlayerPause className="h-4 w-4" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {isPaused ? "Resume (⌥⇧P)" : "Pause (⌥⇧P)"}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-toolbar-btn
            type="button"
            onClick={onStop}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
            aria-label="Stop recording"
          >
            <IconPlayerStop className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Stop recording</TooltipContent>
      </Tooltip>

      <div
        className="mx-2 flex h-9 items-center gap-2 rounded-full bg-white/10 px-3 text-sm font-mono tabular-nums"
        aria-label="Elapsed time"
      >
        <span
          className="inline-block h-2 w-2 rounded-full bg-red-500"
          style={{
            animation: isPaused ? "none" : "pulse 1s ease-in-out infinite",
          }}
        />
        {formatElapsed(elapsedMs)}
        {isPaused && (
          <span className="text-[10px] uppercase tracking-wide">Paused</span>
        )}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-toolbar-btn
            type="button"
            onClick={onToggleDrawing}
            className={
              "flex h-9 w-9 items-center justify-center rounded-full " +
              (isDrawing
                ? "bg-primary text-primary-foreground"
                : "hover:bg-white/15")
            }
            aria-label="Toggle drawing"
            aria-pressed={isDrawing}
          >
            <IconPencil className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Draw (⌘⇧D)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-toolbar-btn
            type="button"
            onClick={onConfetti}
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15"
            aria-label="Confetti"
          >
            <IconConfetti className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Confetti (⌃⌘C)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-toolbar-btn
            type="button"
            onClick={onCancel}
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15"
            aria-label="Cancel recording"
          >
            <IconX className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Cancel (⌥⇧C)</TooltipContent>
      </Tooltip>
    </div>
  );
}
