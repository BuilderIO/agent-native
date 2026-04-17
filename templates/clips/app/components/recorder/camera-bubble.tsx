import { useEffect, useRef, useState } from "react";
import { IconCamera } from "@tabler/icons-react";
import {
  clampToViewport,
  initialBubblePosition,
  snapToCorner,
  type BubblePosition,
} from "./camera-positioner";

export type CameraBubbleSize = "sm" | "md" | "lg";

const SIZE_MAP: Record<CameraBubbleSize, number> = {
  sm: 120,
  md: 200,
  lg: 320,
};

export interface CameraBubbleProps {
  stream: MediaStream | null;
  size?: CameraBubbleSize;
  onSizeChange?: (size: CameraBubbleSize) => void;
  hidden?: boolean;
}

export function CameraBubble({
  stream,
  size = "md",
  onSizeChange,
  hidden,
}: CameraBubbleProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const sizePx = SIZE_MAP[size];

  const [pos, setPos] = useState<BubblePosition>(() =>
    typeof window === "undefined"
      ? { left: 16, top: 16, corner: "bl" }
      : initialBubblePosition(sizePx, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
  );
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });

  useEffect(() => {
    if (!videoRef.current) return;
    if (stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {
        // autoplay may be blocked; preview will recover on user interaction.
      });
    } else {
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  // Re-snap when size or window changes.
  useEffect(() => {
    function handleResize() {
      setPos((p) =>
        snapToCorner(p.left, p.top, sizePx, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    }
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, [sizePx]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!bubbleRef.current) return;
    const rect = bubbleRef.current.getBoundingClientRect();
    dragOffsetRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
    };
    setDragging(true);
    bubbleRef.current.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const { dx, dy } = dragOffsetRef.current;
    const proposedLeft = e.clientX - dx;
    const proposedTop = e.clientY - dy;
    const clamped = clampToViewport(proposedLeft, proposedTop, sizePx, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    setPos((prev) => ({ ...prev, left: clamped.left, top: clamped.top }));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!bubbleRef.current) return;
    bubbleRef.current.releasePointerCapture(e.pointerId);
    setDragging(false);
    setPos((p) =>
      snapToCorner(p.left, p.top, sizePx, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }

  function cycleSize() {
    if (!onSizeChange) return;
    const order: CameraBubbleSize[] = ["sm", "md", "lg"];
    const idx = order.indexOf(size);
    onSizeChange(order[(idx + 1) % order.length]);
  }

  if (hidden) return null;

  return (
    <div
      ref={bubbleRef}
      role="presentation"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={cycleSize}
      className="fixed z-[90] cursor-grab select-none rounded-full border-4 border-white/80 bg-black shadow-2xl active:cursor-grabbing"
      style={{
        width: sizePx,
        height: sizePx,
        left: pos.left,
        top: pos.top,
        touchAction: "none",
        boxShadow: "0 10px 40px rgba(0,0,0,0.4), 0 0 0 2px rgba(98,93,245,0.6)",
      }}
    >
      {stream ? (
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="h-full w-full rounded-full object-cover [transform:scaleX(-1)]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-full text-white/60">
          <IconCamera className="h-8 w-8" />
        </div>
      )}
    </div>
  );
}
