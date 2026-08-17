// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  AgentChatSurface,
  consumeAgentPanelOverlayFocusRestore,
  deferAgentPanelOverlayOpen,
  getAgentPanelShortcutHints,
  getActiveTabScrollDelta,
  getAgentPanelChatTabGroups,
  normalizeAgentPanelModeForSurface,
  resolveAgentPanelFullViewAction,
  resolveAgentPanelChatSurface,
  shouldAllowAgentChatSurfaceSettingsMode,
  shouldDefaultAgentChatSurfacePageNewChatButton,
  shouldKeepAgentPanelHeaderVisible,
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
  it("keeps a sidebar header interactive while a share popover is open", () => {
    expect(shouldKeepAgentPanelHeaderVisible(false, false, true)).toBe(true);
    expect(shouldKeepAgentPanelHeaderVisible(false, false, false)).toBe(false);
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

  it("normalizes every legacy sidebar mode back to chat on chat-only surfaces", () => {
    expect(normalizeAgentPanelModeForSurface("resources", false, true)).toBe(
      "chat",
    );
    expect(normalizeAgentPanelModeForSurface("cli", false, true)).toBe("chat");
    expect(normalizeAgentPanelModeForSurface("settings", true, true)).toBe(
      "chat",
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

  it("keeps the full Agent page reachable from chat-only sidebars", () => {
    expect(shouldShowAgentPanelFullViewAction("/agent", "chat", true)).toBe(
      true,
    );
    expect(shouldShowAgentPanelFullViewAction("/agent", "chat")).toBe(false);
  });

  it("prefers the app-owned chat route when a full-view callback is supplied", () => {
    expect(
      resolveAgentPanelFullViewAction(
        "/settings/agent",
        () => {},
        "chat",
        true,
      ),
    ).toEqual({ kind: "callback" });
    expect(
      resolveAgentPanelFullViewAction(
        "/settings/agent",
        undefined,
        "chat",
        true,
      ),
    ).toEqual({ kind: "link", href: "/settings/agent" });
  });

  it("hides the full-view action when the sidebar is already on that route", () => {
    expect(
      shouldShowAgentPanelFullViewAction("/agent", "chat", true, "/agent"),
    ).toBe(false);
  });

  it("hides the full-view action for CLI or a missing page href", () => {
    expect(shouldShowAgentPanelFullViewAction("/agent", "cli")).toBe(false);
    expect(shouldShowAgentPanelFullViewAction(undefined, "resources")).toBe(
      false,
    );
    expect(shouldShowAgentPanelFullViewAction(undefined, "settings")).toBe(
      false,
    );
  });
});

describe("AgentPanel shortcut hints", () => {
  it("uses compact modifier glyphs on every platform", () => {
    expect(getAgentPanelShortcutHints(true)).toEqual({
      closeTab: "⌃W",
      closeAllTabs: "⌃⌥W",
      toggleSidebar: "⌘\\",
      widenChat: "⌘⇧\\",
    });
    expect(getAgentPanelShortcutHints(false)).toEqual({
      closeTab: "⌥W",
      closeAllTabs: "^⌥W",
      toggleSidebar: "^\\",
      widenChat: "^⇧\\",
    });
  });
});

describe("AgentPanel header overflow actions", () => {
  it("closes the menu before opening a sibling overlay", () => {
    const requestAnimationFrame = window.requestAnimationFrame;
    const frames: Array<() => void> = [];
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(() => callback(0));
      return frames.length;
    }) as typeof window.requestAnimationFrame;

    try {
      const event = { preventDefault: vi.fn() };
      const events: string[] = [];

      deferAgentPanelOverlayOpen(
        event,
        () => events.push("menu closed"),
        () => events.push("overlay opened"),
      );

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(events).toEqual(["menu closed"]);
      expect(frames).toHaveLength(1);

      frames[0]!();
      expect(events).toEqual(["menu closed", "overlay opened"]);
    } finally {
      window.requestAnimationFrame = requestAnimationFrame;
    }
  });

  it("consumes the pending menu focus restore for the sibling overlay", () => {
    const pendingOverlayRef = { current: true };
    const event = { preventDefault: vi.fn() };

    consumeAgentPanelOverlayFocusRestore(pendingOverlayRef, event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(pendingOverlayRef.current).toBe(false);

    const secondEvent = { preventDefault: vi.fn() };
    consumeAgentPanelOverlayFocusRestore(pendingOverlayRef, secondEvent);
    expect(secondEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("keeps width and full-view actions out of the icon row", () => {
    const source = readFileSync("src/client/AgentPanel.tsx", {
      encoding: "utf8",
    });
    const headerActions = source.slice(
      source.indexOf("const renderHeaderActions"),
      source.indexOf(
        "<DropdownMenu open=",
        source.indexOf("const renderHeaderActions"),
      ),
    );
    const overflowMenu = source.slice(
      source.indexOf("<DropdownMenu open="),
      source.indexOf("const renderPageChatOverlay"),
    );

    expect(headerActions).not.toContain("IconArrowsHorizontal");
    expect(headerActions).not.toContain("IconArrowsMaximize");
    expect(overflowMenu).toContain("onSelect={wideDrawerAction}");
    expect(overflowMenu).toContain(
      "<DropdownMenuShortcut>{widenChatHint}</DropdownMenuShortcut>",
    );
    expect(overflowMenu.match(/deferAgentPanelOverlayOpen/g)).toHaveLength(3);
    expect(overflowMenu).toContain("onCloseAutoFocus");
    expect(
      overflowMenu.match(/closeHeaderMenuForOverlay/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(overflowMenu).toContain('t("agentPanel.openFullView")');
    expect(overflowMenu).toContain("onSelect={onFullViewRequest}");
    expect(source).toContain("onFullViewRequest={onFullscreenRequest}");
    expect(overflowMenu).not.toContain("fullscreenHint");
    expect(overflowMenu).not.toContain("onSelect={onToggleFullscreen}");
  });

  it("offers sharing from the sidebar overflow for an active chat", () => {
    const source = readFileSync("src/client/AgentPanel.tsx", {
      encoding: "utf8",
    });
    const overflowMenu = source.slice(
      source.indexOf("<DropdownMenu open="),
      source.indexOf("const renderPageChatOverlay"),
    );

    expect(overflowMenu).toContain("<IconShare3");
    expect(overflowMenu).toContain("setShareFromMenuOpen(true)");
    expect(overflowMenu).not.toContain('trigger="label-icon"');
    expect(overflowMenu).toContain("activeTabMessageCount <= 0");
    expect(source).toContain("defaultOpen={onCollapse && shareFromMenuOpen}");
    expect(source).toContain("onCollapse ? setShareFromMenuOpen : undefined");
  });

  it("keeps per-app chat headers stable while switching app surfaces", () => {
    const source = readFileSync("src/client/AgentPanel.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain(
      ".agent-sidebar-panel[data-agent-sidebar-per-app-chat='true'] .agent-sidebar-chat-header[data-agent-sidebar-chat-header]{opacity:1;pointer-events:auto;transition:none;}",
    );
  });
});

describe("AgentSidebar wide drawer layout", () => {
  it("does not reserve the drawer placeholder after the panel closes", () => {
    const source = readFileSync("src/client/AgentPanel.tsx", {
      encoding: "utf8",
    });
    const placeholderStart = source.indexOf("const drawerPlaceholder");
    const placeholderEnd = source.indexOf("return (", placeholderStart);
    const placeholder = source.slice(placeholderStart, placeholderEnd);

    expect(placeholder).toContain(
      "wideDrawerEnabled && !presentationMode && panelOpen ? (",
    );
    expect(placeholder).not.toContain("shouldRenderPanel");
  });
});

describe("AgentChatSurface chrome defaults", () => {
  it("hides the legacy header and chat tab row by default", () => {
    const surface = AgentChatSurface({ mode: "page" });
    const panel = surface.props.children[1];

    expect(panel.props.showHeader).toBe(false);
    expect(panel.props.showTabBar).toBe(false);
  });

  it("mounts URL command sync for a full-page chat surface", () => {
    const surface = AgentChatSurface({
      mode: "page",
      browserTabId: "tab-one",
    });

    expect(surface.props.children[0].type.name).toBe("URLSync");
    expect(surface.props.children[0].props.browserTabId).toBe("tab-one");
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
