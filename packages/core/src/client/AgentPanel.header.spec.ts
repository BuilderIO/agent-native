// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  getAgentPanelChatTabGroups,
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

  it("shows the page new-chat button only after the active chat has work", () => {
    expect(
      shouldShowAgentPanelPageNewChatButton([chatTab("main")], "main", 0),
    ).toBe(false);
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
  });

  it("defaults the page new-chat button off when chat tabs are hidden", () => {
    expect(
      shouldDefaultAgentChatSurfacePageNewChatButton("page", undefined),
    ).toBe(true);
    expect(shouldDefaultAgentChatSurfacePageNewChatButton("page", true)).toBe(
      true,
    );
    expect(shouldDefaultAgentChatSurfacePageNewChatButton("page", false)).toBe(
      false,
    );
    expect(shouldDefaultAgentChatSurfacePageNewChatButton("panel", true)).toBe(
      false,
    );
  });
});
