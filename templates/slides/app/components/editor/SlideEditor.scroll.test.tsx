// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Slide } from "@/context/DeckContext";

import SlideEditor from "./SlideEditor";
import type { SlideScroll } from "./SlideScrollStack";

vi.mock("@agent-native/core/client/labs", () => ({
  useLabState: () => ({
    enabled: false,
    isLoading: false,
    isError: false,
    isSuccess: true,
  }),
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useT: () => (key: string, values?: { number?: number }) =>
    values?.number === undefined ? key : `${key} ${values.number}`,
}));
vi.mock("@/components/deck/ExcalidrawSlide", () => ({
  ExcalidrawSlide: () => <div data-excalidraw-canvas="true" />,
  ExcalidrawThumbnail: () => null,
  parseExcalidrawData: (json?: string) => (json ? JSON.parse(json) : null),
}));
vi.mock("@/root", () => ({ enterSelectionMode: vi.fn() }));

const SLIDE_HEIGHT = 200;
const PITCH = SLIDE_HEIGHT + 16;
const VIEW_TOP = 50;
const VIEW_HEIGHT = 500;
const CONTENT_PADDING = 56;
const SLIDE_COUNT = 10;
const MAX_SCROLL = CONTENT_PADDING + SLIDE_COUNT * PITCH - 16 - VIEW_HEIGHT;

const slides = Array.from(
  { length: SLIDE_COUNT },
  (_, index) =>
    ({
      id: `slide-${index + 1}`,
      content: `<div class="fmd-slide"><h2>Slide ${index + 1}</h2></div>`,
      layout: "blank",
    }) as Slide,
);

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

function editor(currentIndex: number, slideScroll?: SlideScroll) {
  const noop = () => {};
  return (
    <SlideEditor
      slide={slides[currentIndex]}
      slideScroll={slideScroll}
      onUpdateSlide={() => undefined}
      onGenerateImage={noop}
      onOpenAssetLibrary={noop}
      onUploadImage={noop}
      onToggleObjectFit={noop}
      onChangeObjectPosition={noop}
    />
  );
}

function stackOf(overrides: Partial<SlideScroll> = {}): SlideScroll {
  return {
    slides,
    onSelectSlide: vi.fn(),
    onFollowScroll: vi.fn(),
    following: true,
    ...overrides,
  };
}

function orderedSlideIds(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      "[data-scroll-slide-id], [data-main-slide-canvas='true']",
    ),
    (element) => element.dataset.scrollSlideId ?? "current",
  );
}

/**
 * Lays the stack out the way a browser would: slides in a column below a
 * padded top, inside a scroller `scrollTop` pixels down. `currentIndex` is the
 * slide the live editor sits in.
 */
const layout = { currentIndex: 0, scrollTop: 0 };

function isScroller(element: Element) {
  const canvas = document.querySelector("[data-main-slide-canvas='true']");
  return Boolean(canvas) && element === canvas?.parentElement?.parentElement;
}

const restoreStubs: Array<() => void> = [];

function stubLayout() {
  const stub = (
    name: string,
    get: (element: Element) => unknown,
    set?: (value: number) => void,
  ) => {
    const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: Element) {
        return get(this);
      },
      set(value: number) {
        set?.(value);
      },
    });
    restoreStubs.push(() => {
      if (own) Object.defineProperty(HTMLElement.prototype, name, own);
      else
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
          name
        ];
    });
  };
  stub(
    "scrollTop",
    (element) => (isScroller(element) ? layout.scrollTop : 0),
    (value) => {
      layout.scrollTop = Math.min(MAX_SCROLL, Math.max(0, value));
    },
  );
  stub("scrollHeight", (element) =>
    isScroller(element) ? MAX_SCROLL + VIEW_HEIGHT : 0,
  );
  stub("clientHeight", (element) => (isScroller(element) ? VIEW_HEIGHT : 0));
  stub("clientWidth", (element) => (isScroller(element) ? 360 : 0));

  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.matches("[data-main-slide-canvas='true']")) {
      const top =
        VIEW_TOP +
        CONTENT_PADDING +
        layout.currentIndex * PITCH -
        layout.scrollTop;
      return {
        top,
        bottom: top + SLIDE_HEIGHT,
        height: SLIDE_HEIGHT,
        left: 0,
        right: 344,
        width: 344,
      } as DOMRect;
    }
    if (isScroller(this)) {
      return {
        top: VIEW_TOP,
        bottom: VIEW_TOP + VIEW_HEIGHT,
        height: VIEW_HEIGHT,
        left: 0,
        right: 360,
        width: 360,
      } as DOMRect;
    }
    return original.call(this);
  };
  restoreStubs.push(() => {
    HTMLElement.prototype.getBoundingClientRect = original;
  });
}

function scrollerOf(container: HTMLElement) {
  return container.querySelector<HTMLElement>(
    "[data-main-slide-canvas='true']",
  )!.parentElement!.parentElement as HTMLElement;
}

function settle() {
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

describe("SlideEditor as one scroll through every slide", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    vi.useFakeTimers();
    layout.currentIndex = 0;
    layout.scrollTop = 0;
    stubLayout();
  });

  afterEach(() => {
    cleanup();
    restoreStubs.splice(0).forEach((restore) => restore());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows only the current slide when the rail has room", () => {
    const { container } = render(editor(2), { wrapper: Providers });

    expect(orderedSlideIds(container)).toEqual(["current"]);
  });

  it("stacks every slide in deck order around the live one", () => {
    layout.currentIndex = 2;
    const { container } = render(editor(2, stackOf()), { wrapper: Providers });

    expect(orderedSlideIds(container)).toEqual([
      "slide-1",
      "slide-2",
      "current",
      ...slides.slice(3).map((slide) => slide.id),
    ]);
  });

  it("keeps the live editor in the same place as the current slide changes", () => {
    layout.currentIndex = 2;
    const stack = stackOf();
    const { container, rerender } = render(editor(2, stack), {
      wrapper: Providers,
    });
    const liveCanvas = container.querySelector("[data-main-slide-canvas]");

    layout.currentIndex = 3;
    rerender(editor(3, stack));

    expect(container.querySelector("[data-main-slide-canvas]")).toBe(
      liveCanvas,
    );
    expect(orderedSlideIds(container).indexOf("current")).toBe(3);
  });

  it("selects a slide that is clicked in the stack", () => {
    layout.currentIndex = 2;
    const stack = stackOf();
    const { container } = render(editor(2, stack), { wrapper: Providers });

    fireEvent.click(
      container.querySelector("[data-scroll-slide-id='slide-5']")!,
    );

    expect(stack.onSelectSlide).toHaveBeenCalledWith("slide-5");
    expect(stack.onFollowScroll).not.toHaveBeenCalled();
  });

  it("hands the editor to the slide the view reaches once scrolling settles", () => {
    const stack = stackOf();
    const { container } = render(editor(0, stack), { wrapper: Providers });

    layout.scrollTop = MAX_SCROLL;
    fireEvent.scroll(scrollerOf(container));
    expect(stack.onFollowScroll).not.toHaveBeenCalled();
    settle();

    expect(stack.onFollowScroll).toHaveBeenCalledTimes(1);
    expect(stack.onFollowScroll).toHaveBeenCalledWith("slide-10");
  });

  it("follows every slide the view passes, in order", () => {
    const followed: string[] = [];
    const stack = stackOf({
      onFollowScroll: (slideId) => followed.push(slideId),
    });
    const { container, rerender } = render(editor(0, stack), {
      wrapper: Providers,
    });

    for (let scrollTop = 0; scrollTop <= MAX_SCROLL; scrollTop += 100) {
      layout.scrollTop = scrollTop;
      fireEvent.scroll(scrollerOf(container));
      settle();
      const current = followed[followed.length - 1];
      if (current) {
        layout.currentIndex = slides.findIndex((slide) => slide.id === current);
        rerender(editor(layout.currentIndex, stack));
      }
    }

    expect(followed.length).toBeGreaterThan(2);
    expect(followed[followed.length - 1]).toBe("slide-10");
    expect(followed).toEqual(
      [...followed].sort((a, b) => Number(a.slice(6)) - Number(b.slice(6))),
    );
  });

  it("keeps a picked slide when the view nudges without reaching another slide", () => {
    layout.currentIndex = 1;
    const stack = stackOf();
    const { container } = render(editor(1, stack), { wrapper: Providers });

    layout.scrollTop = 20;
    fireEvent.scroll(scrollerOf(container));
    settle();

    expect(stack.onFollowScroll).not.toHaveBeenCalled();
  });

  it("waits while an edit holds the slide, then lets the view decide", () => {
    const { container, rerender } = render(
      editor(0, stackOf({ following: false })),
      { wrapper: Providers },
    );

    layout.scrollTop = MAX_SCROLL;
    fireEvent.scroll(scrollerOf(container));
    settle();

    const resumed = stackOf({ following: true });
    rerender(editor(0, resumed));
    settle();

    expect(resumed.onFollowScroll).toHaveBeenCalledWith("slide-10");
  });

  it("scrolls to a slide that was chosen somewhere else", () => {
    const stack = stackOf();
    const { rerender } = render(editor(0, stack), { wrapper: Providers });

    layout.currentIndex = 6;
    rerender(editor(6, stack));

    // Slide 7 now sits in the pane instead of 1100px below it.
    const top = VIEW_TOP + CONTENT_PADDING + 6 * PITCH - layout.scrollTop;
    expect(layout.scrollTop).toBeGreaterThan(0);
    expect(top).toBeGreaterThanOrEqual(VIEW_TOP);
    expect(top).toBeLessThan(VIEW_TOP + VIEW_HEIGHT / 2);
  });

  it("does not move the scroller for the slide that scrolling chose", () => {
    const stack = stackOf();
    const { container, rerender } = render(editor(0, stack), {
      wrapper: Providers,
    });

    layout.scrollTop = MAX_SCROLL;
    fireEvent.scroll(scrollerOf(container));
    settle();
    const before = layout.scrollTop;

    layout.currentIndex = 9;
    rerender(editor(9, stack));

    expect(layout.scrollTop).toBe(before);
  });
});
