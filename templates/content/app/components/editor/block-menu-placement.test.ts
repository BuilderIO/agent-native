import { describe, expect, it } from "vitest";

import {
  BLOCK_MENU_GAP,
  BLOCK_MENU_PADDING,
  BLOCK_MENU_WIDTH,
  placeBlockMenu,
  type Box,
} from "./block-menu-placement";

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
});

const inset = (box: Box, by: number) =>
  rect(box.left + by, box.top + by, box.width - 2 * by, box.height - 2 * by);

const overlaps = (a: Box, b: Box) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

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

  it("covers the grip, not the text, when only the space beside the text is clear", () => {
    const block = rect(272, 100, 480, 600);
    const placement = placeBlockMenu({
      grip: rect(248, 102, 24, 24),
      block,
      pageLeft: 240,
      viewport: { width: 800, height: 768 },
    });

    expect(placement.side).toBe("left");
    expect(placement.anchor).toEqual({ ...block, width: 0 });
    expect(placement.zone).toEqual({
      left: 0,
      top: 0,
      width: 274,
      height: 768,
    });
  });

  it("scrolls in the roomier space above or below before covering the block", () => {
    const placement = placeBlockMenu({
      grip: rect(4, 202, 24, 24),
      block: rect(28, 200, 340, 380),
      pageLeft: 0,
      viewport: { width: 375, height: 720 },
    });

    expect(placement.side).toBe("top");
    expect(placement.zone).toEqual({
      left: 0,
      top: 0,
      width: 375,
      height: 200,
    });
  });

  it("keeps the menu off the block's text whenever there's room for it elsewhere", () => {
    const misses: string[] = [];
    for (const viewport of [
      { width: 800, height: 600 },
      { width: 800, height: 768 },
      { width: 1024, height: 768 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
    ]) {
      for (const pageLeft of [0, 240]) {
        for (const gutter of [32, 96]) {
          for (const top of [8, 120, 400]) {
            for (const height of [24, 160, 520, 1200]) {
              const width = Math.min(
                700,
                viewport.width - pageLeft - 2 * gutter,
              );
              const left = pageLeft + (viewport.width - pageLeft - width) / 2;
              const block = rect(left, top, width, height);
              const placement = placeBlockMenu({
                grip: rect(left - 24, top + 2, 24, 24),
                block,
                pageLeft,
                viewport,
              });
              const roomAround = Math.max(
                top - BLOCK_MENU_GAP - BLOCK_MENU_PADDING,
                viewport.height -
                  BLOCK_MENU_PADDING -
                  (top + height) -
                  BLOCK_MENU_GAP,
              );
              const roomBeside = left - BLOCK_MENU_GAP - BLOCK_MENU_PADDING;
              const cornered =
                roomAround < 120 && roomBeside < BLOCK_MENU_WIDTH;
              const space = inset(placement.zone, BLOCK_MENU_PADDING);
              if (overlaps(space, block) !== cornered) {
                misses.push(
                  JSON.stringify({ viewport, pageLeft, gutter, top, height }),
                );
              }
            }
          }
        }
      }
    }

    expect(misses).toEqual([]);
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
