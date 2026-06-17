// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  getAgentPanelChatTabGroups,
  shouldShowAgentPanelChatTabBar,
  shouldShowAgentPanelCliTabBar,
} from "./AgentPanel.js";

function chatTab(id: string, parentThreadId?: string) {
  return {
    id,
    label: id,
    status: "idle" as const,
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
});
