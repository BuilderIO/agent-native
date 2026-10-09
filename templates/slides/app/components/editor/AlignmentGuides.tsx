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
  const lineStyleFor = (guide: SlideAlignmentGuide): CSSProperties => ({
    position: "fixed",
    pointerEvents: "none",
    zIndex: 70,
    backgroundColor: guide.equalSpacing
      ? // guard:allow-raw-color — Google Slides equal-spacing guides are literal #009ef5, theme-independent (gs-truth-selection 9.4)
        "#009ef5"
      : // guard:allow-raw-color — Google Slides guides are literal #ff0000, theme-independent (interaction-oracle.md 9.2)
        "#ff0000",
  });

  return createPortal(
    <div data-slide-alignment-guides aria-hidden="true">
      {guides.map((guide, index) => {
        const lineStyle = lineStyleFor(guide);
        const kind = guide.equalSpacing ? "equal-spacing" : undefined;
        if (guide.orientation === "vertical") {
          return (
            <div
              key={`vertical-${guide.position}-${index}`}
              data-slide-alignment-guide="vertical"
              data-slide-guide-kind={kind}
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
            data-slide-guide-kind={kind}
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
