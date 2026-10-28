import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  resolveLeftSidebarWidth,
  snapLeftSidebarDragWidth,
} from "./left-sidebar-width";

describe("left sidebar width", () => {
  it("defaults to the agent panel floor of 320", () => {
    expect(DEFAULT_LEFT_SIDEBAR_WIDTH).toBe(320);
    expect(resolveLeftSidebarWidth(DEFAULT_LEFT_SIDEBAR_WIDTH, "file")).toBe(
      320,
    );
  });

  it("holds the file panel between 320 and 416", () => {
    expect(resolveLeftSidebarWidth(100, "file")).toBe(320);
    expect(resolveLeftSidebarWidth(280, "file")).toBe(320);
    expect(resolveLeftSidebarWidth(900, "file")).toBe(416);
    expect(snapLeftSidebarDragWidth(100, "file")).toBe(320);
    expect(snapLeftSidebarDragWidth(900, "file")).toBe(416);
  });

  it("snaps drags to 8px steps", () => {
    expect(snapLeftSidebarDragWidth(339, "file")).toBe(336);
    expect(snapLeftSidebarDragWidth(340, "file")).toBe(344);
    expect(snapLeftSidebarDragWidth(380, "file")).toBe(384);
  });

  it("renders Layers, Agent, Tokens and Threads at the same width", () => {
    for (const stored of [100, 280, DEFAULT_LEFT_SIDEBAR_WIDTH, 360, 900]) {
      const layers = resolveLeftSidebarWidth(stored, "file");
      for (const panel of ["agent", "tokens", "threads"] as const) {
        expect(resolveLeftSidebarWidth(stored, panel)).toBe(layers);
      }
    }
  });

  it("holds every non-code panel to the Layers drag limits", () => {
    for (const panel of ["agent", "tokens", "threads"] as const) {
      expect(snapLeftSidebarDragWidth(100, panel)).toBe(320);
      expect(snapLeftSidebarDragWidth(260, panel)).toBe(320);
      expect(snapLeftSidebarDragWidth(356, panel)).toBe(360);
      expect(snapLeftSidebarDragWidth(900, panel)).toBe(416);
    }
  });

  it("keeps the code panel renders and drag limits", () => {
    expect(resolveLeftSidebarWidth(240, "code")).toBe(640);
    expect(snapLeftSidebarDragWidth(100, "code")).toBe(520);
    expect(snapLeftSidebarDragWidth(2000, "code")).toBe(1100);
  });
});
