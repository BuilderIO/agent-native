import { describe, expect, it } from "vitest";

import { computePopoverPlacement } from "./popover-position";

const viewport = { width: 1280, height: 800 };

describe("computePopoverPlacement", () => {
  it("opens below with room and caps height to the viewport", () => {
    const p = computePopoverPlacement({
      rect: { top: 100, bottom: 130, left: 40 },
      viewport,
      placement: "bottom-start",
      minWidth: 180,
    });
    expect(p.top).toBe(134);
    expect(p.bottom).toBeUndefined();
    expect(p.top! + p.maxHeight).toBeLessThanOrEqual(viewport.height);
  });

  it("flips above when a bottom-edge trigger has no room below", () => {
    const p = computePopoverPlacement({
      rect: { top: 750, bottom: 780, left: 40 },
      viewport,
      placement: "bottom-start",
      minWidth: 180,
    });
    expect(p.top).toBeUndefined();
    expect(p.bottom).toBe(viewport.height - 750 + 4);
    expect(p.maxHeight).toBeLessThanOrEqual(750);
  });

  it("flips below when a top-start trigger sits at the top edge", () => {
    const p = computePopoverPlacement({
      rect: { top: 10, bottom: 40, left: 40 },
      viewport,
      placement: "top-start",
      minWidth: 180,
    });
    expect(p.top).toBe(44);
  });

  it("keeps the panel inside the viewport horizontally", () => {
    const p = computePopoverPlacement({
      rect: { top: 100, bottom: 130, left: 1270 },
      viewport,
      placement: "bottom-start",
      minWidth: 200,
    });
    expect(p.left).toBe(1280 - 200 - 8);
  });
});
