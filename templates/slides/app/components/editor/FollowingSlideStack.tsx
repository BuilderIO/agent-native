import { useT } from "@agent-native/core/client/i18n";
import { memo } from "react";

import SlideRenderer from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";
import { type AspectRatio, getAspectRatioDims } from "@/lib/aspect-ratios";

import type { DesignSystemData } from "../../../shared/api";

const FollowingSlideButton = memo(function FollowingSlideButton({
  slide,
  number,
  width,
  height,
  aspectRatio,
  designSystem,
  onSelect,
}: {
  slide: Slide;
  number: number;
  width: number;
  height: number;
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
  onSelect: (slideId: string) => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t("editorSidebar.selectSlide", { number })}
      data-following-slide-id={slide.id}
      onClick={() => onSelect(slide.id)}
      // Offscreen slides skip layout and paint until they scroll near.
      style={{
        contentVisibility: "auto",
        containIntrinsicSize: `${width}px ${height}px`,
      }}
      className="block w-full shrink-0 cursor-pointer border-t border-border text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <SlideRenderer
        slide={slide}
        aspectRatio={aspectRatio}
        designSystem={designSystem}
        className="pointer-events-none rounded-none!"
      />
    </button>
  );
});

/**
 * The slides after `afterSlideId`, stacked at the canvas width so a slide
 * shorter than the pane is followed by the next ones instead of an empty band.
 */
export const FollowingSlideStack = memo(function FollowingSlideStack({
  slides,
  afterSlideId,
  width,
  aspectRatio,
  designSystem,
  onSelect,
}: {
  slides: readonly Slide[];
  afterSlideId: string;
  width: number;
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
  onSelect: (slideId: string) => void;
}) {
  const dims = getAspectRatioDims(aspectRatio);
  const height = Math.round((width * dims.height) / dims.width);
  const currentIndex = slides.findIndex((slide) => slide.id === afterSlideId);
  if (currentIndex < 0 || currentIndex === slides.length - 1) return null;

  return (
    <div
      data-following-slides="true"
      className="flex shrink-0 flex-col"
      style={{ width, maxWidth: width }}
    >
      {slides.slice(currentIndex + 1).map((slide, offset) => (
        <FollowingSlideButton
          key={slide.id}
          slide={slide}
          number={currentIndex + offset + 2}
          width={width}
          height={height}
          aspectRatio={aspectRatio}
          designSystem={designSystem}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
});
