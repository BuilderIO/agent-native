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

function alphaId(): string {
  return buildCodeLayerProjection(FIXTURE).nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "alpha",
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
});
