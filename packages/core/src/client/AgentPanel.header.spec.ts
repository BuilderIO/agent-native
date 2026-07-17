// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AgentChatSurface,
  getAgentPanelChatTabGroups,
  normalizeAgentPanelModeForSurface,
  resolveAgentPanelChatSurface,
  shouldAllowAgentChatSurfaceSettingsMode,
  shouldDefaultAgentChatSurfacePageNewChatButton,
  shouldShowAgentPanelFullViewAction,
  shouldShowAgentPanelPageNewChatButton,
  shouldShowAgentPanelChatTabBar,
  shouldShowAgentPanelSidebarChatTabs,
  shouldShowAgentPanelCliTabBar,
  shouldShowAgentPanelModeButtons,
} from "./AgentPanel.js";

describe("resolveAgentPanelChatSurface", () => {
  it("uses the desktop surface only for explicitly marked local app previews", () => {
    expect(resolveAgentPanelChatSurface(undefined, true)).toBe("desktop");
    expect(resolveAgentPanelChatSurface(undefined, false)).toBe("app");
    expect(resolveAgentPanelChatSurface("dev-frame", true)).toBe("dev-frame");
  });
});

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
  it("hides sidebar chat tabs until a second main tab is open", () => {
    expect(shouldShowAgentPanelSidebarChatTabs([chatTab("main")])).toBe(false);
    expect(
      shouldShowAgentPanelSidebarChatTabs([
        chatTab("main"),
        chatTab("follow-up"),
      ]),
    ).toBe(true);
  });

  it("does not render a sidebar chat tab strip without a main tab", () => {
    expect(
      shouldShowAgentPanelSidebarChatTabs([chatTab("research", "main")]),
    ).toBe(false);
  });

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

  it("hides the page new-chat button for a brand-new empty chat", () => {
    expect(
      shouldShowAgentPanelPageNewChatButton([chatTab("main")], "main", 0),
    ).toBe(false);
  });

  it("shows the page new-chat button when there is an active chat", () => {
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

describe("AgentPanel mode and full-view visibility", () => {
  it("hides mode buttons in the sidebar and shows them on the full page", () => {
    expect(shouldShowAgentPanelModeButtons(true)).toBe(false);
    expect(shouldShowAgentPanelModeButtons(false)).toBe(true);
  });

  it("shows the full-view action for resources and settings when a page href exists", () => {
    expect(shouldShowAgentPanelFullViewAction("/agent", "resources")).toBe(
      true,
    );
    expect(shouldShowAgentPanelFullViewAction("/agent", "settings")).toBe(true);
  });

  it("hides the full-view action for chat, CLI, or a missing page href", () => {
    expect(shouldShowAgentPanelFullViewAction("/agent", "chat")).toBe(false);
    expect(shouldShowAgentPanelFullViewAction("/agent", "cli")).toBe(false);
    expect(shouldShowAgentPanelFullViewAction(undefined, "resources")).toBe(
      false,
    );
    expect(shouldShowAgentPanelFullViewAction(undefined, "settings")).toBe(
      false,
    );
  });
});

describe("AgentChatSurface chrome defaults", () => {
  it("hides the legacy header and chat tab row by default", () => {
    const surface = AgentChatSurface({ mode: "page" });

    expect(surface.props.showHeader).toBe(false);
    expect(surface.props.showTabBar).toBe(false);
  });

  it("allows an embedded host to opt back into the header chrome", () => {
    const surface = AgentChatSurface({
      mode: "panel",
      showHeader: true,
      showTabBar: true,
    });

    expect(surface.props.showHeader).toBe(true);
    expect(surface.props.showTabBar).toBe(true);
  });
});

describe("AgentPanel stale lazy chunk recovery", () => {
  it("uses the guarded reload path before the panel reset fallback", () => {
    const source = readFileSync("src/client/AgentPanel.tsx", {
      encoding: "utf8",
    });
    const componentDidCatch = source.slice(
      source.indexOf("componentDidCatch(error: Error"),
      source.indexOf(
        "componentDidUpdate(",
        source.indexOf("componentDidCatch"),
      ),
    );

    expect(source).toContain(
      'import { recoverFromStaleChunkError } from "./route-chunk-recovery.js";',
    );
    expect(componentDidCatch).toContain(
      "if (recoverFromStaleChunkError(error))",
    );
    expect(
      componentDidCatch.indexOf("recoverFromStaleChunkError(error)"),
    ).toBeLessThan(
      componentDidCatch.indexOf("assistantUiRecoverableRenderErrorKind(error)"),
    );
  });
});
