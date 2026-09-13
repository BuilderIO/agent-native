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

function mountScreenIframe(
  screenIframeId: string,
  rect: { width: number; height: number },
): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-design-preview-iframe", "");
  iframe.setAttribute("data-screen-iframe-id", screenIframeId);
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<div data-agent-native-node-id="alpha"></div>';
  vi.spyOn(
    doc.querySelector("[data-agent-native-node-id]")!,
    "getBoundingClientRect",
  ).mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: rect.width,
    bottom: rect.height,
    width: rect.width,
    height: rect.height,
    toJSON: () => ({}),
  });
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
    const hints = collectLiveSizeHints([alphaId()], projection, "active.html");

    expect(hints.alpha).toEqual({ width: 120, height: 40 });
  });

  it("returns no hint when the active file's iframe cannot be found", () => {
    mountScreenIframe("other.html", { width: 999, height: 999 });

    const projection = buildCodeLayerProjection(FIXTURE);
    const hints = collectLiveSizeHints([alphaId()], projection, "active.html");

    expect(hints).toEqual({});
  });
});
