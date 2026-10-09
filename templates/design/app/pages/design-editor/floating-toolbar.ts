import type { DesignTool, EditorMode, ShapeTool } from "./types";

export type ToolbarGroupId = "move" | "frame" | "pen" | "agent";

/**
 * Interact centers its preview, so keeping it clear of the floating toolbar at
 * the bottom means reserving the toolbar's 48px height on both sides.
 */
export const FLOATING_TOOLBAR_CLEARANCE_PX = 48;

/** Interact browses the running app, so it keeps only Move and the Agent. */
export function getToolbarGroups(mode: EditorMode): ToolbarGroupId[] {
  return mode === "interact"
    ? ["move", "agent"]
    : ["move", "frame", "pen", "agent"];
}

/**
 * What the Frame group's main button can arm: the group's own tools plus Screen,
 * which is the Frame tool drawing a Screen.
 */
export type FrameGroupVariant = "frame" | "screen" | "text" | ShapeTool;

const SHAPE_TOOLS: ReadonlySet<DesignTool> = new Set<DesignTool>([
  "rect",
  "line",
  "arrow",
  "ellipse",
  "polygon",
  "star",
]);

export function isShapeTool(tool: DesignTool): tool is ShapeTool {
  return SHAPE_TOOLS.has(tool);
}

/**
 * The Frame-group variant the active tool corresponds to, or null when the
 * active tool belongs to another group.
 */
export function getActiveFrameGroupVariant(
  activeTool: DesignTool,
  frameToolDraws: "screen" | "frame",
): FrameGroupVariant | null {
  if (activeTool === "frame") return frameToolDraws;
  if (activeTool === "text") return "text";
  return isShapeTool(activeTool) ? activeTool : null;
}

export type AgentSkillId = "inspiration" | "debug" | "polish";

export interface AgentSkill {
  id: AgentSkillId;
  labelKey: `designEditor.agentSkills.${AgentSkillId}`;
  /** Sent to the agent chat as the user's message. Not localized, like the other agent dispatch prompts. */
  prompt: string;
}

export const AGENT_SKILLS: readonly AgentSkill[] = [
  {
    id: "inspiration",
    labelKey: "designEditor.agentSkills.inspiration",
    prompt:
      "Explore three alternative directions for the selection." /* i18n-ignore agent dispatch prompt */,
  },
  {
    id: "debug",
    labelKey: "designEditor.agentSkills.debug",
    prompt:
      "Find layout, overflow, and responsive problems on this screen." /* i18n-ignore agent dispatch prompt */,
  },
  {
    id: "polish",
    labelKey: "designEditor.agentSkills.polish",
    prompt:
      "Tighten spacing, type scale, and alignment on the selection." /* i18n-ignore agent dispatch prompt */,
  },
];

export function getAgentSkill(id: AgentSkillId): AgentSkill {
  const skill = AGENT_SKILLS.find((candidate) => candidate.id === id);
  if (!skill) throw new Error(`Unknown agent skill: ${id}`);
  return skill;
}
