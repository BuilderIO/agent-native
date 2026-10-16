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

function agentPanel(
  state: "open" | "closed",
  width = 380,
  layout: "desktop" | "overlay" = "desktop",
) {
  const panel = document.createElement("div");
  panel.className = "agent-sidebar-panel";
  panel.dataset.agentSidebarState = state;
  panel.dataset.agentSidebarLayout = layout;
  panel.style.setProperty("--agent-sidebar-width", `${width}px`);
  return panel;
}

// The toolkit's desktop panel transitions its width; a test DOM computes only
// the longhands.
function animateWidth(panel: HTMLElement, duration: string) {
  panel.style.transitionProperty = "width";
  panel.style.transitionDuration = duration;
}

function transitionEnd(propertyName: string) {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: propertyName });
  return event;
}

describe("useContentShellLayout", () => {
  let container: HTMLDivElement;
  let root: Root;
  let layouts: ContentLayout[];
  let holdUtilityRail: () => () => void;

  function Shell() {
    const shellRef = useRef<HTMLDivElement>(null);
    const shell = useContentShellLayout({
      shellRef,
      sidebar: { collapsed: false, width: 240 },
    });
    holdUtilityRail = shell.holdUtilityRail;
    layouts.push(shell.layout);
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

  it("budgets a closing panel's width until its width transition ends", async () => {
    await act(async () => setViewportWidth(1200));
    const panel = agentPanel("open");
    animateWidth(panel, "260ms");
    const inner = document.createElement("div");
    panel.append(inner);
    await act(async () => agentShell().append(panel));
    const besidePanel = {
      sidebar: "docked",
      agentPanel: "docked",
      comments: { margin: "anchored", list: "region-list" },
    };
    expect(latestLayout()).toMatchObject(besidePanel);

    await act(async () => {
      panel.dataset.agentSidebarState = "closed";
    });
    expect(latestLayout()).toMatchObject(besidePanel);

    await act(async () => inner.dispatchEvent(transitionEnd("transform")));
    expect(latestLayout()).toMatchObject(besidePanel);

    await act(async () => panel.dispatchEvent(transitionEnd("width")));
    expect(latestLayout()).toMatchObject({
      sidebar: "docked",
      agentPanel: "closed",
      comments: { margin: "lane", list: "rail" },
    });
  });

  it("keeps a forced overlay's budget until its transform transition ends", async () => {
    await act(async () => setViewportWidth(768));
    const panel = agentPanel("open", 380, "overlay");
    panel.style.transitionProperty = "transform";
    panel.style.transitionDuration = "260ms";
    await act(async () => agentShell().append(panel));
    expect(latestLayout().agentPanel).toBe("overlay");

    await act(async () => {
      panel.dataset.agentSidebarState = "closed";
    });
    expect(latestLayout().agentPanel).toBe("overlay");

    await act(async () => panel.dispatchEvent(transitionEnd("transform")));
    expect(latestLayout().agentPanel).toBe("closed");
  });

  it("releases a closing panel's width without a transitionend", async () => {
    await act(async () => setViewportWidth(1200));
    const panel = agentPanel("open");
    animateWidth(panel, "20ms");
    await act(async () => agentShell().append(panel));

    await act(async () => {
      panel.dataset.agentSidebarState = "closed";
    });
    expect(latestLayout().agentPanel).toBe("docked");
    await act(() => new Promise((resolve) => setTimeout(resolve, 120)));
    expect(latestLayout().agentPanel).toBe("closed");

    await act(async () => {
      panel.dataset.agentSidebarState = "open";
    });
    expect(latestLayout().agentPanel).toBe("docked");
    await act(async () => {
      panel.dataset.agentSidebarState = "closed";
    });
    expect(latestLayout().agentPanel).toBe("docked");
    await act(async () => panel.remove());
    expect(latestLayout().agentPanel).toBe("closed");
  });

  it("releases at once when the panel draws no closing width", async () => {
    await act(async () => setViewportWidth(1200));
    const reducedMotion = agentPanel("open");
    reducedMotion.style.transitionProperty = "none";
    await act(async () => agentShell().append(reducedMotion));
    await act(async () => {
      reducedMotion.dataset.agentSidebarState = "closed";
    });
    expect(latestLayout().agentPanel).toBe("closed");

    const drawer = agentPanel("open");
    drawer.dataset.agentSidebarLayout = "drawer";
    animateWidth(drawer, "260ms");
    const placeholder = document.createElement("div");
    placeholder.setAttribute("data-agent-sidebar-placeholder", "");
    placeholder.style.width = "380px";
    await act(async () => agentShell().replaceChildren(drawer, placeholder));
    expect(latestLayout().agentPanel).toBe("docked");
    await act(async () => {
      drawer.dataset.agentSidebarState = "closed";
      placeholder.remove();
    });
    expect(latestLayout().agentPanel).toBe("closed");
  });

  it("gives the sidebar's room to a page rail until every page releases it", async () => {
    await act(async () => setViewportWidth(1100));
    expect(latestLayout()).toMatchObject({
      sidebar: "docked",
      comments: { list: "region-list" },
    });

    let releaseLeaving = () => {};
    let releaseArriving = () => {};
    await act(async () => {
      releaseLeaving = holdUtilityRail();
      releaseArriving = holdUtilityRail();
    });
    expect(latestLayout()).toMatchObject({
      sidebar: "rail",
      sidebarAutoCollapsed: true,
      comments: { list: "rail" },
    });

    await act(async () => releaseLeaving());
    expect(latestLayout().comments.list).toBe("rail");

    await act(async () => releaseArriving());
    expect(latestLayout()).toMatchObject({
      sidebar: "docked",
      comments: { margin: "anchored", list: "region-list" },
    });
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("false");
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
