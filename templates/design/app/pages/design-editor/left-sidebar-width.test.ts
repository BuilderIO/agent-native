import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  resolveLeftSidebarWidth,
  snapLeftSidebarDragWidth,
} from "./left-sidebar-width";

describe("left sidebar width", () => {
  it("defaults to the agent panel floor of 320", () => {
    expect(DEFAULT_LEFT_SIDEBAR_WIDTH).toBe(320);
    // oracle-change: the Code panel was removed, leaving one shared left sidebar width
    expect(resolveLeftSidebarWidth(DEFAULT_LEFT_SIDEBAR_WIDTH)).toBe(320);
  });

  it("holds the file panel between 320 and 416", () => {
    expect(resolveLeftSidebarWidth(100)).toBe(320);
    expect(resolveLeftSidebarWidth(280)).toBe(320);
    expect(resolveLeftSidebarWidth(900)).toBe(416);
    expect(snapLeftSidebarDragWidth(100)).toBe(320);
    expect(snapLeftSidebarDragWidth(900)).toBe(416);
  });

  it("snaps drags to 8px steps", () => {
    expect(snapLeftSidebarDragWidth(339)).toBe(336);
    expect(snapLeftSidebarDragWidth(340)).toBe(344);
    expect(snapLeftSidebarDragWidth(380)).toBe(384);
  });
});
