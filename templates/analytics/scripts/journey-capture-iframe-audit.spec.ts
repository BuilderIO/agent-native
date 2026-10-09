// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { auditReplayIframeContent } from "./journey-capture-iframe-audit";

type Rect = { left: number; top: number; width: number; height: number };

function setViewport(view: Window | null, width: number, height: number): void {
  if (!view) throw new Error("iframe_view_missing");
  Object.defineProperties(view, {
    innerHeight: { configurable: true, value: height },
    innerWidth: { configurable: true, value: width },
  });
}

function appendFrame(
  owner: Document,
  rect: Rect,
  clientWidth: number,
  clientHeight: number,
): HTMLIFrameElement {
  const frame = owner.createElement("iframe");
  owner.body.append(frame);
  Object.defineProperties(frame, {
    clientHeight: { configurable: true, value: clientHeight },
    clientWidth: { configurable: true, value: clientWidth },
    offsetHeight: { configurable: true, value: rect.height },
    offsetWidth: { configurable: true, value: rect.width },
  });
  frame.getBoundingClientRect = () =>
    ({
      bottom: rect.top + rect.height,
      height: rect.height,
      left: rect.left,
      right: rect.left + rect.width,
      top: rect.top,
      width: rect.width,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  setViewport(
    frame.contentDocument?.defaultView ?? null,
    clientWidth,
    clientHeight,
  );
  return frame;
}

function installReplayState(
  frame: HTMLIFrameElement,
  ids: WeakMap<Element, number>,
): void {
  (
    window as typeof window & { __anJourneyCapture?: unknown }
  ).__anJourneyCapture = {
    replayer: {
      getMirror: () => ({ getId: (element: Element) => ids.get(element) }),
      iframe: frame,
    },
  };
}

afterEach(() => {
  delete (window as typeof window & { __anJourneyCapture?: unknown })
    .__anJourneyCapture;
  document.body.replaceChildren();
});

describe("replay iframe audit", () => {
  it("checks visible nested frames in their child documents", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const outer = appendFrame(
      replayDocument,
      { left: 0, top: 0, width: 80, height: 80 },
      80,
      80,
    );
    const inner = appendFrame(
      outer.contentDocument!,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
    );
    const ids = new WeakMap<Element, number>([
      [outer, 1],
      [inner, 2],
    ]);
    installReplayState(replayFrame, ids);

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1],
      }),
    ).toEqual({ visibleIframeCount: 2, unavailableIframeCount: 1 });
  });

  it("does not count a nested frame outside its parent's visible bounds", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const outer = appendFrame(
      replayFrame.contentDocument!,
      { left: 80, top: 0, width: 40, height: 40 },
      40,
      40,
    );
    const inner = appendFrame(
      outer.contentDocument!,
      { left: 25, top: 5, width: 5, height: 5 },
      5,
      5,
    );
    const ids = new WeakMap<Element, number>([
      [outer, 1],
      [inner, 2],
    ]);
    installReplayState(replayFrame, ids);

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 0 });
  });

  it("ignores frames hidden by an ancestor with zero opacity", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const hidden = replayDocument.createElement("div");
    hidden.style.opacity = "0";
    replayDocument.body.append(hidden);
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
    );
    hidden.append(frame);
    installReplayState(replayFrame, new WeakMap());

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({ visibleIframeCount: 0, unavailableIframeCount: 0 });
  });
});
