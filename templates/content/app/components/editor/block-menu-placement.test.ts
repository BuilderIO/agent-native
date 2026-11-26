import { describe, expect, it } from "vitest";

import { placeBlockMenu } from "./block-menu-placement";

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
});

const grip = rect(496, 220, 24, 24);
const paragraph = rect(520, 218, 640, 27);
const wide = { width: 1440, height: 900 };

const narrowGrip = (top: number) => rect(288, top, 24, 24);
const narrow = { width: 1024, height: 768 };

describe("placeBlockMenu", () => {
  it("opens in the margin beside the grip, level with the block's top", () => {
    const placement = placeBlockMenu({
      grip,
      block: paragraph,
      pageLeft: 240,
      viewport: wide,
    });

    expect(placement.side).toBe("left");
    expect(placement.anchor).toEqual({
      left: 496,
      top: 218,
      width: 24,
      height: 27,
    });
    expect(placement.zone).toEqual({
      left: 0,
      top: 0,
      width: 498,
      height: 900,
    });
  });

  it("opens under the block, on its text's edge, when the margin is narrow", () => {
    const block = rect(312, 370, 640, 31);
    const placement = placeBlockMenu({
      grip: narrowGrip(372),
      block,
      pageLeft: 240,
      viewport: narrow,
      menuHeight: 300,
    });

    expect(placement.side).toBe("bottom");
    expect(placement.anchor).toEqual({
      left: 312,
      top: 370,
      width: 640,
      height: 31,
    });
    expect(placement.zone).toEqual({
      left: 0,
      top: 401,
      width: 1024,
      height: 367,
    });
  });

  it("stays under the block while the room there shows most of the menu", () => {
    const placement = placeBlockMenu({
      grip: narrowGrip(369),
      block: rect(312, 367, 640, 82),
      pageLeft: 240,
      viewport: narrow,
      menuHeight: 382,
    });

    expect(placement.side).toBe("bottom");
  });

  it("opens over the block near the window's bottom", () => {
    const placement = placeBlockMenu({
      grip: narrowGrip(602),
      block: rect(312, 600, 640, 30),
      pageLeft: 240,
      viewport: narrow,
      menuHeight: 382,
    });

    expect(placement.side).toBe("top");
    expect(placement.zone).toEqual({
      left: 0,
      top: 0,
      width: 1024,
      height: 600,
    });
  });

  it("takes the sidebar's side of the grip when the block fills the window", () => {
    const placement = placeBlockMenu({
      grip: narrowGrip(90),
      block: rect(312, 88, 640, 640),
      pageLeft: 240,
      viewport: narrow,
    });

    expect(placement.side).toBe("left");
    expect(placement.zone.width).toBe(290);
  });

  it("falls back to under the grip when nothing beside or around the block is clear", () => {
    const placement = placeBlockMenu({
      grip: rect(4, 90, 24, 24),
      block: rect(28, 88, 340, 620),
      pageLeft: 0,
      viewport: { width: 375, height: 720 },
    });

    expect(placement.side).toBe("bottom");
    expect(placement.anchor).toEqual({
      left: 4,
      top: 90,
      width: 24,
      height: 24,
    });
  });
});
