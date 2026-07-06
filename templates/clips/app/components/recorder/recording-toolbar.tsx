import { useT } from "@agent-native/core/client";
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { clampRectToViewport, type BubblePosition } from "./camera-positioner";

export interface RecordingToolbarProps {
  elapsedMs: number;
  isPaused: boolean;
  onTogglePause: () => void;
  onStop: () => void;
  onCancel: () => void;
}

const TOOLBAR_WIDTH = 232;
const TOOLBAR_HEIGHT = 56;
// Drop the toolbar just below the centered "Recording your screen…" status
// text (which sits at the viewport's vertical center) so the controls don't
// overlap it.
const TOOLBAR_TOP_OFFSET = 48;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function RecordingToolbar({
  elapsedMs,
  isPaused,
  onTogglePause,
  onStop,
  onCancel,
}: RecordingToolbarProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<BubblePosition>(() =>
    typeof window === "undefined"
      ? { left: 16, top: 16, corner: "tl" }
      : {
          left: Math.max(16, (window.innerWidth - TOOLBAR_WIDTH) / 2),
          top: Math.max(16, window.innerHeight / 2 + TOOLBAR_TOP_OFFSET),
          corner: "tl",
        },
  );
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });

  useEffect(() => {
    function onResize() {
      setPos((p) => {
        const clamped = clampRectToViewport(
          p.left,
          p.top,
          { width: TOOLBAR_WIDTH, height: TOOLBAR_HEIGHT },
          {
            width: window.innerWidth,
            height: window.innerHeight,
          },
        );
        return {
          ...p,
          left: clamped.left,
          top: clamped.top,
        };
      });
    }
    window.addEventListener("resize", onResize);
    onResize();
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
    const clamped = clampRectToViewport(
      left,
      top,
      { width: TOOLBAR_WIDTH, height: TOOLBAR_HEIGHT },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos((prev) => ({ ...prev, left: clamped.left, top: clamped.top }));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!rootRef.current) return;
    rootRef.current.releasePointerCapture(e.pointerId);
    setDragging(false);
  }

  const bg = isPaused ? "bg-white text-black" : "bg-black/85 text-white";

  return (
    <div
      ref={rootRef}
      role="toolbar"
      aria-label={t("recordingToolbar.controls")}
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
            aria-label={
              isPaused
                ? t("recordingToolbar.resumeRecording")
                : t("recordingToolbar.pauseRecording")
            }
          >
            {isPaused ? (
              <IconPlayerPlay className="h-4 w-4" />
            ) : (
              <IconPlayerPause className="h-4 w-4" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {isPaused
            ? t("recordingToolbar.resumeShortcut")
            : t("recordingToolbar.pauseShortcut")}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-toolbar-btn
            type="button"
            onClick={onStop}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black hover:bg-white/85"
            aria-label={t("recordingToolbar.stop")}
          >
            <IconPlayerStop className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("recordingToolbar.stop")}</TooltipContent>
      </Tooltip>

      <div
        className="mx-2 flex h-9 items-center gap-2 rounded-full bg-white/10 px-3 text-sm font-mono tabular-nums"
        aria-label={t("recordingToolbar.elapsed")}
      >
        <span
          className="inline-block h-2 w-2 rounded-full bg-white"
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
            onClick={onCancel}
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15"
            aria-label={t("recordingToolbar.cancel")}
          >
            <IconX className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("recordingToolbar.cancelShortcut")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
