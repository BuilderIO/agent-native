import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  resolveLeftSidebarWidth,
  snapLeftSidebarDragWidth,
} from "./left-sidebar-width";

describe("left sidebar width", () => {
  it("defaults to 240", () => {
    expect(DEFAULT_LEFT_SIDEBAR_WIDTH).toBe(240);
    expect(resolveLeftSidebarWidth(DEFAULT_LEFT_SIDEBAR_WIDTH, "file")).toBe(
      240,
    );
  });

  it("holds the file panel between 232 and 416", () => {
    expect(resolveLeftSidebarWidth(100, "file")).toBe(232);
    expect(resolveLeftSidebarWidth(900, "file")).toBe(416);
    expect(snapLeftSidebarDragWidth(100, "file")).toBe(232);
    expect(snapLeftSidebarDragWidth(900, "file")).toBe(416);
  });

  it("snaps drags to 8px steps", () => {
    expect(snapLeftSidebarDragWidth(243, "file")).toBe(240);
    expect(snapLeftSidebarDragWidth(244, "file")).toBe(248);
    expect(snapLeftSidebarDragWidth(300, "file")).toBe(304);
  });

  it("keeps the agent panel at least 320 wide", () => {
    expect(resolveLeftSidebarWidth(240, "agent")).toBe(320);
    expect(snapLeftSidebarDragWidth(260, "agent")).toBe(320);
    expect(snapLeftSidebarDragWidth(900, "agent")).toBe(416);
  });

  it("keeps the code panel renders and drag limits", () => {
    expect(resolveLeftSidebarWidth(240, "code")).toBe(640);
    expect(snapLeftSidebarDragWidth(100, "code")).toBe(520);
    expect(snapLeftSidebarDragWidth(2000, "code")).toBe(1100);
  });
});
