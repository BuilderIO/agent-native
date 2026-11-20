import type { DesignLeftPanel, EditorMode } from "./types";

export const LEFT_PANEL_TABS = ["agent", "file", "library"] as const;

export type LeftPanelTab = (typeof LEFT_PANEL_TABS)[number];

export const DEFAULT_DESIGN_LEFT_PANEL: DesignLeftPanel = "file";

export function isLeftPanelTab(value: unknown): value is LeftPanelTab {
  return (LEFT_PANEL_TABS as readonly unknown[]).includes(value);
}

export function showsLeftPanelTabs(mode: EditorMode): boolean {
  return mode !== "interact";
}

export function agentPanelAvailable({
  hostEmbeddedEditor,
  isVisualEditSurface,
  canChatWithAgent,
}: {
  hostEmbeddedEditor: boolean;
  isVisualEditSurface: boolean;
  canChatWithAgent: boolean;
}): boolean {
  return hostEmbeddedEditor || isVisualEditSurface || canChatWithAgent;
}

export function visibleLeftPanel(
  mode: EditorMode,
  designPanel: DesignLeftPanel | null,
  agentAvailable = true,
): DesignLeftPanel | null {
  if (showsLeftPanelTabs(mode)) return designPanel;
  return agentAvailable ? "agent" : "file";
}

export function nextDesignLeftPanel(
  mode: EditorMode,
  designPanel: DesignLeftPanel | null,
  requested: DesignLeftPanel | null,
): DesignLeftPanel | null {
  if (!showsLeftPanelTabs(mode) && requested === "agent") return designPanel;
  return requested;
}
