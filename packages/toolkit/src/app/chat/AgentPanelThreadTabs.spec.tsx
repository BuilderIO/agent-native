// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_PANEL_TABS_MIN_PANEL_WIDTH,
  AgentPanelThreadNav,
  measureAgentPanelTabOverflow,
  resolveAgentPanelTabLayout,
  useElementInlineSize,
  type AgentPanelThreadItem,
} from "./AgentPanelThreadTabs.js";

const ITEMS: AgentPanelThreadItem[] = [
  { id: "a", label: "Quarterly plan", active: true, running: true },
  { id: "b", label: "Launch notes", active: false },
  { id: "c", label: "Bug triage", active: false },
];

let root: Root | undefined;
let container: HTMLDivElement | undefined;

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  static fire() {
    for (const observer of FakeResizeObserver.instances) {
      observer.callback([], observer as unknown as ResizeObserver);
    }
  }
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
}

function navProps() {
  return {
    items: ITEMS,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onNew: vi.fn(),
    newLabel: "New chat",
    closeLabel: "Close tab",
    tabListLabel: "Chat tabs",
  };
}

function openMenu(trigger: Element | null | undefined) {
  act(() => {
    trigger?.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        cancelable: true,
      }),
    );
    (trigger as HTMLElement | null | undefined)?.click();
  });
}

const menuItems = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));

describe("resolveAgentPanelTabLayout", () => {
  it("switches to the thread switcher below 384px of panel width", () => {
    expect(AGENT_PANEL_TABS_MIN_PANEL_WIDTH).toBe(384);
    expect(resolveAgentPanelTabLayout(320)).toBe("switcher");
    expect(resolveAgentPanelTabLayout(383)).toBe("switcher");
    expect(resolveAgentPanelTabLayout(384)).toBe("tabs");
    expect(resolveAgentPanelTabLayout(600)).toBe("tabs");
  });

  it("keeps tabs while the panel has no layout width", () => {
    expect(resolveAgentPanelTabLayout(null)).toBe("tabs");
  });
});

describe("width-driven thread navigation", () => {
  function Harness(props: ReturnType<typeof navProps>) {
    const ref = useRef<HTMLDivElement>(null);
    const width = useElementInlineSize(ref);
    return (
      <div ref={ref} data-testid="panel">
        <AgentPanelThreadNav
          {...props}
          layout={resolveAgentPanelTabLayout(width)}
        />
      </div>
    );
  }

  it("follows the panel's own width, not the viewport", () => {
    let panelWidth = 600;
    const original = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetWidth",
    );
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.testid === "panel" ? panelWidth : 0;
      },
    });
    try {
      render(<Harness {...navProps()} />);
      expect(container?.querySelector('[role="tablist"]')).toBeTruthy();
      expect(
        container?.querySelector("[data-agent-thread-switcher]"),
      ).toBeNull();

      panelWidth = 360;
      act(() => FakeResizeObserver.fire());
      expect(container?.querySelector('[role="tablist"]')).toBeNull();
      expect(
        container?.querySelector("[data-agent-thread-switcher]")?.textContent,
      ).toContain("Quarterly plan");

      panelWidth = 440;
      act(() => FakeResizeObserver.fire());
      expect(container?.querySelectorAll('[role="tab"]')).toHaveLength(3);
    } finally {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", original);
      }
    }
  });
});

describe("AgentPanelThreadSwitcher", () => {
  it("shows the current chat with its running dot and a chevron", () => {
    render(<AgentPanelThreadNav {...navProps()} layout="switcher" />);
    const trigger = container?.querySelector<HTMLElement>(
      "[data-agent-thread-switcher]",
    );
    expect(trigger?.querySelector(".truncate")?.textContent).toBe(
      "Quarterly plan",
    );
    expect(trigger?.querySelector(".animate-pulse")).toBeTruthy();
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("lists new chat first, then open chats with a check on the current one", () => {
    render(<AgentPanelThreadNav {...navProps()} layout="switcher" />);
    openMenu(container?.querySelector("[data-agent-thread-switcher]"));

    const items = menuItems();
    expect(items.map((item) => item.textContent)).toEqual([
      "New chat",
      "Quarterly plan",
      "Launch notes",
      "Bug triage",
    ]);
    expect(items[1]?.getAttribute("aria-current")).toBe("true");
    expect(items[1]?.querySelector("svg.tabler-icon-check")).toBeTruthy();
    expect(items[2]?.getAttribute("aria-current")).toBeNull();
  });

  it("switches, starts a new chat, and closes without switching", () => {
    const props = navProps();
    render(<AgentPanelThreadNav {...props} layout="switcher" />);

    openMenu(container?.querySelector("[data-agent-thread-switcher]"));
    act(() => menuItems()[2]?.click());
    expect(props.onSelect).toHaveBeenCalledWith("b");

    openMenu(container?.querySelector("[data-agent-thread-switcher]"));
    act(() => menuItems()[0]?.click());
    expect(props.onNew).toHaveBeenCalledOnce();

    openMenu(container?.querySelector("[data-agent-thread-switcher]"));
    const close = menuItems()[3]?.querySelector<HTMLElement>(
      "[data-agent-thread-menu-close]",
    );
    expect(close?.getAttribute("aria-label")).toBe("Close tab");
    act(() => {
      close?.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button: 0 }),
      );
      close?.click();
    });
    expect(props.onClose).toHaveBeenCalledWith("c");
    expect(props.onSelect).toHaveBeenCalledTimes(1);
  });

  it("closes the focused chat from the keyboard", () => {
    const props = navProps();
    render(<AgentPanelThreadNav {...props} layout="switcher" />);
    openMenu(container?.querySelector("[data-agent-thread-switcher]"));
    act(() => {
      menuItems()[2]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
      );
    });
    expect(props.onClose).toHaveBeenCalledWith("b");
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});

describe("AgentPanelThreadTabStrip", () => {
  it("exposes only tabs in the tablist and closes from Delete or the pointer control", () => {
    const props = navProps();
    render(<AgentPanelThreadNav {...props} layout="tabs" />);
    const tablist = container?.querySelector<HTMLElement>('[role="tablist"]');
    const exposed = Array.from(
      tablist?.querySelectorAll<HTMLElement>("button, [role]") ?? [],
    ).filter((element) => !element.closest('[aria-hidden="true"]'));
    expect(exposed.map((element) => element.getAttribute("role"))).toEqual([
      "tab",
      "tab",
      "tab",
    ]);

    const tabs = exposed;
    expect(tabs[1]?.getAttribute("aria-keyshortcuts")).toBe("Delete Backspace");
    act(() => {
      tabs[1]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
      );
    });
    expect(props.onClose).toHaveBeenCalledWith("b");

    const close = tablist
      ?.querySelectorAll<HTMLButtonElement>(".agent-tab-close")
      .item(2);
    expect(close?.tabIndex).toBe(-1);
    act(() => close?.click());
    expect(props.onClose).toHaveBeenLastCalledWith("c");
    expect(props.onSelect).not.toHaveBeenCalled();

    tabs[0]?.focus();
    act(() => {
      tabs[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(tabs[1]);
  });

  it("never squeezes tabs below 112px and caps them at 200px", () => {
    render(<AgentPanelThreadNav {...navProps()} layout="tabs" />);
    const groups = container?.querySelectorAll<HTMLElement>(
      "[data-agent-tab-item]",
    );
    expect(groups).toHaveLength(3);
    for (const group of groups ?? []) {
      expect(group.className).toContain("min-w-28");
      expect(group.className).toContain("max-w-[200px]");
    }
  });

  it("counts tabs clipped by the scroller", () => {
    const scroller = document.createElement("div");
    Object.defineProperties(scroller, {
      scrollWidth: { value: 520 },
      clientWidth: { value: 300 },
      scrollLeft: { value: 0, writable: true },
    });
    scroller.getBoundingClientRect = () => ({ left: 0, right: 300 }) as DOMRect;
    [0, 120, 240, 360].forEach((left) => {
      const tab = document.createElement("div");
      tab.setAttribute("data-agent-tab-item", "");
      tab.getBoundingClientRect = () =>
        ({ left, right: left + 112 }) as DOMRect;
      scroller.appendChild(tab);
    });

    expect(measureAgentPanelTabOverflow(scroller)).toEqual({
      start: false,
      end: true,
      hidden: 2,
    });
    scroller.scrollLeft = 220;
    expect(measureAgentPanelTabOverflow(scroller).start).toBe(true);
    expect(measureAgentPanelTabOverflow(scroller).end).toBe(false);
  });

  it("offers the open chats menu when tabs overflow", () => {
    const originals = (["scrollWidth", "clientWidth"] as const).map(
      (name) =>
        [
          name,
          Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
        ] as const,
    );
    const rect = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute("role") === "tablist" ? 360 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute("role") === "tablist" ? 240 : 0;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.getAttribute("role") === "tablist") {
        return { left: 0, right: 240 } as DOMRect;
      }
      const index = Array.from(this.parentElement?.children ?? []).indexOf(
        this,
      );
      return { left: index * 120, right: index * 120 + 112 } as DOMRect;
    };
    try {
      const props = navProps();
      render(<AgentPanelThreadNav {...props} layout="tabs" />);
      const more = container?.querySelector<HTMLElement>(
        "[data-agent-tabs-more]",
      );
      expect(more?.textContent).toBe("1 more");
      expect(
        container
          ?.querySelector('[role="tablist"]')
          ?.hasAttribute("data-overflow-end"),
      ).toBe(true);

      openMenu(more);
      expect(menuItems().map((item) => item.textContent)).toEqual([
        "New chat",
        "Quarterly plan",
        "Launch notes",
        "Bug triage",
      ]);
      act(() => menuItems()[3]?.click());
      expect(props.onSelect).toHaveBeenCalledWith("c");
    } finally {
      for (const [name, descriptor] of originals) {
        if (descriptor) {
          Object.defineProperty(HTMLElement.prototype, name, descriptor);
        }
      }
      HTMLElement.prototype.getBoundingClientRect = rect;
    }
  });

  it("does not show the overflow menu when every tab fits", () => {
    render(<AgentPanelThreadNav {...navProps()} layout="tabs" />);
    expect(container?.querySelector("[data-agent-tabs-more]")).toBeNull();
  });
});
