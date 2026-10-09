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
  parent: Element = owner.body,
  clientLeft = 0,
  clientTop = 0,
): HTMLIFrameElement {
  const frame = owner.createElement("iframe");
  parent.append(frame);
  Object.defineProperties(frame, {
    clientHeight: { configurable: true, value: clientHeight },
    clientLeft: { configurable: true, value: clientLeft },
    clientTop: { configurable: true, value: clientTop },
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

  it("audits an iframe assigned directly to a shadow-root slot", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const host = replayDocument.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(replayDocument.createElement("slot"));
    replayDocument.body.append(host);
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
    );
    host.append(frame);
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 0 });
  });

  it("follows iframe content through forwarded slots", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const host = replayDocument.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const slot = replayDocument.createElement("slot");
    shadow.append(slot);
    replayDocument.body.append(host);
    const forwardedSlot = replayDocument.createElement("slot");
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
      host,
    );
    host.append(forwardedSlot);
    Object.defineProperty(slot, "assignedNodes", {
      configurable: true,
      value: () => [forwardedSlot],
    });
    Object.defineProperty(forwardedSlot, "assignedNodes", {
      configurable: true,
      value: () => [frame],
    });
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 0 });
  });

  it("walks fallback content when a slot has no assigned nodes", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const host = replayDocument.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const slot = replayDocument.createElement("slot");
    const frame = replayDocument.createElement("iframe");
    slot.append(frame);
    shadow.append(slot);
    replayDocument.body.append(host);
    Object.defineProperties(frame, {
      clientHeight: { configurable: true, value: 20 },
      clientWidth: { configurable: true, value: 20 },
      offsetHeight: { configurable: true, value: 20 },
      offsetWidth: { configurable: true, value: 20 },
    });
    frame.getBoundingClientRect = () =>
      ({
        bottom: 30,
        height: 20,
        left: 10,
        right: 30,
        top: 10,
        width: 20,
        x: 10,
        y: 10,
        toJSON: () => ({}),
      }) as DOMRect;
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 0 });
  });

  it("ignores frames clipped outside an overflow ancestor", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const clipper = replayDocument.createElement("div");
    clipper.style.overflow = "hidden";
    replayDocument.body.append(clipper);
    Object.defineProperties(clipper, {
      clientHeight: { configurable: true, value: 20 },
      clientWidth: { configurable: true, value: 20 },
      offsetHeight: { configurable: true, value: 20 },
      offsetWidth: { configurable: true, value: 20 },
    });
    clipper.getBoundingClientRect = () =>
      ({
        bottom: 20,
        height: 20,
        left: 0,
        right: 20,
        top: 0,
        width: 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const frame = appendFrame(
      replayDocument,
      { left: 30, top: 30, width: 20, height: 20 },
      20,
      20,
      clipper,
    );
    const nested = appendFrame(
      frame.contentDocument!,
      { left: 5, top: 5, width: 10, height: 10 },
      10,
      10,
    );
    installReplayState(
      replayFrame,
      new WeakMap([
        [frame, 1],
        [nested, 2],
      ]),
    );

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1, 2],
      }),
    ).toEqual({ visibleIframeCount: 0, unavailableIframeCount: 0 });
  });

  it("maps ancestor clipping into a nested document before auditing", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const clipper = replayDocument.createElement("div");
    clipper.style.overflow = "hidden";
    replayDocument.body.append(clipper);
    Object.defineProperties(clipper, {
      clientHeight: { configurable: true, value: 80 },
      clientWidth: { configurable: true, value: 50 },
      offsetHeight: { configurable: true, value: 80 },
      offsetWidth: { configurable: true, value: 50 },
    });
    clipper.getBoundingClientRect = () =>
      ({
        bottom: 80,
        height: 80,
        left: 0,
        right: 50,
        top: 0,
        width: 50,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const outer = appendFrame(
      replayDocument,
      { left: 40, top: 0, width: 40, height: 40 },
      40,
      40,
      clipper,
    );
    const visible = appendFrame(
      outer.contentDocument!,
      { left: 5, top: 5, width: 5, height: 5 },
      5,
      5,
    );
    const clipped = appendFrame(
      outer.contentDocument!,
      { left: 15, top: 5, width: 5, height: 5 },
      5,
      5,
    );
    installReplayState(
      replayFrame,
      new WeakMap([
        [outer, 1],
        [visible, 2],
        [clipped, 3],
      ]),
    );

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1, 2],
      }),
    ).toEqual({ visibleIframeCount: 2, unavailableIframeCount: 0 });
  });

  it("ignores a frame whose only visible area is its border", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const frame = appendFrame(
      replayFrame.contentDocument!,
      { left: -95, top: 0, width: 100, height: 100 },
      80,
      80,
      replayFrame.contentDocument!.body,
      10,
      10,
    );
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({ visibleIframeCount: 0, unavailableIframeCount: 0 });
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
