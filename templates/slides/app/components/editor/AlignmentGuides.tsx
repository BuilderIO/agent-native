import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

import type {
  SlideAlignmentGuide,
  SlideObjectGeometry,
} from "./slide-object-interactions";

export interface AlignmentGuideViewport {
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">;
  canvas: Pick<SlideObjectGeometry, "width" | "height">;
}

export function AlignmentGuides({
  guides,
  viewport,
}: {
  guides: readonly SlideAlignmentGuide[];
  viewport: AlignmentGuideViewport | null;
}) {
  if (!viewport || guides.length === 0 || typeof document === "undefined") {
    return null;
  }

  const scaleX =
    viewport.canvas.width > 0 ? viewport.rect.width / viewport.canvas.width : 1;
  const scaleY =
    viewport.canvas.height > 0
      ? viewport.rect.height / viewport.canvas.height
      : 1;
  const lineStyle: CSSProperties = {
    position: "fixed",
    pointerEvents: "none",
    zIndex: 70,
    backgroundColor: "hsl(var(--destructive))",
    boxShadow: "0 0 0 1px hsl(var(--destructive) / 0.2)",
  };

  return createPortal(
    <div data-slide-alignment-guides aria-hidden="true">
      {guides.map((guide, index) => {
        if (guide.orientation === "vertical") {
          return (
            <div
              key={`vertical-${guide.position}-${index}`}
              data-slide-alignment-guide="vertical"
              style={{
                ...lineStyle,
                left: viewport.rect.left + guide.position * scaleX,
                top: viewport.rect.top + guide.start * scaleY,
                width: 1,
                height: Math.max(1, (guide.end - guide.start) * scaleY),
              }}
            />
          );
        }

        return (
          <div
            key={`horizontal-${guide.position}-${index}`}
            data-slide-alignment-guide="horizontal"
            style={{
              ...lineStyle,
              left: viewport.rect.left + guide.start * scaleX,
              top: viewport.rect.top + guide.position * scaleY,
              width: Math.max(1, (guide.end - guide.start) * scaleX),
              height: 1,
            }}
          />
        );
      })}
    </div>,
    document.body,
  );
}
