import { describe, expect, it } from "vitest";

import {
  dockGroups,
  isDockLayout,
  moveDockTab,
  restoreDockSurface,
  type DockLayout,
} from "./dock-layout.js";

const panels = ["layers", "assets", "canvas", "inspector"];
const layout: DockLayout = {
  type: "split",
  id: "split1",
  axis: "inline",
  side: "start",
  size: 280,
  first: {
    type: "group",
    id: "group1",
    tabs: ["layers", "assets"],
    active: "assets",
  },
  second: {
    type: "group",
    id: "group2",
    tabs: ["canvas", "inspector"],
    active: "canvas",
  },
};
describe("Dock layout", () => {
  it("reorders tabs and moves them between groups without changing unrelated tabs", () => {
    const reorder = moveDockTab(layout, "assets", "layers", "before");
    expect(dockGroups(reorder)[0].tabs).toEqual(["assets", "layers"]);
    const joined = moveDockTab(reorder, "assets", "canvas", "after");
    expect(dockGroups(joined).map((g) => [g.tabs, g.active])).toEqual([
      [["layers"], "layers"],
      [["canvas", "assets", "inspector"], "assets"],
    ]);
    expect(isDockLayout(joined, panels)).toBe(true);
  });
  it("preserves the layout for an active tab dropped into its existing position", () => {
    expect(moveDockTab(layout, "assets", "layers", "after")).toBe(layout);
    expect(moveDockTab(layout, "canvas", "inspector", "before")).toBe(layout);
    expect(moveDockTab(layout, "assets", "layers", "center")).toBe(layout);
  });
  it.each(["start", "end", "above", "below"] as const)(
    "splits a tab %s, then collapses the emptied group when rejoined",
    (position) => {
      const moved = moveDockTab(layout, "inspector", "canvas", position, 180);
      expect(isDockLayout(moved, panels)).toBe(true);
      expect(moved.type === "split" && moved.second).toMatchObject({
        type: "split",
        size: 180,
        axis: ["start", "end"].includes(position) ? "inline" : "block",
      });
      const restored = moveDockTab(moved, "inspector", "canvas", "after");
      expect(dockGroups(restored).map((g) => g.tabs)).toEqual(
        dockGroups(layout).map((g) => g.tabs),
      );
      expect(isDockLayout(restored, panels)).toBe(true);
    },
  );
  it("keeps the canvas visible while tools dock along its edges", () => {
    const fixed: DockLayout = {
      ...layout,
      second: { type: "surface", id: "document", panel: "canvas" },
    };
    expect(moveDockTab(fixed, "layers", "canvas", "center")).toBe(fixed);
    expect(moveDockTab(fixed, "canvas", "layers", "before")).toBe(fixed);
    for (const position of ["before", "after"] as const)
      expect(moveDockTab(fixed, "assets", "canvas", position)).toBe(fixed);
    const split = moveDockTab(fixed, "assets", "canvas", "below");
    expect(isDockLayout(split, ["layers", "assets", "canvas"])).toBe(true);
    expect(split.type === "split" && split.second).toMatchObject({
      type: "split",
      axis: "block",
      first: fixed.second,
    });
  });
  it.each(["canvas", "inspector"])(
    "restores legacy tab groups with %s selected",
    (active) => {
      const legacy: DockLayout = {
        ...layout,
        second: {
          type: "group",
          id: "group2",
          tabs: ["canvas", "assets", "inspector"],
          active,
        },
        first: {
          type: "group",
          id: "group1",
          tabs: ["layers"],
          active: "layers",
        },
      };
      const restored = restoreDockSurface(legacy, "canvas");
      expect(isDockLayout(restored, panels)).toBe(true);
      expect(restored).toMatchObject({
        first: legacy.first,
        second: {
          first: { type: "surface", panel: "canvas" },
          second: {
            tabs: ["assets", "inspector"],
            active: active === "canvas" ? "assets" : active,
          },
        },
      });
      expect(restoreDockSurface(restored, "canvas")).toBe(restored);
    },
  );
  it("preserves a solo tab's node when restoring a permanent surface", () => {
    expect(
      restoreDockSurface(
        { type: "group", id: "document", tabs: ["canvas"], active: "canvas" },
        "canvas",
      ),
    ).toEqual({ type: "surface", id: "document", panel: "canvas" });
  });
  it("rejects a deeply nested stale layout when its panels are unavailable", () => {
    let saved: DockLayout = { type: "surface", id: "canvas", panel: "canvas" };
    for (let i = 0; i < 12000; i++) {
      saved = {
        type: "split",
        id: `split-${i}`,
        axis: "inline",
        side: "end",
        size: 240,
        first: saved,
        second: { type: "surface", id: `leaf-${i}`, panel: `panel-${i}` },
      };
    }
    expect(isDockLayout(saved, ["canvas", "layers"])).toBe(false);
  });

  it("rejects stale saved layouts, duplicate tabs and node ids", () => {
    expect(isDockLayout(layout, panels.slice(1))).toBe(false);
    expect(isDockLayout({ ...layout, second: layout.first }, panels)).toBe(
      false,
    );
    expect(isDockLayout({ ...layout, size: -1 }, panels)).toBe(false);
    expect(
      isDockLayout(
        { ...layout, first: { ...layout.first, active: "canvas" } },
        panels,
      ),
    ).toBe(false);
  });
});
