// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDraftOutlines, DRAFTING_ATTRIBUTE } from "./draft-outlines";

interface RecordedAnimation {
  target: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  onfinish: (() => void) | null;
}

const rects = new Map<
  Element,
  { x: number; y: number; w: number; h: number }
>();
let animations: RecordedAnimation[] = [];
let frames: FrameRequestCallback[] = [];
let clock = 0;
let reducedMotion = false;

function place(element: Element, x: number, y: number, w: number, h: number) {
  rects.set(element, { x, y, w, h });
}

/** Runs the queued animation frames at `time`. */
function frameAt(time: number) {
  clock = time;
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(time);
}

function reveals(element: Element) {
  return animations.filter(
    (animation) =>
      animation.target === element &&
      animation.keyframes[0]?.opacity === 0 &&
      animation.options.fill === "backwards",
  );
}

function boxes(container: HTMLElement): HTMLElement[] {
  const layer = container.querySelector(':scope > [aria-hidden="true"]');
  return layer ? (Array.from(layer.children) as HTMLElement[]) : [];
}

function build(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  place(container, 0, 0, 1000, 800);
  return container;
}

describe("createDraftOutlines", () => {
  beforeEach(() => {
    clock = 0;
    animations = [];
    frames = [];
    reducedMotion = false;
    rects.clear();
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      frames = [];
    });
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: reducedMotion && query.includes("reduce"),
        }) as MediaQueryList,
    );
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const rect = rects.get(this) ?? { x: 0, y: 0, w: 0, h: 0 };
        return {
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          right: rect.x + rect.w,
          bottom: rect.y + rect.h,
          x: rect.x,
          y: rect.y,
          toJSON: () => rect,
        } as DOMRect;
      },
    );
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value(
        this: Element,
        keyframes: Keyframe[],
        options: KeyframeAnimationOptions,
      ) {
        const animation: RecordedAnimation = {
          target: this,
          keyframes,
          options,
          onfinish: null,
        };
        animations.push(animation);
        return animation;
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("does nothing when the viewer prefers reduced motion", () => {
    reducedMotion = true;
    const container = build("<section><p>Hi</p></section>");
    const drafts = createDraftOutlines(container, "blue");
    drafts.track(container.firstElementChild as Element);

    expect(container.hasAttribute(DRAFTING_ATTRIBUTE)).toBe(false);
    expect(container.children).toHaveLength(1);
    expect(animations).toHaveLength(0);
    expect(frames).toHaveLength(0);
  });

  it("marks the container while drafting and cleans up on dispose", () => {
    const container = build("<section></section>");
    const drafts = createDraftOutlines(container, "blue");
    expect(container.hasAttribute(DRAFTING_ATTRIBUTE)).toBe(true);
    const layer = container.lastElementChild as HTMLElement;
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.style.pointerEvents).toBe("none");

    drafts.dispose();
    expect(container.hasAttribute(DRAFTING_ATTRIBUTE)).toBe(false);
    expect(container.contains(layer)).toBe(false);
  });

  it("reveals each element after its own frame, parents before children", () => {
    const container = build(
      "<section><div>One</div><div>Two</div><b>skip</b><script></script></section>",
    );
    const section = container.firstElementChild as Element;
    const [first, second, bold, script] = Array.from(section.children);
    createDraftOutlines(container, "blue").track(section);

    // Each element appears 80% of the way through its 260ms frame draw.
    expect(reveals(section).map((a) => a.options.delay)).toEqual([208]);
    // Children start one level (110ms) later, siblings 55ms apart.
    expect(reveals(first as Element).map((a) => a.options.delay)).toEqual([
      318,
    ]);
    expect(reveals(second as Element).map((a) => a.options.delay)).toEqual([
      373,
    ]);
    expect(reveals(bold as Element)).toHaveLength(0);
    expect(reveals(script as Element)).toHaveLength(0);
    expect(reveals(section)[0]?.options.duration).toBe(260);
  });

  it("queues elements that arrive together instead of firing at once", () => {
    const container = build("<div>One</div><div>Two</div><div>Three</div>");
    const [one, two, three] = Array.from(container.children);
    const drafts = createDraftOutlines(container, "blue");
    drafts.track(one as Element);
    drafts.track(two as Element);
    drafts.track(three as Element);

    expect(reveals(one as Element)[0]?.options.delay).toBe(208);
    expect(reveals(two as Element)[0]?.options.delay).toBe(263);
    expect(reveals(three as Element)[0]?.options.delay).toBe(318);
  });

  it("never queues an arrival more than the sequence cap behind", () => {
    const container = build(
      Array.from({ length: 100 }, (_, i) => `<div>${i}</div>`).join(""),
    );
    const drafts = createDraftOutlines(container, "blue");
    for (const element of Array.from(container.children)) {
      drafts.track(element);
    }

    const delays = animations
      .filter((animation) => animation.options.fill === "backwards")
      .map((animation) => animation.options.delay ?? 0);
    // 100 arrivals 55ms apart would reach 5.4s; the queue stops at 3.2s.
    expect(Math.max(...delays)).toBe(3200 + 208);
    expect(delays[58]).toBe(58 * 55 + 208);

    // A later arrival is measured from its own arrival time.
    clock = 10_000;
    const late = document.createElement("div");
    container.appendChild(late);
    drafts.track(late);
    expect(reveals(late)[0]?.options.delay).toBe(208);
  });

  it("stops animating once the frame cap is reached", () => {
    const items = Array.from({ length: 400 }, (_, i) => `<li>${i}</li>`).join(
      "",
    );
    const container = build(`<ul>${items}</ul>`);
    createDraftOutlines(container, "blue").track(
      container.firstElementChild as Element,
    );

    const revealed = animations.filter(
      (animation) => animation.options.fill === "backwards",
    );
    expect(revealed).toHaveLength(160);
    expect(revealed[0]?.target).toBe(container.firstElementChild);
  });

  it("compresses long sibling lists so the last one starts promptly", () => {
    const items = Array.from({ length: 41 }, (_, i) => `<li>${i}</li>`).join(
      "",
    );
    const container = build(`<ul>${items}</ul>`);
    const list = container.firstElementChild as Element;
    createDraftOutlines(container, "blue").track(list);

    const last = list.lastElementChild as Element;
    // 40 gaps share 1100ms, so each is 27.5ms instead of 55ms.
    expect(reveals(last)[0]?.options.delay).toBe(208 + 110 + 1100);
  });

  it("caps how late any element in one arrival can start", () => {
    let html = "<i>leaf</i>";
    for (let depth = 0; depth < 40; depth++) html = `<div>${html}</div>`;
    const container = build(html);
    const outer = container.firstElementChild as Element;
    createDraftOutlines(container, "blue").track(outer);

    const delays = animations
      .filter((animation) => animation.options.fill === "backwards")
      .map((animation) => animation.options.delay ?? 0);
    expect(Math.max(...delays)).toBe(3200 + 208);
  });

  it("strokes a frame once an element's turn comes and its box is big enough", () => {
    const container = build("<section><div>One</div></section>");
    const section = container.firstElementChild as Element;
    const child = section.firstElementChild as Element;
    place(section, 100, 50, 400, 300);
    place(child, 120, 60, 200, 40);
    createDraftOutlines(container, "#609ff8").track(section);

    frameAt(16);
    const [sectionBox] = boxes(container);
    expect(boxes(container)).toHaveLength(1);
    expect(sectionBox?.style.left).toBe("100px");
    expect(sectionBox?.style.top).toBe("50px");
    expect(sectionBox?.style.width).toBe("400px");
    expect(sectionBox?.style.height).toBe("300px");
    const stroke = sectionBox?.querySelector("rect");
    expect(stroke?.getAttribute("stroke")).toBe("#609ff8");
    expect(stroke?.getAttribute("pathLength")).toBe("1");
    const draw = animations.find((a) => a.target === stroke);
    expect(draw?.keyframes).toEqual([
      { strokeDashoffset: 1 },
      { strokeDashoffset: 0 },
    ]);
    expect(draw?.options.duration).toBe(260);

    // The child's frame waits for its 110ms turn.
    frameAt(100);
    expect(boxes(container)).toHaveLength(1);
    frameAt(120);
    expect(boxes(container)).toHaveLength(2);
  });

  it("fades a frame once its box has held still, then removes it", () => {
    const container = build("<section></section>");
    const section = container.firstElementChild as Element;
    place(section, 0, 0, 300, 200);
    createDraftOutlines(container, "blue").track(section);

    frameAt(10);
    const [box] = boxes(container);
    expect(box).toBeDefined();
    frameAt(20);
    // Still within the draw and hold.
    frameAt(700);
    expect(animations.some((a) => a.target === box)).toBe(false);
    frameAt(800);
    const fade = animations.find((a) => a.target === box);
    expect(fade?.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(fade?.options.duration).toBe(300);
    fade?.onfinish?.();
    expect(boxes(container)).toHaveLength(0);
  });

  it("keeps a frame up while its box is still growing", () => {
    const container = build("<section></section>");
    const section = container.firstElementChild as Element;
    place(section, 0, 0, 300, 200);
    createDraftOutlines(container, "blue").track(section);

    frameAt(10);
    const [box] = boxes(container);
    frameAt(20);
    place(section, 0, 0, 300, 260);
    frameAt(790);
    expect(box?.style.height).toBe("260px");
    expect(animations.some((a) => a.target === box)).toBe(false);
  });

  it("drops elements that never get a usable box or leave the page", () => {
    const container = build("<div>tiny</div><div>gone</div>");
    const [tiny, gone] = Array.from(container.children);
    place(tiny as Element, 0, 0, 4, 4);
    place(gone as Element, 0, 0, 200, 100);
    const drafts = createDraftOutlines(container, "blue");
    drafts.track(tiny as Element);
    drafts.track(gone as Element);
    gone?.remove();

    frameAt(100);
    expect(boxes(container)).toHaveLength(0);
    expect(frames).toHaveLength(1);
    frameAt(2700);
    // Both entries are gone, so the frame loop stops.
    expect(frames).toHaveLength(0);
  });

  it("skips inline elements", () => {
    const container = build("<span>text</span>");
    const span = container.firstElementChild as HTMLElement;
    span.style.display = "inline";
    place(span, 0, 0, 80, 20);
    createDraftOutlines(container, "blue").track(span);

    frameAt(16);
    expect(boxes(container)).toHaveLength(0);
  });

  it("positions frames in the container's unscaled coordinates", () => {
    const container = build("<section></section>");
    const section = container.firstElementChild as Element;
    Object.defineProperty(container, "offsetWidth", { value: 2000 });
    Object.defineProperty(container, "offsetHeight", { value: 1600 });
    place(container, 10, 20, 1000, 800);
    place(section, 110, 70, 400, 300);
    createDraftOutlines(container, "blue").track(section);

    frameAt(16);
    const [box] = boxes(container);
    expect(box?.style.left).toBe("200px");
    expect(box?.style.top).toBe("100px");
    expect(box?.style.width).toBe("800px");
    expect(box?.style.height).toBe("600px");
  });
});
