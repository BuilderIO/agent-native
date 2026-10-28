import { describe, expect, it } from "vitest";

import {
  getActiveFrameGroupTool,
  getActivePenGroupTool,
  getActiveShapeGroupTool,
  getToolbarGroups,
  isShapeTool,
  resolveGroupTool,
} from "./floating-toolbar";
import type { DesignTool } from "./types";

describe("getToolbarGroups", () => {
  it("offers Move, Frame, Shapes, Text, Pen and Comment in Design, and in Annotate", () => {
    const all = ["move", "frame", "shapes", "text", "pen", "comment"];
    expect(getToolbarGroups("edit", { canComment: true })).toEqual(all);
    expect(getToolbarGroups("annotate", { canComment: true })).toEqual(all);
  });

  it("leaves Comment out where the user cannot comment", () => {
    expect(getToolbarGroups("edit", { canComment: false })).toEqual([
      "move",
      "frame",
      "shapes",
      "text",
      "pen",
    ]);
  });

  it("offers no tool in Interact, whatever the user can do", () => {
    expect(getToolbarGroups("interact", { canComment: true })).toEqual([]);
    expect(getToolbarGroups("interact", { canComment: false })).toEqual([]);
  });
});

describe("getActiveFrameGroupTool", () => {
  it("maps the Frame tool to Frame or Screen by what it draws", () => {
    expect(getActiveFrameGroupTool("frame", "frame")).toBe("frame");
    expect(getActiveFrameGroupTool("frame", "screen")).toBe("screen");
  });

  it.each([
    "move",
    "hand",
    "scale",
    "text",
    "rect",
    "star",
    "pen",
    "draw",
    "comment",
  ] as DesignTool[])("does not claim %s for the Frame group", (tool) => {
    expect(getActiveFrameGroupTool(tool, "frame")).toBeNull();
  });
});

describe("getActiveShapeGroupTool", () => {
  it("maps every shape to itself", () => {
    for (const tool of [
      "rect",
      "line",
      "arrow",
      "ellipse",
      "polygon",
      "star",
    ] as const) {
      expect(getActiveShapeGroupTool(tool)).toBe(tool);
      expect(isShapeTool(tool)).toBe(true);
    }
  });

  it.each([
    "move",
    "frame",
    "text",
    "hand",
    "scale",
    "pen",
    "draw",
    "comment",
  ] as DesignTool[])("does not claim %s for the Shapes group", (tool) => {
    expect(getActiveShapeGroupTool(tool)).toBeNull();
    expect(isShapeTool(tool)).toBe(false);
  });
});

describe("getActivePenGroupTool", () => {
  const drawing = {
    mode: "annotate",
    drawMode: true,
    annotateAvailable: true,
  } as const;

  it("maps Pen to Pen, whatever mode it is armed in", () => {
    expect(
      getActivePenGroupTool({ ...drawing, activeTool: "pen", mode: "edit" }),
    ).toBe("pen");
  });

  it("maps Draw to Draw only while the overlay is on, in Annotate, with the lab on", () => {
    expect(getActivePenGroupTool({ ...drawing, activeTool: "draw" })).toBe(
      "draw",
    );
    expect(
      getActivePenGroupTool({
        ...drawing,
        activeTool: "draw",
        drawMode: false,
      }),
    ).toBeNull();
    expect(
      getActivePenGroupTool({ ...drawing, activeTool: "draw", mode: "edit" }),
    ).toBeNull();
    expect(
      getActivePenGroupTool({
        ...drawing,
        activeTool: "draw",
        annotateAvailable: false,
      }),
    ).toBeNull();
  });

  it.each(["move", "frame", "text", "rect", "comment"] as DesignTool[])(
    "does not claim %s for the Pen group",
    (tool) => {
      expect(
        getActivePenGroupTool({ ...drawing, activeTool: tool }),
      ).toBeNull();
    },
  );
});

describe("resolveGroupTool", () => {
  const shapes = ["rect", "line", "star"] as const;

  it("arms the tool in use, whatever was used last", () => {
    expect(
      resolveGroupTool({ active: "star", lastUsed: "rect", available: shapes }),
    ).toEqual({ tool: "star", armed: true });
  });

  it("keeps showing the last tool, unarmed, once drawing is over", () => {
    expect(
      resolveGroupTool({ active: null, lastUsed: "line", available: shapes }),
    ).toEqual({ tool: "line", armed: false });
  });

  it("falls back to the group's first tool when the last one is no longer on offer", () => {
    expect(
      resolveGroupTool({
        active: null,
        lastUsed: "draw",
        available: ["pen"] as const,
      }),
    ).toEqual({ tool: "pen", armed: false });
  });
});
