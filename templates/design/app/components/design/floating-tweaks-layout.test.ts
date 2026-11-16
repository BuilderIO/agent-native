import { describe, expect, it } from "vitest";

import {
  floatingTweaksPositionAfterDrag,
  resolveFloatingTweaksPosition,
  shouldAutoCollapseFloatingTweaks,
} from "./floating-tweaks-layout";

const panel = { width: 288, height: 220 };
const viewport = { width: 1500, height: 900 };

describe("floating tweaks layout", () => {
  it("docks the default at the canvas bottom-left, clear of chrome", () => {
    expect(
      resolveFloatingTweaksPosition({
        canvas: { left: 80, top: 40, right: 1260, bottom: 840 },
        panel,
        viewport,
        position: { x: 16, y: 64 },
        leftObstruction: { left: 80, top: 40, right: 280, bottom: 840 },
        rightObstruction: { left: 1060, top: 40, right: 1260, bottom: 840 },
        bottomObstruction: { left: 560, top: 780, right: 940, bottom: 850 },
      }),
    ).toEqual({ x: 296, y: 552 });
  });

  it("keeps a dragged panel inside the canvas after the viewport shrinks", () => {
    expect(
      resolveFloatingTweaksPosition({
        canvas: { left: 160, top: 80, right: 900, bottom: 620 },
        panel,
        viewport: { width: 1000, height: 700 },
        position: { x: 16, y: 8 },
      }),
    ).toEqual({ x: 612, y: 400 });
  });

  it("preserves a user-moved position", () => {
    expect(
      resolveFloatingTweaksPosition({
        canvas: { left: 80, top: 40, right: 1260, bottom: 840 },
        panel,
        viewport,
        position: { x: 400, y: 250 },
      }),
    ).toEqual({ x: 812, y: 430 });
  });

  it("moves a small drag from the default rendered position by the same delta", () => {
    const rendered = resolveFloatingTweaksPosition({
      canvas: { left: 80, top: 40, right: 1260, bottom: 840 },
      panel,
      viewport,
      position: { x: 16, y: 64 },
    });
    const initialRect = {
      right: rendered.x + panel.width,
      bottom: rendered.y + panel.height,
      ...panel,
    };

    const draggedPosition = floatingTweaksPositionAfterDrag({
      panel: initialRect,
      viewport,
      delta: { x: 5, y: 3 },
    });
    expect(
      resolveFloatingTweaksPosition({
        canvas: { left: 80, top: 40, right: 1260, bottom: 840 },
        panel,
        viewport,
        position: draggedPosition,
      }),
    ).toEqual({ x: rendered.x + 5, y: rendered.y + 3 });
  });
});

describe("floating tweaks auto-collapse", () => {
  it("collapses only when the visible inspector has the same Tweaks section", () => {
    expect(shouldAutoCollapseFloatingTweaks(true, true)).toBe(true);
    expect(shouldAutoCollapseFloatingTweaks(false, true)).toBe(false);
    expect(shouldAutoCollapseFloatingTweaks(true, false)).toBe(false);
  });
});
