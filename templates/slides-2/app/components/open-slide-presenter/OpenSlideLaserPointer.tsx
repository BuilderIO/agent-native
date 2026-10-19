import { useEffect, useRef, useState } from "react";

type Props = {
  enabled: boolean;
  onPointerMoveHandlerChange: (
    handler: ((position: { x: number; y: number }) => void) | null,
  ) => void;
};

export default function OpenSlideLaserPointer({
  enabled,
  onPointerMoveHandlerChange,
}: Props) {
  const dotRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const [tracking, setTracking] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setTracking(false);
      positionRef.current = null;
      onPointerMoveHandlerChange(null);
      return;
    }

    const trackPosition = (position: { x: number; y: number }) => {
      positionRef.current = position;
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          const dot = dotRef.current;
          const position = positionRef.current;
          if (dot && position) {
            dot.style.transform = `translate3d(${position.x - 9}px, ${position.y - 9}px, 0)`;
          }
        });
      }
      setTracking(true);
    };
    const handlePointerMove = (event: PointerEvent) => {
      trackPosition({ x: event.clientX, y: event.clientY });
    };

    onPointerMoveHandlerChange(trackPosition);
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    return () => {
      onPointerMoveHandlerChange(null);
      window.removeEventListener("pointermove", handlePointerMove);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [enabled, onPointerMoveHandlerChange]);

  if (!enabled) return null;
  return (
    <div
      ref={dotRef}
      aria-hidden="true"
      className={`pointer-events-none fixed left-0 top-0 z-[60] size-[18px] will-change-transform rounded-full border-2 border-destructive bg-destructive/40 shadow-[0_0_18px_4px] shadow-destructive/50 transition-opacity duration-150 ${
        tracking ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}
