// @vitest-environment happy-dom

import { buildCodeLayerProjection } from "@shared/code-layer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { collectLiveSizeHints } from "./frame-selection";

/**
 * A duplicated Screen can carry a not-yet-remapped (or colliding)
 * data-agent-native-node-id while it settles — collectLiveSizeHints must
 * only ever read the ACTIVE file's own iframe, never fall through to the
 * first preview iframe on the canvas that happens to contain a matching id.
 */
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
    // "other.html" stands in for a just-duplicated screen whose ids haven't
    // been remapped yet — same data-agent-native-node-id, different (wrong)
    // rendered size. If it were queried before "active.html" (DOM order),
    // taking the "first match" would silently read the wrong screen.
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
});
