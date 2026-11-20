import type { DesignLeftPanel, EditorMode } from "./types";

/** The panels the Agent | File | Library control switches between, in order. */
export const LEFT_PANEL_TABS = ["agent", "file", "library"] as const;

export type LeftPanelTab = (typeof LEFT_PANEL_TABS)[number];

export const DEFAULT_DESIGN_LEFT_PANEL: DesignLeftPanel = "file";

export function isLeftPanelTab(value: unknown): value is LeftPanelTab {
  return (LEFT_PANEL_TABS as readonly unknown[]).includes(value);
}

/** Interact has no tab row; its left column is the agent chat. */
export function showsLeftPanelTabs(mode: EditorMode): boolean {
  return mode !== "interact";
}

/**
 * The panel the left column shows. Design (edit and comment) shows the tab it
 * remembers; Interact always shows the chat and leaves Design's tab alone.
 */
export function visibleLeftPanel(
  mode: EditorMode,
  designPanel: DesignLeftPanel | null,
): DesignLeftPanel | null {
  return showsLeftPanelTabs(mode) ? designPanel : "agent";
}

/**
 * Design's remembered tab after a request to show `requested`. While Interact
 * is up, a request for the chat is already satisfied, so Design keeps its tab;
 * any other panel becomes what Design shows when the user returns to it.
 */
export function nextDesignLeftPanel(
  mode: EditorMode,
  designPanel: DesignLeftPanel | null,
  requested: DesignLeftPanel | null,
): DesignLeftPanel | null {
  if (!showsLeftPanelTabs(mode) && requested === "agent") return designPanel;
  return requested;
}
