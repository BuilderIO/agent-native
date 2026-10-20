// @vitest-environment happy-dom

import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { collectLiveSizeHints } from "./frame-selection";

const FIXTURE = `<body>
  <div data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha"></div>
</body>`;

const ABSOLUTE_FIXTURE = `<body>
  <div data-agent-native-node-id="absolute" style="position:absolute;left:1px;top:2px"></div>
</body>`;

function nodeIdFor(fixture: string, rawId: string): string {
  return buildCodeLayerProjection(fixture).nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === rawId,
  )!.id;
}

function alphaId(): string {
  return nodeIdFor(FIXTURE, "alpha");
}

function absoluteId(): string {
  return buildCodeLayerProjection(ABSOLUTE_FIXTURE).nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "absolute",
  )!.id;
}

function stubIframeLayoutSize(
  iframe: HTMLIFrameElement,
  rect: { width: number; height: number },
): void {
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<div data-agent-native-node-id="alpha"></div>';
  const element = doc.querySelector<HTMLElement>(
    "[data-agent-native-node-id]",
  )!;
  vi.spyOn(element, "offsetWidth", "get").mockReturnValue(rect.width);
  vi.spyOn(element, "offsetHeight", "get").mockReturnValue(rect.height);
}

function mountScreenIframe(
  screenIframeId: string,
  rect: { width: number; height: number },
): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-design-preview-iframe", "");
  iframe.setAttribute("data-screen-iframe-id", screenIframeId);
  document.body.append(iframe);
  stubIframeLayoutSize(iframe, rect);
}

function mountBoardIframe(rect: { width: number; height: number }): void {
  const layer = document.createElement("div");
  layer.setAttribute("data-board-surface-layer", "");
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-design-preview-iframe", "");
  layer.append(iframe);
  document.body.append(layer);
  stubIframeLayoutSize(iframe, rect);
}

function stubRect(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    bottom: rect.top + rect.height,
    height: rect.height,
    left: rect.left,
    right: rect.left + rect.width,
    top: rect.top,
    width: rect.width,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  } as DOMRect);
}

describe("collectLiveSizeHints", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reads the active file's own iframe, ignoring a duplicate screen's colliding node id", () => {
    mountScreenIframe("other.html", { width: 999, height: 999 });
    mountScreenIframe("active.html", { width: 120, height: 40 });

    const projection = buildCodeLayerProjection(FIXTURE);
    const hints = collectLiveSizeHints(
      [alphaId()],
      projection,
      "active.html",
      undefined,
    );

    expect(hints[alphaId()]).toEqual({ width: 120, height: 40 });
  });

  it("returns no hint when the active file's iframe cannot be found", () => {
    mountScreenIframe("other.html", { width: 999, height: 999 });

    const projection = buildCodeLayerProjection(FIXTURE);
    const hints = collectLiveSizeHints(
      [alphaId()],
      projection,
      "active.html",
      undefined,
    );

    expect(hints).toEqual({});
  });

  it("resolves the dedicated board iframe when the active file is the board file", () => {
    mountScreenIframe("screen-a.html", { width: 999, height: 999 });
    mountBoardIframe({ width: 150, height: 60 });

    const projection = buildCodeLayerProjection(FIXTURE);
    const hints = collectLiveSizeHints(
      [alphaId()],
      projection,
      "board",
      "board",
    );

    expect(hints[alphaId()]).toEqual({ width: 150, height: 60 });
  });

  it("measures in the active breakpoint sub-frame, not the primary screen iframe", () => {
    mountScreenIframe("screen-a.html", { width: 999, height: 999 });
    mountScreenIframe("screen-a.html::bp-390", { width: 200, height: 80 });

    const projection = buildCodeLayerProjection(FIXTURE);
    const hints = collectLiveSizeHints(
      [alphaId()],
      projection,
      "screen-a.html::bp-390",
      undefined,
    );

    expect(hints[alphaId()]).toEqual({ width: 200, height: 80 });
  });

  it("adds parent-content-relative offsets from the active iframe layout", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    iframe.setAttribute("data-screen-iframe-id", "active.html");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = `<main style="border-left:2px solid black;border-top:3px solid black;padding:10px">
  <div data-agent-native-node-id="alpha"></div>
</main>`;
    const parent = doc.querySelector("main")!;
    const element = doc.querySelector<HTMLElement>(
      "[data-agent-native-node-id]",
    )!;
    vi.spyOn(element, "offsetWidth", "get").mockReturnValue(25);
    vi.spyOn(element, "offsetHeight", "get").mockReturnValue(14);
    stubRect(parent, { left: 100, top: 200, width: 220, height: 120 });
    stubRect(element, {
      left: 130,
      top: 250,
      width: 25.5,
      height: 14.3984,
    });
    Object.defineProperty(parent, "scrollLeft", {
      configurable: true,
      value: 4,
    });
    Object.defineProperty(parent, "scrollTop", {
      configurable: true,
      value: 5,
    });

    const projection = buildCodeLayerProjection(FIXTURE);
    const hints = collectLiveSizeHints(
      [alphaId()],
      projection,
      "active.html",
      undefined,
    );

    expect(hints[alphaId()]).toEqual({
      width: 25.5,
      height: 14.3984,
      left: 32,
      top: 52,
    });
  });

  it("accumulates scrolling static ancestors up to the containing block", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    iframe.setAttribute("data-screen-iframe-id", "active.html");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = `<main><section><div data-agent-native-node-id="alpha"></div></section></main>`;
    const main = doc.querySelector("main")!;
    const section = doc.querySelector("section")!;
    const element = doc.querySelector<HTMLElement>(
      "[data-agent-native-node-id]",
    )!;
    Object.defineProperty(element, "offsetParent", {
      configurable: true,
      value: main,
    });
    vi.spyOn(element, "offsetWidth", "get").mockReturnValue(25);
    vi.spyOn(element, "offsetHeight", "get").mockReturnValue(14);
    stubRect(main, { left: 100, top: 200, width: 220, height: 120 });
    stubRect(element, {
      left: 130,
      top: 250,
      width: 25,
      height: 14,
    });
    Object.defineProperty(section, "scrollLeft", {
      configurable: true,
      value: 7,
    });
    Object.defineProperty(section, "scrollTop", {
      configurable: true,
      value: 9,
    });
    Object.defineProperty(main, "scrollLeft", {
      configurable: true,
      value: 4,
    });
    Object.defineProperty(main, "scrollTop", {
      configurable: true,
      value: 5,
    });

    const projection = buildCodeLayerProjection(FIXTURE);
    const hints = collectLiveSizeHints(
      [alphaId()],
      projection,
      "active.html",
      undefined,
    );

    expect(hints[alphaId()]).toEqual({
      width: 25,
      height: 14,
      left: 41,
      top: 64,
    });
  });

  it("keeps integer freeform dimensions for transformed absolute targets", () => {
    mountScreenIframe("active.html", { width: 60, height: 24 });
    const iframe = document.querySelector<HTMLIFrameElement>(
      '[data-screen-iframe-id="active.html"]',
    )!;
    const element = iframe.contentDocument!.querySelector<HTMLElement>(
      "[data-agent-native-node-id]",
    )!;
    element.dataset.agentNativeNodeId = "absolute";
    element.style.position = "absolute";
    stubRect(element, { left: 100, top: 200, width: 90, height: 36 });

    const projection = buildCodeLayerProjection(ABSOLUTE_FIXTURE);
    const hints = collectLiveSizeHints(
      [absoluteId()],
      projection,
      "active.html",
      undefined,
    );

    expect(hints[absoluteId()]).toEqual({ width: 60, height: 24 });
  });

  it("marks authored-stylesheet absolute targets as out of flow", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    iframe.setAttribute("data-screen-iframe-id", "active.html");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    doc.head.innerHTML = "<style>.authored-absolute{position:absolute}</style>";
    doc.body.innerHTML =
      '<div class="authored-absolute" data-agent-native-node-id="alpha"></div>';
    const element = doc.querySelector<HTMLElement>(
      "[data-agent-native-node-id]",
    )!;
    vi.spyOn(element, "offsetWidth", "get").mockReturnValue(80);
    vi.spyOn(element, "offsetHeight", "get").mockReturnValue(40);
    const projection = buildCodeLayerProjection(
      '<body><div class="authored-absolute" data-agent-native-node-id="alpha"></div></body>',
    );
    const id = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "alpha",
    )!.id;

    expect(
      collectLiveSizeHints([id], projection, "active.html", undefined)[id],
    ).toEqual({ width: 80, height: 40, outOfFlow: true });
  });

  it("preserves rendered stylesheet-positioned content when framing cannot express its geometry", () => {
    const source =
      '<body><style>.authored-absolute{position:absolute;left:20px;top:40px}</style><div class="authored-absolute" data-agent-native-node-id="alpha">Label</div></body>';
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    iframe.setAttribute("data-screen-iframe-id", "active.html");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    doc.head.innerHTML =
      "<style>.authored-absolute{position:absolute;left:20px;top:40px}</style>";
    doc.body.innerHTML =
      '<div class="authored-absolute" data-agent-native-node-id="alpha">Label</div>';
    const element = doc.querySelector<HTMLElement>(
      "[data-agent-native-node-id]",
    )!;
    vi.spyOn(element, "offsetWidth", "get").mockReturnValue(80);
    vi.spyOn(element, "offsetHeight", "get").mockReturnValue(40);
    stubRect(element, { left: 20, top: 40, width: 80, height: 40 });
    const projection = buildCodeLayerProjection(source);
    const id = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "alpha",
    )!.id;
    const sizeHints = collectLiveSizeHints(
      [id],
      projection,
      "active.html",
      undefined,
    );

    const framed = applyVisualEdit(source, {
      kind: "wrapNodes",
      targetIds: [id],
      wrapperKind: "frame",
      sizeHints,
    });

    expect(sizeHints[id]).toEqual({
      width: 80,
      height: 40,
      outOfFlow: true,
    });
    expect(framed.result.status).toBe("unsupported");
    expect(framed.content).toBe(source);
  });

  it("omits client-space positions under a transformed ancestor", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    iframe.setAttribute("data-screen-iframe-id", "active.html");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML =
      '<main style="transform:scale(2)"><div data-agent-native-node-id="alpha"></div></main>';
    const parent = doc.querySelector("main")!;
    const element = doc.querySelector<HTMLElement>(
      "[data-agent-native-node-id]",
    )!;
    vi.spyOn(element, "offsetWidth", "get").mockReturnValue(25);
    vi.spyOn(element, "offsetHeight", "get").mockReturnValue(14);
    stubRect(parent, { left: 100, top: 200, width: 400, height: 200 });
    stubRect(element, { left: 140, top: 260, width: 50, height: 28 });
    const projection = buildCodeLayerProjection(FIXTURE);

    expect(
      collectLiveSizeHints([alphaId()], projection, "active.html", undefined)[
        alphaId()
      ],
    ).toEqual({ width: 25, height: 14 });
  });

  it("keeps parent-relative positions under the managed Board surface translation", () => {
    const layer = document.createElement("div");
    layer.setAttribute("data-board-surface-layer", "");
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    layer.append(iframe);
    document.body.append(layer);
    const doc = iframe.contentDocument!;
    doc.head.innerHTML =
      "<style data-agent-native-content-offset>body > [data-agent-native-node-id]{translate:65536px 65536px}</style>";
    doc.body.innerHTML = `<section data-agent-native-node-id="screen">
  <main><div data-agent-native-node-id="alpha"></div></main>
</section>`;
    const parent = doc.querySelector("main")!;
    const element = doc.querySelector<HTMLElement>(
      '[data-agent-native-node-id="alpha"]',
    )!;
    vi.spyOn(element, "offsetWidth", "get").mockReturnValue(25);
    vi.spyOn(element, "offsetHeight", "get").mockReturnValue(14);
    stubRect(parent, {
      left: 65_636,
      top: 65_736,
      width: 220,
      height: 120,
    });
    stubRect(element, {
      left: 65_666,
      top: 65_786,
      width: 25,
      height: 14,
    });
    const fixture = `<body><section data-agent-native-node-id="screen">
  <main><div data-agent-native-node-id="alpha"></div></main>
</section></body>`;
    const projection = buildCodeLayerProjection(fixture);
    const id = nodeIdFor(fixture, "alpha");

    expect(
      collectLiveSizeHints([id], projection, "board", "board")[id],
    ).toEqual({ width: 25, height: 14, left: 30, top: 50 });
  });

  it("omits client-space positions for an authored target translation", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    iframe.setAttribute("data-screen-iframe-id", "active.html");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML =
      '<main><div style="translate:20px 0" data-agent-native-node-id="alpha"></div></main>';
    const parent = doc.querySelector("main")!;
    const element = doc.querySelector<HTMLElement>(
      '[data-agent-native-node-id="alpha"]',
    )!;
    vi.spyOn(element, "offsetWidth", "get").mockReturnValue(25);
    vi.spyOn(element, "offsetHeight", "get").mockReturnValue(14);
    stubRect(parent, { left: 100, top: 200, width: 220, height: 120 });
    stubRect(element, { left: 150, top: 250, width: 25, height: 14 });
    const fixture = `<body><main><div style="translate:20px 0" data-agent-native-node-id="alpha"></div></main></body>`;
    const projection = buildCodeLayerProjection(fixture);
    const id = nodeIdFor(fixture, "alpha");

    expect(
      collectLiveSizeHints([id], projection, "active.html", undefined)[id],
    ).toEqual({ width: 25, height: 14 });
  });
});
