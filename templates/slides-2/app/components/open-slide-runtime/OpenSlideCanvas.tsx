import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { OPEN_SLIDE_CANVAS_HEIGHT, OPEN_SLIDE_CANVAS_WIDTH } from "./constants";

type Props = {
  children: ReactNode;
  className?: string;
  scale?: number;
  zoom?: number;
  center?: boolean;
  flat?: boolean;
  onScaleChange?: (scale: number) => void;
};

export function OpenSlideCanvas({
  children,
  className,
  scale,
  zoom = 1,
  center = true,
  flat = false,
  onScaleChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (scale !== undefined) return;
    const element = containerRef.current;
    if (!element) return;

    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      setFitScale(
        Math.min(
          width / OPEN_SLIDE_CANVAS_WIDTH,
          height / OPEN_SLIDE_CANVAS_HEIGHT,
        ),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scale]);

  const measuredScale = scale ?? (fitScale === null ? null : fitScale * zoom);
  const currentScale = measuredScale ?? 1;
  const scaledWidth = OPEN_SLIDE_CANVAS_WIDTH * currentScale;
  const scaledHeight = OPEN_SLIDE_CANVAS_HEIGHT * currentScale;

  useLayoutEffect(() => {
    if (measuredScale !== null) onScaleChange?.(measuredScale);
  }, [measuredScale, onScaleChange]);

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full ${flat ? "overflow-hidden" : ""} ${className ?? ""}`}
      data-open-slide-canvas-container
    >
      <div
        className={`${center ? "absolute left-1/2 top-1/2" : ""} overflow-hidden bg-white text-black ${flat ? "" : "rounded-md shadow-2xl"}`}
        style={{
          width: scaledWidth,
          height: scaledHeight,
          ...(center ? { transform: "translate(-50%, -50%)" } : {}),
          visibility: measuredScale === null ? "hidden" : undefined,
        }}
      >
        <div
          className="absolute left-0 top-0"
          style={{
            width: OPEN_SLIDE_CANVAS_WIDTH,
            height: OPEN_SLIDE_CANVAS_HEIGHT,
            transform: `scale(${currentScale})`,
            transformOrigin: "top left",
          }}
          data-open-slide-stage
        >
          {children}
        </div>
      </div>
    </div>
  );
}
