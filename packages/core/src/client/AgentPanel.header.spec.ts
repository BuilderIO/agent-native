// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

import {
  AgentChatSurface,
  AgentPanelSettingsNavigation,
  consumeAgentPanelOverlayFocusRestore,
  deferAgentPanelOverlayOpen,
  getAgentPanelShortcutHints,
  getActiveTabScrollDelta,
  getAgentPanelChatTabGroups,
  focusAgentChat,
  normalizeAgentPanelModeForSurface,
  resolveAgentPanelFullViewAction,
  resolveAgentPanelChatSurface,
  shouldDefaultAgentChatSurfacePageNewChatButton,
  shouldHandleAgentSidebarToggle,
  shouldHandleAgentPanelChatShortcut,
  shouldShowAgentPanelFullViewAction,
  shouldShowAgentPanelPageNewChatButton,
  shouldShowAgentPanelChatTabBar,
  shouldShowAgentPanelSidebarChatTabs,
  shouldShowAgentPanelCliTabBar,
  shouldShowAgentPanelModeButtons,
  settingsRouteHashForSection,
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
  it("keeps the active tab clear of the overflow edges", () => {
    expect(
      getActiveTabScrollDelta(
        { left: 100, right: 300 },
        { left: 280, right: 340 },
      ),
    ).toBe(64);
    expect(
      getActiveTabScrollDelta(
        { left: 100, right: 300 },
        { left: 70, right: 140 },
      ),
    ).toBe(-54);
    expect(
      getActiveTabScrollDelta(
        { left: 100, right: 300 },
        { left: 140, right: 260 },
      ),
    ).toBe(0);
  });

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

  it("normalizes legacy and unknown modes back to chat", () => {
    expect(normalizeAgentPanelModeForSurface("settings")).toBe("chat");
    expect(normalizeAgentPanelModeForSurface("unknown")).toBe("chat");
    expect(normalizeAgentPanelModeForSurface("resources")).toBe("resources");
    expect(normalizeAgentPanelModeForSurface("resources", true)).toBe("chat");
    expect(normalizeAgentPanelModeForSurface("cli", true)).toBe("chat");
  });

  it("preserves secret-specific hashes for canonical settings navigation", () => {
    expect(settingsRouteHashForSection("secrets:FIGMA_ACCESS_TOKEN")).toBe(
      "#secrets:FIGMA_ACCESS_TOKEN",
    );
    expect(
      settingsRouteHashForSection("secrets", "#secrets:OPENAI_API_KEY"),
    ).toBe("#secrets:OPENAI_API_KEY");
    expect(settingsRouteHashForSection("automations")).toBe(
      "#agent:automations",
    );
    expect(settingsRouteHashForSection("voice")).toBe("#voice");
    for (const section of [
      "llm",
      "uploads",
      "hosting",
      "database",
      "auth",
      "demo-mode",
      "limits",
      "app-models",
      "background",
      "email",
      "browser",
      "usage",
    ]) {
      expect(settingsRouteHashForSection(section)).toBe(`#${section}`);
    }
    expect(settingsRouteHashForSection("a2a")).toBe("#agent:agents");
  });
});

describe("AgentPanel settings navigation", () => {
  it("routes settings requests to a host-owned settings surface", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const onOpenSettings = vi.fn();

    try {
      act(() => {
        root.render(
          React.createElement(
            MemoryRouter,
            { initialEntries: ["/"] },
            React.createElement(AgentPanelSettingsNavigation, {
              onOpenSettings,
            }),
          ),
        );
      });

      act(() => {
        window.dispatchEvent(
          new CustomEvent("agent-panel:open-settings", {
            detail: { section: "voice" },
          }),
        );
      });

      expect(onOpenSettings).toHaveBeenCalledWith("voice");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("routes a mounted settings request to an existing secret-specific hash", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    let pathname = "";
    let hash = "";

    function LocationProbe() {
      const location = useLocation();
      pathname = location.pathname;
      hash = location.hash;
      return null;
    }

    try {
      act(() => {
        window.history.replaceState(null, "", "/#secrets:OPENAI_API_KEY");
        root.render(
          React.createElement(
            MemoryRouter,
            { initialEntries: ["/"] },
            React.createElement(AgentPanelSettingsNavigation),
            React.createElement(LocationProbe),
          ),
        );
      });

      act(() => {
        window.dispatchEvent(
          new CustomEvent("agent-panel:open-settings", {
            detail: { section: "secrets" },
          }),
        );
      });

      expect(pathname).toBe("/settings");
      expect(hash).toBe("#secrets:OPENAI_API_KEY");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("preserves the app base path when opening settings", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    let pathname = "";

    function LocationProbe() {
      pathname = useLocation().pathname;
      return null;
    }

    try {
      act(() => {
        window.history.replaceState(null, "", "/dispatch/_agent-native/poll");
        root.render(
          React.createElement(
            MemoryRouter,
            { initialEntries: ["/"] },
            React.createElement(AgentPanelSettingsNavigation),
            React.createElement(LocationProbe),
          ),
        );
      });

      act(() => {
        window.dispatchEvent(
          new CustomEvent("agent-panel:open-settings", {
            detail: { section: "voice" },
          }),
        );
      });

      expect(pathname).toBe("/dispatch/settings");
    } finally {
      act(() => root.unmount());
      container.remove();
      window.history.replaceState(null, "", "/");
    }
  });

  it("notifies mounted settings sections after browser navigation", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const popstate = vi.fn();
    const hashchange = vi.fn();
    window.addEventListener("popstate", popstate);
    window.addEventListener("hashchange", hashchange);

    try {
      act(() => {
        root.render(
          React.createElement(
            MemoryRouter,
            { initialEntries: ["/"] },
            React.createElement(AgentPanelSettingsNavigation),
          ),
        );
      });

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("agent-panel:open-settings", {
            detail: { section: "uploads" },
          }),
        );
      });

      expect(popstate).toHaveBeenCalledTimes(1);
      expect(hashchange).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("popstate", popstate);
      window.removeEventListener("hashchange", hashchange);
      act(() => root.unmount());
      container.remove();
    }
  });
});

describe("AgentPanel mode and full-view visibility", () => {
  it("hides mode buttons in the sidebar and shows them on the full page", () => {
    expect(shouldShowAgentPanelModeButtons(true)).toBe(false);
    expect(shouldShowAgentPanelModeButtons(false)).toBe(true);
  });

  it("shows the full-view action for resources when a page href exists", () => {
    expect(shouldShowAgentPanelFullViewAction("/agent", "resources")).toBe(
      true,
    );
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

  it("does not capture chat focus inside editable controls", () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    const nested = document.createElement("span");
    editor.appendChild(nested);

    expect(shouldHandleAgentPanelChatShortcut(input)).toBe(false);
    expect(shouldHandleAgentPanelChatShortcut(editor)).toBe(false);
    expect(shouldHandleAgentPanelChatShortcut(nested)).toBe(false);
    expect(shouldHandleAgentPanelChatShortcut(document.body)).toBe(true);
  });
});

describe("AgentSidebar composer focus", () => {
  it("opens the sidebar and focuses its composer", () => {
    const previousRequestAnimationFrame = window.requestAnimationFrame;
    const frames: Array<FrameRequestCallback> = [];
    const events: string[] = [];
    const panel = document.createElement("div");
    const composer = document.createElement("div");
    panel.className = "agent-sidebar-panel";
    panel.dataset.agentSidebarState = "open";
    composer.className = "ProseMirror";
    panel.appendChild(composer);
    document.body.appendChild(panel);

    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }) as typeof window.requestAnimationFrame;
    const recordEvent = (event: Event) => events.push(event.type);
    window.addEventListener("agent-panel:set-mode", recordEvent);
    window.addEventListener("agent-panel:open", recordEvent);

    try {
      focusAgentChat();

      expect(events).toEqual(["agent-panel:set-mode", "agent-panel:open"]);
      expect(frames).toHaveLength(1);

      frames[0]!(0);

      expect(document.activeElement).toBe(composer);
    } finally {
      window.removeEventListener("agent-panel:set-mode", recordEvent);
      window.removeEventListener("agent-panel:open", recordEvent);
      window.requestAnimationFrame = previousRequestAnimationFrame;
      panel.remove();
    }
  });

  it("waits for a lazy-loaded composer", () => {
    vi.useFakeTimers();
    const previousRequestAnimationFrame = window.requestAnimationFrame;
    const frames: Array<FrameRequestCallback> = [];
    const panel = document.createElement("div");
    panel.className = "agent-sidebar-panel";
    panel.dataset.agentSidebarState = "open";
    document.body.appendChild(panel);

    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }) as typeof window.requestAnimationFrame;

    try {
      focusAgentChat();
      frames[0]!(0);

      const composer = document.createElement("div");
      composer.className = "ProseMirror";
      panel.appendChild(composer);
      vi.advanceTimersByTime(50);

      expect(document.activeElement).toBe(composer);
    } finally {
      window.requestAnimationFrame = previousRequestAnimationFrame;
      panel.remove();
      vi.useRealTimers();
    }
  });

  it("focuses a frame-owned composer", () => {
    const previousRequestAnimationFrame = window.requestAnimationFrame;
    const frames: Array<FrameRequestCallback> = [];
    const panel = document.createElement("div");
    const composer = document.createElement("div");
    panel.className = "agent-frame-sidebar";
    panel.dataset.agentFrameSidebarState = "open";
    composer.className = "ProseMirror";
    panel.appendChild(composer);
    document.body.appendChild(panel);

    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }) as typeof window.requestAnimationFrame;

    try {
      focusAgentChat();
      frames[0]!(0);

      expect(document.activeElement).toBe(composer);
    } finally {
      window.requestAnimationFrame = previousRequestAnimationFrame;
      panel.remove();
    }
  });
});

describe("AgentSidebar toggle routing", () => {
  it("routes a scoped toggle only to the matching mounted sidebar", () => {
    const event = new CustomEvent("agent-panel:toggle", {
      detail: { scopeId: "mail-tab-1" },
    });
    const mountedScopes = ["mail-tab-1", "mail-tab-2"];

    expect(
      mountedScopes.filter((scope) =>
        shouldHandleAgentSidebarToggle(event, scope),
      ),
    ).toEqual(["mail-tab-1"]);
    expect(
      shouldHandleAgentSidebarToggle(
        new Event("agent-panel:toggle"),
        "mail-tab-2",
      ),
    ).toBe(true);
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

  it("keeps host CLI tabs mounted while chat is active", () => {
    const source = readFileSync("src/client/AgentPanel.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain('(mode === "cli" || Boolean(renderCliTab))');
    expect(source).toContain('active: mode === "cli" && id === activeCliTab');
    expect(source).toContain("const [mountedCliTabs, setMountedCliTabs]");
    expect(source).toContain(
      "cliTabs.filter((id) => mountedCliTabs.includes(id))",
    );
    expect(source).toContain("previousDefaultModeRef.current === defaultMode");
  });

  it("only shows tabs for the active desktop surface", () => {
    const source = readFileSync("src/client/AgentPanel.tsx", {
      encoding: "utf8",
    });

    expect(source).toMatch(/\{mode === "chat" &&\s+mainTabs\.map/);
    expect(source).toMatch(/\{mode === "cli" &&\s+cliTabs\.map/);
  });
});

describe("AgentSidebar wide drawer layout", () => {
  it("can disable the panel without unmounting the app surface", () => {
    const source = readFileSync("src/client/AgentPanel.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain("enabled?: boolean");
    expect(source).toContain("enabled &&");
    expect(source).toMatch(
      /const shouldRenderPanel =\s+enabled &&\s+\(sidebarAnimationEnabled \? renderAnimatedPanel : shouldMountPanel\)/,
    );
  });

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
    expect(panel.props).not.toHaveProperty("allowSettingsMode");
  });

  it("keeps settings out of every chat surface", () => {
    const source = readFileSync("src/client/AgentPanel.tsx", {
      encoding: "utf8",
    });

    expect(source).not.toContain("SettingsPanel");
    expect(source).not.toContain("allowSettingsMode");
    expect(source).not.toContain('mode === "settings"');
    expect(source).toContain('pathname: appPath("/settings")');
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
