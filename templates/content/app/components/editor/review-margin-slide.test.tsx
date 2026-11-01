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

interface FakeSlide {
  keyframes: Keyframe[];
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
  cancel: () => void;
}

let host: HTMLDivElement;
let root: Root;
let slides: FakeSlide[];
let reducedMotion: boolean;

function render(reserved: boolean) {
  act(() => root.render(<Page reserved={reserved} />));
}

function element(selector: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

beforeEach(() => {
  const sheet = document.createElement("style");
  sheet.textContent =
    "div { padding-right: 0px; } .reserved { padding-right: 320px; }";
  document.head.append(sheet);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  slides = [];
  reducedMotion = false;
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: reducedMotion && query.includes("reduce"),
      }) as MediaQueryList,
  );
  // A centered column moves left by half the margin's padding.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const column = this.parentElement;
      const padding =
        column && this.hasAttribute("data-lead")
          ? parseFloat(getComputedStyle(column).paddingRight)
          : 0;
      return { left: 640 - padding / 2 } as DOMRect;
    },
  );
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(keyframes: Keyframe[]) {
      const slide: FakeSlide = {
        keyframes,
        onfinish: null,
        oncancel: null,
        cancel: () => slide.oncancel?.(),
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
    render(true);
    expect(slides.map((slide) => slide.keyframes)).toEqual([
      [{ transform: "translateX(160px)" }, { transform: "none" }],
    ]);
    expect(element("[data-scroller]").style.overflowX).toBe("hidden");
    act(() => slides[0]?.onfinish?.());
    expect(element("[data-scroller]").style.overflowX).toBe("");
  });

  it("slides it back when the margin closes, ending a slide still running", () => {
    render(false);
    render(true);
    render(false);
    expect(slides.map((slide) => slide.keyframes)).toEqual([
      [{ transform: "translateX(160px)" }, { transform: "none" }],
      [{ transform: "translateX(-160px)" }, { transform: "none" }],
    ]);
    expect(element("[data-scroller]").style.overflowX).toBe("hidden");
  });

  it("moves the page at once when the reader prefers reduced motion", () => {
    reducedMotion = true;
    render(false);
    render(true);
    expect(slides).toEqual([]);
    expect(element("[data-scroller]").style.overflowX).toBe("");
  });
});
