// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { auditReplayIframeContent } from "./journey-capture-iframe-audit";

type Rect = { left: number; top: number; width: number; height: number };

function setBox(
  element: HTMLElement,
  rect: Rect,
  clientWidth: number,
  clientHeight: number,
  clientLeft = 0,
  clientTop = 0,
): void {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: clientHeight },
    clientLeft: { configurable: true, value: clientLeft },
    clientTop: { configurable: true, value: clientTop },
    clientWidth: { configurable: true, value: clientWidth },
    offsetHeight: { configurable: true, value: rect.height },
    offsetWidth: { configurable: true, value: rect.width },
  });
  element.getBoundingClientRect = () =>
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
}

function appendClipper(
  owner: Document,
  rect: Rect,
  clientWidth: number,
  clientHeight: number,
  parent: Element = owner.body,
): HTMLDivElement {
  const clipper = owner.createElement("div");
  clipper.style.overflow = "hidden";
  parent.append(clipper);
  setBox(clipper, rect, clientWidth, clientHeight);
  return clipper;
}

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
  setBox(frame, rect, clientWidth, clientHeight, clientLeft, clientTop);
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
    const clipper = appendClipper(
      replayDocument,
      { left: 0, top: 0, width: 20, height: 20 },
      20,
      20,
    );
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

  it("does not clip frames against boxless display-contents ancestors", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const contents = replayDocument.createElement("div");
    contents.style.display = "contents";
    contents.style.overflow = "hidden";
    contents.style.contain = "paint";
    replayDocument.body.append(contents);
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
      contents,
    );
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 1 });
  });

  it("does not treat a boxless contents ancestor as an absolute containing block", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const containingBlock = replayDocument.createElement("div");
    containingBlock.style.position = "relative";
    replayDocument.body.append(containingBlock);
    const clipper = appendClipper(
      replayDocument,
      { left: 0, top: 0, width: 20, height: 20 },
      20,
      20,
      containingBlock,
    );
    const contents = replayDocument.createElement("div");
    contents.style.display = "contents";
    contents.style.position = "relative";
    contents.style.contain = "paint";
    clipper.append(contents);
    const frame = appendFrame(
      replayDocument,
      { left: 30, top: 30, width: 20, height: 20 },
      20,
      20,
      contents,
    );
    frame.style.position = "absolute";
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 1 });
  });

  it("does not clip frames against non-atomic inline ancestors", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const inline = replayDocument.createElement("span");
    inline.style.display = "inline";
    inline.style.overflow = "hidden";
    inline.style.contain = "paint";
    replayDocument.body.append(inline);
    setBox(inline, { left: 0, top: 0, width: 0, height: 0 }, 0, 0);
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
      inline,
    );
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 1 });
  });

  it("uses the CSS containing block when an absolute frame has a different offset parent", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const containingBlock = replayDocument.createElement("div");
    containingBlock.style.position = "relative";
    replayDocument.body.append(containingBlock);
    const clipper = appendClipper(
      replayDocument,
      { left: 0, top: 0, width: 20, height: 20 },
      20,
      20,
      containingBlock,
    );
    const frame = appendFrame(
      replayDocument,
      { left: 30, top: 30, width: 20, height: 20 },
      20,
      20,
      clipper,
    );
    frame.style.position = "absolute";
    frame.style.zoom = "2";
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 1 });
  });

  it("clips a fixed frame only when an ancestor establishes its containing block", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const viewportWrapper = appendClipper(
      replayDocument,
      { left: 0, top: 0, width: 20, height: 20 },
      20,
      20,
    );
    const escaped = appendFrame(
      replayDocument,
      { left: 30, top: 30, width: 20, height: 20 },
      20,
      20,
      viewportWrapper,
    );
    escaped.style.position = "fixed";
    const fixedContainingBlock = appendClipper(
      replayDocument,
      { left: 50, top: 50, width: 20, height: 20 },
      20,
      20,
    );
    fixedContainingBlock.style.transform = "translateZ(0)";
    const clipped = appendFrame(
      replayDocument,
      { left: 75, top: 75, width: 20, height: 20 },
      20,
      20,
      fixedContainingBlock,
    );
    clipped.style.position = "fixed";
    installReplayState(
      replayFrame,
      new WeakMap([
        [escaped, 1],
        [clipped, 2],
      ]),
    );

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 1 });
  });

  it("uses the initial containing block when offsetParent falls back to a short body", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    replayDocument.documentElement.style.overflow = "hidden";
    replayDocument.documentElement.style.contain = "none";
    replayDocument.body.style.display = "block";
    replayDocument.body.style.position = "static";
    replayDocument.body.style.overflow = "hidden";
    replayDocument.body.style.contain = "none";
    setBox(
      replayDocument.body,
      { left: 0, top: 0, width: 100, height: 1 },
      100,
      1,
    );
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
    );
    frame.style.position = "absolute";
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 1 });
  });

  it("uses the viewport when body overflow propagates to it", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    replayDocument.documentElement.style.overflow = "visible";
    replayDocument.documentElement.style.contain = "none";
    replayDocument.body.style.display = "block";
    replayDocument.body.style.position = "static";
    replayDocument.body.style.overflow = "hidden";
    replayDocument.body.style.contain = "none";
    setBox(
      replayDocument.body,
      { left: 0, top: 0, width: 100, height: 1 },
      100,
      1,
    );
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
    );
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 1 });
  });

  it("uses the viewport for root overflow instead of the root element box", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    replayDocument.documentElement.style.overflow = "hidden";
    setBox(
      replayDocument.documentElement,
      { left: 0, top: 0, width: 100, height: 1 },
      100,
      1,
    );
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
    );
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 1 });
  });

  it("clips an iframe outside a paint-contained ancestor", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const contained = replayDocument.createElement("div");
    contained.style.contain = "paint";
    replayDocument.body.append(contained);
    setBox(contained, { left: 0, top: 0, width: 20, height: 20 }, 20, 20);
    const frame = appendFrame(
      replayDocument,
      { left: 30, top: 30, width: 20, height: 20 },
      20,
      20,
      contained,
    );
    frame.style.position = "absolute";
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
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
    const clipper = appendClipper(
      replayDocument,
      { left: 0, top: 0, width: 50, height: 80 },
      50,
      80,
    );
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
