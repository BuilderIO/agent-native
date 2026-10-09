import { describe, expect, it } from "vitest";

import {
  AGENT_SKILLS,
  getActiveFrameGroupVariant,
  getAgentSkill,
  getToolbarGroups,
  isShapeTool,
} from "./floating-toolbar";
import type { DesignTool } from "./types";

describe("getToolbarGroups", () => {
  it("offers Move, Frame, Pen and Agent in Design, and in Annotate", () => {
    expect(getToolbarGroups("edit")).toEqual(["move", "frame", "pen", "agent"]);
    expect(getToolbarGroups("annotate")).toEqual([
      "move",
      "frame",
      "pen",
      "agent",
    ]);
  });

  it("narrows to Move and Agent in Interact", () => {
    expect(getToolbarGroups("interact")).toEqual(["move", "agent"]);
  });

  it("never offers Comment", () => {
    for (const mode of ["edit", "annotate", "interact"] as const) {
      expect(getToolbarGroups(mode)).not.toContain("comment");
    }
  });
});

describe("getActiveFrameGroupVariant", () => {
  it("maps the Frame tool to Frame or Screen by what it draws", () => {
    expect(getActiveFrameGroupVariant("frame", "frame")).toBe("frame");
    expect(getActiveFrameGroupVariant("frame", "screen")).toBe("screen");
  });

  it("maps Text and every shape to themselves", () => {
    expect(getActiveFrameGroupVariant("text", "frame")).toBe("text");
    for (const tool of [
      "rect",
      "line",
      "arrow",
      "ellipse",
      "polygon",
      "star",
    ] as const) {
      expect(getActiveFrameGroupVariant(tool, "frame")).toBe(tool);
    }
  });

  it.each([
    "move",
    "hand",
    "scale",
    "pen",
    "draw",
    "comment",
    "agent",
  ] as DesignTool[])("does not claim %s for the Frame group", (tool) => {
    expect(getActiveFrameGroupVariant(tool, "frame")).toBeNull();
    expect(isShapeTool(tool)).toBe(false);
  });
});

describe("AGENT_SKILLS", () => {
  it("lists Inspiration, Debug and Polish with the agreed prompts", () => {
    expect(AGENT_SKILLS.map((skill) => skill.id)).toEqual([
      "inspiration",
      "debug",
      "polish",
    ]);
    expect(getAgentSkill("inspiration").prompt).toBe(
      "Explore three alternative directions for the selection.",
    );
    expect(getAgentSkill("debug").prompt).toBe(
      "Find layout, overflow, and responsive problems on this screen.",
    );
    expect(getAgentSkill("polish").prompt).toBe(
      "Tighten spacing, type scale, and alignment on the selection.",
    );
  });

  it("names each skill by its own localized label", () => {
    expect(AGENT_SKILLS.map((skill) => skill.labelKey)).toEqual([
      "designEditor.agentSkills.inspiration",
      "designEditor.agentSkills.debug",
      "designEditor.agentSkills.polish",
    ]);
  });
});
