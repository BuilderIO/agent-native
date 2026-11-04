import SlideRenderer from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";
import { getAspectRatioDims, type AspectRatio } from "@/lib/aspect-ratios";

import type { DesignSystemData } from "../../../shared/api";

// The PDF and PPTX exporters capture slides from this stage. Mount it for the
// whole export: the editor's slide rail and canvas only render slides near the
// viewport, so they cannot stand in for it.
export function PdfExportStage({
  slides,
  aspectRatio,
  designSystem,
}: {
  slides: Slide[];
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
}) {
  const dims = getAspectRatioDims(aspectRatio);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed top-0"
      data-pdf-export-stage="true"
      style={{ left: "-10000px", width: dims.width }}
    >
      {slides.map((slide, index) => (
        <div key={slide.id} style={{ width: dims.width, height: dims.height }}>
          <SlideRenderer
            slide={slide}
            slidePosition={{ number: index + 1, count: slides.length }}
            thumbnail={false}
            disableVideoAutoplay
            aspectRatio={aspectRatio}
            designSystem={designSystem}
          />
        </div>
      ))}
    </div>
  );
}
