// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  COMPACT_CROSS_SCREEN_GHOST_PX,
  captureCrossScreenSourceHtmlSnapshot,
  getCrossScreenGhostStyle,
  isPointerInsideSourceIframe,
  validateCrossScreenSourceHtmlSnapshot,
} from "./cross-screen-drop";
import { SURFACE_PADDING } from "./overview-layout";

describe("isPointerInsideSourceIframe", () => {
  it("treats a pointer past the iframe's own reported viewport as OUTSIDE", () => {
    expect(
      isPointerInsideSourceIframe({
        iframeX: 1650,
        iframeY: 100,
        viewportW: 1600,
        viewportH: 900,
        frameWidth: 1280,
        frameHeight: 900,
      }),
    ).toBe(false);
  });

  it("stays inside for a pointer within the real frame", () => {
    expect(
      isPointerInsideSourceIframe({
        iframeX: 1000,
        iframeY: 100,
        viewportW: 1600,
        viewportH: 900,
        frameWidth: 1280,
        frameHeight: 900,
      }),
    ).toBe(true);
  });

  it("falls back to the bridge-reported viewport when no rendered geometry is known yet", () => {
    expect(
      isPointerInsideSourceIframe({
        iframeX: 1480,
        iframeY: 100,
        viewportW: 1600,
        viewportH: 900,
      }),
    ).toBe(true);
  });

  it("does not classify a pointer near the content's real edge as outside a 0.5x-scaled card", () => {
    expect(
      isPointerInsideSourceIframe({
        iframeX: 1200,
        iframeY: 100,
        viewportW: 1280,
        viewportH: 2560,
        frameWidth: 640,
        frameHeight: 1280,
      }),
    ).toBe(true);
  });

  it("rejects stale negative coordinates after the pointer exits", () => {
    expect(
      isPointerInsideSourceIframe({
        iframeX: -1055,
        iframeY: 111,
        viewportW: 1280,
        viewportH: 844,
      }),
    ).toBe(false);
  });

  it("still classifies a pointer past the content's real edge as outside a 0.5x-scaled card", () => {
    expect(
      isPointerInsideSourceIframe({
        iframeX: 1300,
        iframeY: 100,
        viewportW: 1280,
        viewportH: 2560,
        frameWidth: 640,
        frameHeight: 1280,
      }),
    ).toBe(false);
  });
});

describe("cross-screen source HTML snapshots", () => {
  it("captures the complete board root subtree from the host-verified document", () => {
    const sourceDocument = document.implementation.createHTMLDocument();
    sourceDocument.body.innerHTML = `
      <div data-agent-native-node-id="root">
        <div data-agent-native-node-id="child">
          <span data-agent-native-node-id="grandchild">Nested</span>
        </div>
      </div>
    `;

    const snapshot = captureCrossScreenSourceHtmlSnapshot(
      sourceDocument,
      "root",
    );

    expect(snapshot).toContain('data-agent-native-node-id="root"');
    expect(snapshot).toContain('data-agent-native-node-id="child"');
    expect(snapshot).toContain('data-agent-native-node-id="grandchild"');
  });

  it("accepts exactly one matching root and rejects mismatches or siblings", () => {
    const valid =
      '<div data-agent-native-node-id="root"><div data-agent-native-node-id="child"></div></div>';

    expect(validateCrossScreenSourceHtmlSnapshot(valid, "root")).toBe(valid);
    expect(
      validateCrossScreenSourceHtmlSnapshot(valid, "different-root"),
    ).toBeUndefined();
    expect(
      validateCrossScreenSourceHtmlSnapshot(
        `${valid}<div data-agent-native-node-id="sibling"></div>`,
        "root",
      ),
    ).toBeUndefined();
  });
});

describe("getCrossScreenGhostStyle", () => {
  const pan = { x: 0, y: 0 };

  it("keeps the sizeless cursor ghost visible at extreme zoom-out", () => {
    const style = getCrossScreenGhostStyle({
      ghost: { boardX: 100, boardY: 200 },
      pan,
      scale: 0.1,
    });
    expect(style.width).toBe(COMPACT_CROSS_SCREEN_GHOST_PX);
    expect(style.height).toBe(COMPACT_CROSS_SCREEN_GHOST_PX);
  });

  it("centres the sizeless ghost on the board point at every zoom", () => {
    const half = COMPACT_CROSS_SCREEN_GHOST_PX / 2;
    for (const scale of [0.1, 0.36, 1, 2]) {
      const style = getCrossScreenGhostStyle({
        ghost: { boardX: 100, boardY: 200 },
        pan,
        scale,
      });
      const centreX = (style.left as number) + (style.width as number) / 2;
      const centreY = (style.top as number) + (style.height as number) / 2;
      expect(centreX).toBeCloseTo((SURFACE_PADDING + 100) * scale, 6);
      expect(centreY).toBeCloseTo((SURFACE_PADDING + 200) * scale, 6);
      expect(style.left).toBeCloseTo((SURFACE_PADDING + 100) * scale - half, 6);
    }
  });

  it("anchors a sized ghost at its own top-left and scales it", () => {
    const style = getCrossScreenGhostStyle({
      ghost: { boardX: 100, boardY: 200, width: 480, height: 390 },
      pan,
      scale: 0.5,
    });
    expect(style.left).toBeCloseTo((SURFACE_PADDING + 100) * 0.5, 6);
    expect(style.width).toBe(240);
    expect(style.height).toBe(195);
  });

  it("honours pan", () => {
    const style = getCrossScreenGhostStyle({
      ghost: { boardX: 0, boardY: 0, width: 10, height: 10 },
      pan: { x: 33, y: 77 },
      scale: 1,
    });
    expect(style.left).toBe(33 + SURFACE_PADDING);
    expect(style.top).toBe(77 + SURFACE_PADDING);
  });
});
