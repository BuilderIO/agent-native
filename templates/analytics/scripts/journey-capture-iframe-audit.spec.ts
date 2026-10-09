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
  it("handles accessible child documents without an HTML body", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 40, height: 40 },
      40,
      40,
    );
    frame.contentDocument!.body?.remove();
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 0 });
  });

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

  it("reports depth-limited frames as unverifiable after checking their content", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const frames: HTMLIFrameElement[] = [];
    let owner = replayFrame.contentDocument!;
    for (let depth = 0; depth <= 8; depth += 1) {
      const frame = appendFrame(
        owner,
        {
          left: depth === 0 ? 10 : 0,
          top: depth === 0 ? 10 : 0,
          width: 20,
          height: 20,
        },
        20,
        20,
      );
      frames.push(frame);
      owner = frame.contentDocument!;
    }
    const ids = new WeakMap<Element, number>(
      frames.map((frame, index) => [frame, index + 1]),
    );
    installReplayState(replayFrame, ids);

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: frames.map((_, index) => index + 1),
      }),
    ).toEqual({
      visibleIframeCount: 9,
      unavailableIframeCount: 0,
      unverifiableIframeCount: 1,
    });
  });

  it("still reports missing content on a frame at the traversal depth limit", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const frames: HTMLIFrameElement[] = [];
    let owner = replayFrame.contentDocument!;
    for (let depth = 0; depth <= 8; depth += 1) {
      const frame = appendFrame(
        owner,
        {
          left: depth === 0 ? 10 : 0,
          top: depth === 0 ? 10 : 0,
          width: 20,
          height: 20,
        },
        20,
        20,
      );
      frames.push(frame);
      owner = frame.contentDocument!;
    }
    const ids = new WeakMap<Element, number>(
      frames.map((frame, index) => [frame, index + 1]),
    );
    installReplayState(replayFrame, ids);

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: frames
          .slice(0, -1)
          .map((_, index) => index + 1),
      }),
    ).toEqual({ visibleIframeCount: 9, unavailableIframeCount: 1 });
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

  it("does not apply legacy clipping to a static ancestor", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const clipper = replayDocument.createElement("div");
    clipper.style.position = "static";
    clipper.style.setProperty("clip", "rect(0px, 10px, 10px, 0px)");
    replayDocument.body.append(clipper);
    setBox(clipper, { left: 0, top: 0, width: 20, height: 20 }, 20, 20);
    const outer = appendFrame(
      replayDocument,
      { left: 30, top: 30, width: 20, height: 20 },
      20,
      20,
      clipper,
    );
    const inner = appendFrame(
      outer.contentDocument!,
      { left: 5, top: 5, width: 10, height: 10 },
      10,
      10,
    );
    installReplayState(
      replayFrame,
      new WeakMap([
        [outer, 1],
        [inner, 2],
      ]),
    );

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1, 2],
      }),
    ).toEqual({ visibleIframeCount: 2, unavailableIframeCount: 0 });
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

  it("does not clip an iframe outside a container-type ancestor", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const container = replayDocument.createElement("div");
    container.style.setProperty("container-type", "inline-size");
    container.style.willChange = "container-type";
    container.style.overflow = "hidden";
    replayDocument.body.append(container);
    setBox(container, { left: 0, top: 0, width: 20, height: 20 }, 20, 20);
    const frame = appendFrame(
      replayDocument,
      { left: 30, top: 30, width: 20, height: 20 },
      20,
      20,
      container,
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

  it("ignores transforms on non-replaced inline ancestors", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const inline = replayDocument.createElement("span");
    inline.style.display = "inline";
    inline.style.transform = "rotate(45deg)";
    replayDocument.body.append(inline);
    const frame = appendFrame(
      replayDocument,
      { left: -18, top: -18, width: 20, height: 20 },
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

  it("clips paint containment to the padding edge", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const contained = replayDocument.createElement("div");
    contained.style.contain = "paint";
    contained.style.border = "10px solid";
    contained.style.padding = "20px";
    contained.style.position = "relative";
    replayDocument.body.append(contained);
    setBox(
      contained,
      { left: -60, top: 0, width: 160, height: 160 },
      140,
      140,
      10,
      10,
    );
    const frame = appendFrame(
      replayDocument,
      { left: 91, top: 50, width: 5, height: 20 },
      5,
      20,
      contained,
    );
    frame.style.position = "absolute";
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1],
      }),
    ).toEqual({ visibleIframeCount: 0, unavailableIframeCount: 0 });
  });

  it("ignores an iframe fully excluded by an inset clip-path", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const clipped = replayDocument.createElement("div");
    clipped.style.clipPath = "inset(40px)";
    replayDocument.body.append(clipped);
    setBox(clipped, { left: 0, top: 0, width: 100, height: 100 }, 100, 100);
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
      clipped,
    );
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({ visibleIframeCount: 0, unavailableIframeCount: 0 });
  });

  it("fails closed when a CSS mask has an unknown visible region", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const masked = replayDocument.createElement("div");
    masked.style.setProperty(
      "mask-image",
      "linear-gradient(black, transparent)",
    );
    expect(masked.style.getPropertyValue("mask-image")).toBe(
      "linear-gradient(black, transparent)",
    );
    replayDocument.body.append(masked);
    setBox(masked, { left: 0, top: 0, width: 100, height: 100 }, 100, 100);
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
      masked,
    );
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({
      visibleIframeCount: 0,
      unavailableIframeCount: 0,
      unverifiableIframeCount: 1,
    });
  });

  it("ignores an iframe fully excluded by a legacy CSS clip", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
    );
    frame.style.position = "absolute";
    frame.style.clip = "rect(0px, 0px, 0px, 0px)";
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({ visibleIframeCount: 0, unavailableIframeCount: 0 });
  });

  it("keeps a partly visible iframe under a legacy CSS clip", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
    );
    frame.style.position = "absolute";
    frame.style.clip = "rect(0px, 10px, 20px, 0px)";
    const visibleChild = appendFrame(
      frame.contentDocument!,
      { left: 2, top: 2, width: 5, height: 5 },
      5,
      5,
    );
    const clippedChild = appendFrame(
      frame.contentDocument!,
      { left: 12, top: 2, width: 5, height: 5 },
      5,
      5,
    );
    installReplayState(
      replayFrame,
      new WeakMap([
        [frame, 1],
        [visibleChild, 2],
        [clippedChild, 3],
      ]),
    );

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1, 2, 3],
      }),
    ).toEqual({ visibleIframeCount: 2, unavailableIframeCount: 0 });
  });

  it("applies a legacy CSS clip from a positioned ancestor in ancestor coordinates", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const clipper = replayDocument.createElement("div");
    clipper.style.cssText = "position:absolute;clip:rect(0px, 20px, 20px, 0px)";
    replayDocument.body.append(clipper);
    setBox(clipper, { left: 40, top: 40, width: 30, height: 20 }, 30, 20);
    const hidden = appendFrame(
      replayDocument,
      { left: 62, top: 45, width: 10, height: 10 },
      10,
      10,
      clipper,
    );
    const partlyVisible = appendFrame(
      replayDocument,
      { left: 55, top: 45, width: 10, height: 10 },
      10,
      10,
      clipper,
    );
    installReplayState(
      replayFrame,
      new WeakMap([
        [hidden, 1],
        [partlyVisible, 2],
      ]),
    );

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [2],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 0 });
  });

  it("treats an empty legacy clip on zero-sized geometry as deterministically empty", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const clipper = replayDocument.createElement("div");
    clipper.style.cssText = "position:absolute;clip:rect(0px, 0px, 0px, 0px)";
    replayDocument.body.append(clipper);
    setBox(clipper, { left: 10, top: 10, width: 0, height: 0 }, 0, 0);
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
      clipper,
    );
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1],
      }),
    ).toEqual({ visibleIframeCount: 0, unavailableIframeCount: 0 });
  });

  it("fails closed when a legacy CSS clip rectangle has unsupported offsets", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
    );
    frame.style.position = "absolute";
    const view = replayDocument.defaultView!;
    const nativeGetComputedStyle = view.getComputedStyle.bind(view);
    Object.defineProperty(view, "getComputedStyle", {
      configurable: true,
      value: (element: Element, pseudoElement?: string | null) => {
        const styles = nativeGetComputedStyle(element, pseudoElement);
        if (element !== frame) return styles;
        return new Proxy(styles, {
          get(target, property) {
            if (property === "getPropertyValue") {
              return (name: string) =>
                name === "clip"
                  ? "rect(0px, calc(20px + 1em), 20px, 0px)"
                  : target.getPropertyValue(name);
            }
            return Reflect.get(target, property, target);
          },
        }) as CSSStyleDeclaration;
      },
    });
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({
      visibleIframeCount: 0,
      unavailableIframeCount: 0,
      unverifiableIframeCount: 1,
    });
  });

  it("does not reject an iframe inside the center of a rounded inset clip", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const clipped = replayDocument.createElement("div");
    clipped.style.clipPath = "inset(0 round 20px)";
    replayDocument.body.append(clipped);
    setBox(clipped, { left: 10, top: 10, width: 80, height: 80 }, 80, 80);
    const frame = appendFrame(
      replayDocument,
      { left: 45, top: 45, width: 10, height: 10 },
      10,
      10,
      clipped,
    );
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1],
      }),
    ).toEqual({ visibleIframeCount: 1, unavailableIframeCount: 0 });
  });

  it("fails closed when an iframe may overlap a rounded inset corner", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const clipped = replayDocument.createElement("div");
    clipped.style.clipPath = "inset(0 round 20px)";
    replayDocument.body.append(clipped);
    setBox(clipped, { left: 10, top: 10, width: 80, height: 80 }, 80, 80);
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 10, height: 10 },
      10,
      10,
      clipped,
    );
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1],
      }),
    ).toEqual({
      visibleIframeCount: 0,
      unavailableIframeCount: 0,
      unverifiableIframeCount: 1,
    });
  });

  it("fails closed when a rounded paint clip may intersect the iframe", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const contained = replayDocument.createElement("div");
    contained.style.contain = "paint";
    contained.style.borderRadius = "40px";
    replayDocument.body.append(contained);
    setBox(contained, { left: 10, top: 10, width: 80, height: 80 }, 80, 80);
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 10, height: 10 },
      10,
      10,
      contained,
    );
    frame.style.position = "absolute";
    installReplayState(replayFrame, new WeakMap([[frame, 1]]));

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [1],
      }),
    ).toEqual({
      visibleIframeCount: 0,
      unavailableIframeCount: 0,
      unverifiableIframeCount: 1,
    });
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

  it("ignores frames hidden by an ancestor with a zero-opacity filter", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const hidden = replayDocument.createElement("div");
    hidden.style.filter = "opacity(0)";
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

  it("fails closed for filters whose iframe visibility is not fully known", () => {
    const replayFrame = appendFrame(
      document,
      { left: 0, top: 0, width: 100, height: 100 },
      100,
      100,
    );
    const replayDocument = replayFrame.contentDocument!;
    const filtered = replayDocument.createElement("div");
    filtered.style.filter = "blur(1px)";
    replayDocument.body.append(filtered);
    const frame = appendFrame(
      replayDocument,
      { left: 10, top: 10, width: 20, height: 20 },
      20,
      20,
    );
    filtered.append(frame);
    installReplayState(replayFrame, new WeakMap());

    expect(
      auditReplayIframeContent({
        dimensions: { width: 100, height: 100 },
        recordedIframeParentIds: [],
      }),
    ).toEqual({
      visibleIframeCount: 0,
      unavailableIframeCount: 0,
      unverifiableIframeCount: 1,
    });
  });
});
