// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  getAgentPanelChatTabGroups,
  normalizeAgentPanelModeForSurface,
  shouldAllowAgentChatSurfaceSettingsMode,
  shouldDefaultAgentChatSurfacePageNewChatButton,
  shouldShowAgentPanelPageNewChatButton,
  shouldShowAgentPanelChatTabBar,
  shouldShowAgentPanelCliTabBar,
} from "./AgentPanel.js";

function chatTab(
  id: string,
  parentThreadId?: string,
  status: "idle" | "running" | "completed" = "idle",
) {
  return {
    id,
    label: id,
    status,
    ...(parentThreadId ? { parentThreadId } : {}),
  };
}

describe("AgentPanel header tab visibility", () => {
  it("hides the chat tab strip for a single main tab", () => {
    expect(shouldShowAgentPanelChatTabBar([chatTab("main")], "main")).toBe(
      false,
    );
  });

  it("shows the chat tab strip when multiple main tabs are open", () => {
    expect(
      shouldShowAgentPanelChatTabBar(
        [chatTab("main"), chatTab("follow-up")],
        "main",
      ),
    ).toBe(true);
  });

  it("shows the chat tab strip when the active context has child tabs", () => {
    const tabs = [chatTab("main"), chatTab("research", "main")];

    expect(shouldShowAgentPanelChatTabBar(tabs, "research")).toBe(true);
    expect(getAgentPanelChatTabGroups(tabs, "research")).toMatchObject({
      focusParentId: "main",
      hasSubTabs: true,
      mainTabs: [chatTab("main")],
      childTabs: [chatTab("research", "main")],
    });
  });

  it("shows CLI tabs only after a second terminal exists", () => {
    expect(shouldShowAgentPanelCliTabBar(["cli-1"])).toBe(false);
    expect(shouldShowAgentPanelCliTabBar(["cli-1", "cli-2"])).toBe(true);
  });

  it("shows the page new-chat button when there is an active chat", () => {
    expect(
      shouldShowAgentPanelPageNewChatButton([chatTab("main")], "main", 0),
    ).toBe(true);
    expect(
      shouldShowAgentPanelPageNewChatButton([chatTab("main")], "main", 1),
    ).toBe(true);
    expect(
      shouldShowAgentPanelPageNewChatButton(
        [chatTab("main", undefined, "running")],
        "main",
        0,
      ),
    ).toBe(true);
    expect(
      shouldShowAgentPanelPageNewChatButton([chatTab("main")], "", 1),
    ).toBe(false);
  });

  it("defaults the page new-chat button on for page chats", () => {
    expect(
      shouldDefaultAgentChatSurfacePageNewChatButton("page", undefined),
    ).toBe(true);
    expect(shouldDefaultAgentChatSurfacePageNewChatButton("page", true)).toBe(
      true,
    );
    expect(shouldDefaultAgentChatSurfacePageNewChatButton("page", false)).toBe(
      true,
    );
    expect(shouldDefaultAgentChatSurfacePageNewChatButton("panel", true)).toBe(
      false,
    );
  });

  it("does not allow sidebar settings mode in page chat by default", () => {
    expect(shouldAllowAgentChatSurfaceSettingsMode("page", undefined)).toBe(
      false,
    );
    expect(shouldAllowAgentChatSurfaceSettingsMode("panel", undefined)).toBe(
      true,
    );
    expect(shouldAllowAgentChatSurfaceSettingsMode("page", true)).toBe(true);
  });

  it("normalizes settings back to chat when settings mode is not allowed", () => {
    expect(normalizeAgentPanelModeForSurface("settings", false)).toBe("chat");
    expect(normalizeAgentPanelModeForSurface("settings", true)).toBe(
      "settings",
    );
    expect(normalizeAgentPanelModeForSurface("resources", false)).toBe(
      "resources",
    );
  });
});
