// @vitest-environment happy-dom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentLayout } from "./content-layout";
import { SIDEBAR_COLLAPSED_KEY } from "./sidebar-preferences";
import {
  readAgentPanelDock,
  useContentShellLayout,
} from "./use-content-layout";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
}

function agentPanel(state: "open" | "closed", width = 380) {
  const panel = document.createElement("div");
  panel.className = "agent-sidebar-panel";
  panel.dataset.agentSidebarState = state;
  panel.dataset.agentSidebarLayout = "desktop";
  panel.style.setProperty("--agent-sidebar-width", `${width}px`);
  return panel;
}

describe("useContentShellLayout", () => {
  let container: HTMLDivElement;
  let root: Root;
  let layouts: ContentLayout[];

  function Shell() {
    const shellRef = useRef<HTMLDivElement>(null);
    const { layout } = useContentShellLayout({
      shellRef,
      sidebar: { collapsed: false, width: 240 },
    });
    layouts.push(layout);
    return (
      <div ref={shellRef}>
        <div className="agent-sidebar-shell" />
      </div>
    );
  }

  function latestLayout() {
    return layouts[layouts.length - 1];
  }

  function agentShell() {
    return container.querySelector(".agent-sidebar-shell")!;
  }

  beforeEach(async () => {
    layouts = [];
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "false");
    setViewportWidth(1024);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Shell />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
  });

  it("makes room for a docked agent panel without closing it or saving a collapse", async () => {
    const closeAgentPanel = vi.fn();
    window.addEventListener("agent-panel:close", closeAgentPanel);
    expect(latestLayout().sidebar).toBe("docked");

    const panel = agentPanel("open");
    await act(async () => agentShell().append(panel));
    expect(latestLayout()).toMatchObject({
      sidebar: "rail",
      sidebarAutoCollapsed: true,
      agentPanel: "docked",
    });

    await act(async () => setViewportWidth(560));
    expect(latestLayout()).toMatchObject({
      sidebar: "drawer",
      agentPanel: "overlay",
    });

    await act(async () => setViewportWidth(1600));
    expect(latestLayout()).toMatchObject({
      sidebar: "docked",
      sidebarAutoCollapsed: false,
      agentPanel: "docked",
    });

    await act(async () => {
      panel.dataset.agentSidebarState = "closed";
    });
    expect(latestLayout().agentPanel).toBe("closed");

    expect(closeAgentPanel).not.toHaveBeenCalled();
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("false");
    window.removeEventListener("agent-panel:close", closeAgentPanel);
  });

  it("re-renders only when a mode changes", async () => {
    const before = layouts.length;
    await act(async () => setViewportWidth(1030));
    await act(async () => setViewportWidth(1040));
    expect(layouts.length).toBe(before);
  });
});

describe("readAgentPanelDock", () => {
  it("reads the target width, not the animating one", () => {
    const shell = document.createElement("div");
    expect(readAgentPanelDock(shell)).toEqual({ open: false, width: 0 });

    shell.append(agentPanel("open", 420));
    expect(readAgentPanelDock(shell)).toEqual({ open: true, width: 420 });

    const placeholder = document.createElement("div");
    placeholder.setAttribute("data-agent-sidebar-placeholder", "");
    placeholder.style.width = "360px";
    shell.replaceChildren(agentPanel("closed"), placeholder);
    expect(readAgentPanelDock(shell)).toEqual({ open: true, width: 360 });

    shell.replaceChildren(agentPanel("closed"));
    expect(readAgentPanelDock(shell)).toEqual({ open: false, width: 0 });
  });
});
