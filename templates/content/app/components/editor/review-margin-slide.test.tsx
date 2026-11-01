// @vitest-environment happy-dom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReviewMarginSlide } from "./review-margin-slide";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Page({ reserved }: { reserved: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  useReviewMarginSlide({ scroller, content, column }, reserved);
  return (
    <div ref={scroller} data-scroller>
      <div ref={content} data-content>
        <div ref={column} className={reserved ? "reserved" : undefined}>
          <div data-lead />
        </div>
      </div>
    </div>
  );
}

/** A slide in flight: the page is drawn `offset` px from where it lands. */
interface FakeSlide {
  keyframes: Keyframe[];
  offset: number;
  over: boolean;
  cancelled: boolean;
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
  cancel: () => void;
}

let host: HTMLDivElement;
let root: Root;
let slides: FakeSlide[];
let reducedMotion: boolean;
let centered: boolean;
let insetByPadding: ((padding: number) => number) | null;

function render(reserved: boolean) {
  act(() => root.render(<Page reserved={reserved} />));
}

function scroller() {
  const found = host.querySelector<HTMLElement>("[data-scroller]");
  if (!found) throw new Error("missing scroller");
  return found;
}

function columnPadding(lead: Element) {
  const column = lead.parentElement;
  return column ? parseFloat(getComputedStyle(column).paddingRight) : 0;
}

/** Where the page's text is drawn now. */
function textDrawn() {
  const lead = host.querySelector("[data-lead]");
  if (!lead) throw new Error("missing lead");
  return (
    lead.getBoundingClientRect().left +
    parseFloat(getComputedStyle(lead).paddingLeft)
  );
}

function finish(slide: FakeSlide | undefined) {
  if (!slide) throw new Error("no slide");
  slide.over = true;
  act(() => slide.onfinish?.());
}

// A browser delivers a cancel event after the call that cancelled it returns.
const eventsDelivered = () => act(() => Promise.resolve());

beforeEach(() => {
  const sheet = document.createElement("style");
  sheet.textContent =
    "div { padding: 0px; } .reserved { padding-right: 320px; }";
  document.head.append(sheet);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  slides = [];
  reducedMotion = false;
  centered = true;
  insetByPadding = null;
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: reducedMotion && query.includes("reduce"),
      }) as MediaQueryList,
  );
  const style = globalThis.getComputedStyle;
  vi.spyOn(globalThis, "getComputedStyle").mockImplementation((element) => {
    const computed = style(element);
    if (!insetByPadding || !element.hasAttribute("data-lead")) return computed;
    const inset = insetByPadding(columnPadding(element));
    return { paddingLeft: `${inset}px` } as CSSStyleDeclaration;
  });
  // A centered column moves left by half the margin's padding; a running
  // slide moves everything inside the content.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (!this.hasAttribute("data-lead")) return { left: 0 } as DOMRect;
      const moved = slides
        .filter((slide) => !slide.over)
        .reduce((sum, slide) => sum + slide.offset, 0);
      const left = centered ? 640 - columnPadding(this) / 2 : 100;
      return { left: left + moved } as DOMRect;
    },
  );
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(keyframes: Keyframe[]) {
      const slide: FakeSlide = {
        keyframes,
        offset: parseFloat(
          String(keyframes[0]?.transform).replace("translateX(", ""),
        ),
        over: false,
        cancelled: false,
        onfinish: null,
        oncancel: null,
        // Cancelling a finished slide still fires its cancel event.
        cancel: () => {
          if (slide.cancelled) return;
          slide.cancelled = true;
          slide.over = true;
          void Promise.resolve().then(() => slide.oncancel?.());
        },
      };
      slides.push(slide);
      return slide;
    },
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.head.replaceChildren();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

describe("useReviewMarginSlide", () => {
  it("leaves a page that opens with its margin where it is", () => {
    render(true);
    expect(slides).toEqual([]);
  });

  it("slides the page from where it was when the margin opens", () => {
    render(false);
    const before = textDrawn();
    render(true);
    expect(textDrawn()).toBe(before);
    expect(scroller().style.overflowX).toBe("hidden");
    finish(slides[0]);
    expect(textDrawn()).toBe(before - 160);
    expect(scroller().style.overflowX).toBe("");
  });

  it("turns a slide around where the page is drawn", async () => {
    render(false);
    render(true);
    const opening = slides.find((slide) => !slide.over);
    if (!opening) throw new Error("no slide running");
    opening.offset = 65;
    const turning = textDrawn();
    render(false);
    expect(textDrawn()).toBe(turning);
    await eventsDelivered();
    expect(scroller().style.overflowX).toBe("hidden");
    finish(slides[1]);
    expect(scroller().style.overflowX).toBe("");
  });

  it("keeps the scrollbar hidden through a slide after one that finished", async () => {
    render(false);
    render(true);
    finish(slides[0]);
    render(false);
    finish(slides[1]);
    render(true);
    await eventsDelivered();
    expect(scroller().style.overflowX).toBe("hidden");
  });

  it("slides text a container query moves inside the page", () => {
    // A narrow page fills its column, so opening the margin narrows the
    // column without moving its left edge, past a query that trims the inset.
    centered = false;
    insetByPadding = (padding) => (padding > 0 ? 16 : 64);
    render(false);
    const before = textDrawn();
    render(true);
    expect(textDrawn()).toBe(before);
    finish(slides[0]);
    expect(textDrawn()).toBe(before - 48);
  });

  it("moves the page at once when the reader prefers reduced motion", () => {
    reducedMotion = true;
    render(false);
    render(true);
    expect(slides).toEqual([]);
    expect(scroller().style.overflowX).toBe("");
  });
});
