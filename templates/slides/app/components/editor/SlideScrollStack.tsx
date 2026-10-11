import { useT } from "@agent-native/core/client/i18n";
import {
  type RefObject,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import SlideRenderer from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";
import { type AspectRatio, getAspectRatioDims } from "@/lib/aspect-ratios";
import {
  type SlideScrollGeometry,
  slideNearReadingLine,
  slideRevealDelta,
} from "@/lib/slide-scroll";

import type { DesignSystemData } from "../../../shared/api";

/**
 * The canvas as one vertical scroll through every slide, for a pane with no
 * room for the slide rail. One live editor sits in its place among static
 * previews, and scrolling hands the editor to whichever slide is in view.
 */
export interface SlideScroll {
  /** Every slide of the deck, in order. */
  slides: readonly Slide[];
  /** A slide other than the current one was clicked. */
  onSelectSlide: (slideId: string) => void;
  /** Scrolling brought a different slide into view. */
  onFollowScroll: (slideId: string) => void;
  /** False while an edit on the current slide must keep it current. */
  following: boolean;
}

/** Gap between slides; the canvas track and the previews both use `gap-4`. */
const SLIDE_GAP_PX = 16;
export const SLIDE_SCROLL_TRACK_CLASS = "flex-col gap-4";
/**
 * The scroller moves itself, so the browser must not also re-anchor it, and a
 * scrollbar appearing must not change the width the slides are fitted to.
 */
export const SLIDE_SCROLL_CONTAINER_CLASS =
  "[overflow-anchor:none] [scrollbar-gutter:stable]";

const SETTLE_MS = 120;
const NEAR_VIEW_MARGIN = "600px 0px";
const EAGER_NEIGHBOURS = 2;

const SlidePreview = memo(function SlidePreview({
  slide,
  number,
  count,
  aspectRatio,
  designSystem,
  mounted,
  onSelect,
}: {
  slide: Slide;
  number: number;
  count: number;
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
  mounted: boolean;
  onSelect: (slideId: string) => void;
}) {
  const t = useT();
  const dims = getAspectRatioDims(aspectRatio);
  return (
    <button
      type="button"
      aria-label={t("editorSidebar.selectSlide", { number })}
      data-scroll-slide-id={slide.id}
      onClick={() => onSelect(slide.id)}
      style={{ aspectRatio: `${dims.width} / ${dims.height}` }}
      className="block w-full shrink-0 cursor-pointer rounded-lg bg-muted/40 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {mounted ? (
        <SlideRenderer
          slide={slide}
          aspectRatio={aspectRatio}
          designSystem={designSystem}
          slidePosition={{ number, count }}
          className="pointer-events-none shadow-2xl shadow-black/40"
        />
      ) : null}
    </button>
  );
});

/**
 * The slides on one side of the current slide, at the canvas width. A preview
 * is only drawn near the pane, so a long deck stays cheap to scroll.
 */
export const SlideScrollPreviews = memo(function SlideScrollPreviews({
  side,
  scroll,
  currentSlideId,
  width,
  aspectRatio,
  designSystem,
  scrollContainerRef,
}: {
  side: "before" | "after";
  scroll: SlideScroll;
  currentSlideId: string;
  width: number;
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
  scrollContainerRef: RefObject<HTMLElement | null>;
}) {
  const { slides } = scroll;
  const currentIndex = slides.findIndex((slide) => slide.id === currentSlideId);
  const start = side === "before" ? 0 : currentIndex + 1;
  const end = side === "before" ? currentIndex : slides.length;
  const group = currentIndex < 0 ? [] : slides.slice(start, end);

  const groupRef = useRef<HTMLDivElement>(null);
  const [nearIds, setNearIds] = useState<ReadonlySet<string>>(() => new Set());
  const onSelectRef = useRef(scroll.onSelectSlide);
  useLayoutEffect(() => {
    onSelectRef.current = scroll.onSelectSlide;
  });
  const select = useCallback(
    (slideId: string) => onSelectRef.current(slideId),
    [],
  );

  const groupKey = group.map((slide) => slide.id).join("|");
  useEffect(() => {
    const element = groupRef.current;
    if (!element) return;
    const previews = element.querySelectorAll<HTMLElement>(
      "[data-scroll-slide-id]",
    );
    if (typeof IntersectionObserver === "undefined") {
      setNearIds(
        new Set(Array.from(previews, (item) => item.dataset.scrollSlideId!)),
      );
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setNearIds((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const slideId = (entry.target as HTMLElement).dataset.scrollSlideId;
            if (!slideId) continue;
            if (entry.isIntersecting) next.add(slideId);
            else next.delete(slideId);
          }
          return next;
        });
      },
      { root: scrollContainerRef.current, rootMargin: NEAR_VIEW_MARGIN },
    );
    previews.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [groupKey, scrollContainerRef]);

  if (group.length === 0) return null;

  return (
    <div
      ref={groupRef}
      data-slide-scroll-previews={side}
      className="flex shrink-0 flex-col"
      style={{ width, maxWidth: width, gap: SLIDE_GAP_PX }}
    >
      {group.map((slide, offset) => {
        const nearCurrent =
          side === "before"
            ? offset >= group.length - EAGER_NEIGHBOURS
            : offset < EAGER_NEIGHBOURS;
        return (
          <SlidePreview
            key={slide.id}
            slide={slide}
            number={start + offset + 1}
            count={slides.length}
            aspectRatio={aspectRatio}
            designSystem={designSystem}
            mounted={nearCurrent || nearIds.has(slide.id)}
            onSelect={select}
          />
        );
      })}
    </div>
  );
});

/**
 * Keeps the current slide and the scroll position agreeing: scrolling hands
 * the editor to the slide the view points at, and a slide chosen elsewhere is
 * scrolled to.
 */
export function useSlideScrollFollow({
  scroll,
  currentSlideId,
  width,
  scrollContainerRef,
  currentSlideRef,
}: {
  scroll: SlideScroll | undefined;
  currentSlideId: string;
  /** The canvas width: a zoom or a resize moves every slide. */
  width: number;
  scrollContainerRef: RefObject<HTMLElement | null>;
  currentSlideRef: RefObject<HTMLElement | null>;
}) {
  const enabled = scroll !== undefined;
  const following = scroll?.following ?? false;
  const latestRef = useRef({ scroll, currentSlideId });
  useLayoutEffect(() => {
    latestRef.current = { scroll, currentSlideId };
  });
  // The slide the last scroll handed the editor to: already in view.
  const followedRef = useRef<string | null>(null);
  // The slide the view pointed at when it was last looked at. Scrolling only
  // moves the editor once the view points at another slide, so picking a slide
  // is not undone by a nudge.
  const pointedAtRef = useRef<string | null>(null);
  const pausedRef = useRef(false);

  const measure = useCallback((): SlideScrollGeometry | null => {
    const scroller = scrollContainerRef.current;
    const current = currentSlideRef.current;
    const { scroll: latest, currentSlideId: currentId } = latestRef.current;
    if (!scroller || !current || !latest) return null;
    const currentIndex = latest.slides.findIndex(
      (slide) => slide.id === currentId,
    );
    if (currentIndex < 0) return null;
    const view = scroller.getBoundingClientRect();
    const rect = current.getBoundingClientRect();
    return {
      currentIndex,
      count: latest.slides.length,
      currentTop: rect.top,
      currentHeight: rect.height,
      pitch: rect.height + SLIDE_GAP_PX,
      viewTop: view.top,
      viewHeight: view.height,
      scrollTop: scroller.scrollTop,
      maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
    };
  }, [scrollContainerRef, currentSlideRef]);

  const pointedAt = useCallback((): string | null => {
    const geometry = measure();
    const slides = latestRef.current.scroll?.slides;
    if (!geometry || !slides) return null;
    return slides[slideNearReadingLine(geometry)]?.id ?? null;
  }, [measure]);

  useEffect(() => {
    if (!enabled) return;
    if (followedRef.current === currentSlideId) {
      followedRef.current = null;
      return;
    }
    const scroller = scrollContainerRef.current;
    const geometry = measure();
    if (scroller && geometry) {
      const delta = slideRevealDelta(geometry);
      if (delta !== 0) scroller.scrollTop += delta;
    }
    pointedAtRef.current = pointedAt();
  }, [enabled, currentSlideId, width, measure, pointedAt, scrollContainerRef]);

  useEffect(() => {
    if (!enabled) return;
    if (!following) {
      pausedRef.current = true;
      return;
    }
    const scroller = scrollContainerRef.current;
    if (!scroller) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      const slideId = pointedAt();
      if (!slideId || slideId === pointedAtRef.current) return;
      pointedAtRef.current = slideId;
      const { scroll: latest, currentSlideId: currentId } = latestRef.current;
      if (!latest || slideId === currentId) return;
      followedRef.current = slideId;
      latest.onFollowScroll(slideId);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(settle, SETTLE_MS);
    };
    scroller.addEventListener("scroll", schedule, { passive: true });
    // An edit held the slide in place; now that it ended, the view decides.
    if (pausedRef.current) {
      pausedRef.current = false;
      schedule();
    }
    return () => {
      scroller.removeEventListener("scroll", schedule);
      clearTimeout(timer);
    };
  }, [enabled, following, pointedAt, scrollContainerRef]);
}
