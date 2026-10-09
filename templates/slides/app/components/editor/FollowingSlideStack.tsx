import { useT } from "@agent-native/core/client/i18n";
import { type CSSProperties, memo, useEffect, useRef, useState } from "react";

import SlideRenderer from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";
import { type AspectRatio, getAspectRatioDims } from "@/lib/aspect-ratios";

import type { DesignSystemData } from "../../../shared/api";

const EAGER_SLIDE_PREVIEW_COUNT = 3;
const SLIDE_PREVIEW_ROOT_MARGIN = "800px 0px";

const FollowingSlideButton = memo(function FollowingSlideButton({
  slide,
  number,
  count,
  width,
  height,
  aspectRatio,
  designSystem,
  onSelect,
  showPreview,
}: {
  slide: Slide;
  number: number;
  count: number;
  width: number;
  height: number;
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
  onSelect: (slideId: string) => void;
  showPreview: boolean;
}) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t("editorSidebar.selectSlide", { number })}
      data-following-slide-id={slide.id}
      onClick={() => onSelect(slide.id)}
      style={
        {
          "--following-slide-size": `${width}px ${height}px`,
          height: `${height}px`,
        } as CSSProperties
      }
      // Offscreen slides skip layout and paint until they scroll near.
      className="block w-full shrink-0 cursor-pointer border-t border-border text-left [content-visibility:auto] [contain-intrinsic-size:var(--following-slide-size)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {showPreview ? (
        <SlideRenderer
          slide={slide}
          aspectRatio={aspectRatio}
          designSystem={designSystem}
          slidePosition={{ number, count }}
          className="pointer-events-none rounded-none!"
        />
      ) : null}
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
  const stackRef = useRef<HTMLDivElement>(null);
  const [nearbySlideIds, setNearbySlideIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const dims = getAspectRatioDims(aspectRatio);
  const height = Math.round((width * dims.height) / dims.width);
  const currentIndex = slides.findIndex((slide) => slide.id === afterSlideId);

  useEffect(() => {
    const stack = stackRef.current;
    if (!stack || currentIndex < 0 || currentIndex === slides.length - 1)
      return;

    if (typeof IntersectionObserver === "undefined") {
      setNearbySlideIds(
        new Set(slides.slice(currentIndex + 1).map((slide) => slide.id)),
      );
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        setNearbySlideIds((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const slideId = (entry.target as HTMLElement).dataset
              .followingSlideId;
            if (!slideId) continue;
            if (entry.isIntersecting) next.add(slideId);
            else next.delete(slideId);
          }
          return next;
        });
      },
      { rootMargin: SLIDE_PREVIEW_ROOT_MARGIN },
    );

    for (const button of stack.querySelectorAll("[data-following-slide-id]")) {
      observer.observe(button);
    }

    return () => observer.disconnect();
  }, [currentIndex, slides]);

  if (currentIndex < 0 || currentIndex === slides.length - 1) return null;

  return (
    <div
      ref={stackRef}
      data-following-slides="true"
      className="flex shrink-0 flex-col"
      style={{ width, maxWidth: width }}
    >
      {slides.slice(currentIndex + 1).map((slide, offset) => (
        <FollowingSlideButton
          key={slide.id}
          slide={slide}
          number={currentIndex + offset + 2}
          count={slides.length}
          width={width}
          height={height}
          aspectRatio={aspectRatio}
          designSystem={designSystem}
          onSelect={onSelect}
          showPreview={
            offset < EAGER_SLIDE_PREVIEW_COUNT || nearbySlideIds.has(slide.id)
          }
        />
      ))}
    </div>
  );
});
