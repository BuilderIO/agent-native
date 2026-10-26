// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatFirstPrimaryNavigation } from "./primary-nav.js";

describe("ChatFirstPrimaryNavigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const tabByLabel = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("nav button")].find(
      (tab) => tab.textContent?.includes(label),
    );

  it("marks exactly one navigation item as the current page", () => {
    act(() => {
      root.render(
        <ChatFirstPrimaryNavigation
          activeTab="integrations"
          onNewChat={vi.fn()}
          onOpenIntegrations={vi.fn()}
          onOpenScheduled={vi.fn()}
          onSearch={vi.fn()}
        />,
      );
    });

    expect(container.querySelectorAll("nav button")).toHaveLength(4);
    expect(
      container.querySelector('[role="tab"], [role="tablist"]'),
    ).toBeNull();
    const selected = container.querySelectorAll('[aria-current="page"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain("Integrations");
    expect(selected[0]?.className.split(" ")).toContain("bg-sidebar-accent");
    expect(
      container
        .querySelector(".code-agents-primary-new-chat")
        ?.hasAttribute("aria-current"),
    ).toBe(false);
    expect(
      container.querySelector("nav")?.getAttribute("aria-label"),
    ).toBeTruthy();
  });

  it("marks Search current with the same treatment as every other item", () => {
    act(() => {
      root.render(
        <ChatFirstPrimaryNavigation
          activeTab="search"
          onNewChat={vi.fn()}
          onOpenIntegrations={vi.fn()}
          onOpenScheduled={vi.fn()}
          onSearch={vi.fn()}
        />,
      );
    });

    const search = tabByLabel("Search");
    expect(search?.getAttribute("aria-current")).toBe("page");
    expect(search?.className.split(" ")).toContain("bg-sidebar-accent");
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    for (const label of ["New chat", "Integrations", "Scheduled"]) {
      expect(tabByLabel(label)?.hasAttribute("aria-current")).toBe(false);
    }
  });

  it("leaves Search unselected while another surface owns the rail", () => {
    act(() => {
      root.render(
        <ChatFirstPrimaryNavigation
          activeTab="scheduled"
          onNewChat={vi.fn()}
          onOpenIntegrations={vi.fn()}
          onOpenScheduled={vi.fn()}
          onSearch={vi.fn()}
        />,
      );
    });

    const search = tabByLabel("Search");
    expect(search?.hasAttribute("aria-current")).toBe(false);
    expect(search?.className.split(" ")).not.toContain("bg-sidebar-accent");
    expect(tabByLabel("Scheduled")?.className.split(" ")).toContain(
      "bg-sidebar-accent",
    );
  });

  it("marks no item current when no surface is resolved", () => {
    act(() => {
      root.render(
        <ChatFirstPrimaryNavigation
          onNewChat={vi.fn()}
          onOpenIntegrations={vi.fn()}
          onOpenScheduled={vi.fn()}
          onSearch={vi.fn()}
        />,
      );
    });

    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });

  it("calls each navigation handler, Search included", () => {
    const handlers = {
      newChat: vi.fn(),
      integrations: vi.fn(),
      scheduled: vi.fn(),
      search: vi.fn(),
    };

    act(() => {
      root.render(
        <ChatFirstPrimaryNavigation
          onNewChat={handlers.newChat}
          onOpenIntegrations={handlers.integrations}
          onOpenScheduled={handlers.scheduled}
          onSearch={handlers.search}
        />,
      );
    });

    const controls = [...container.querySelectorAll("button")];
    controls.forEach((control) => {
      act(() => control.click());
    });

    expect(handlers.newChat).toHaveBeenCalledOnce();
    expect(handlers.integrations).toHaveBeenCalledOnce();
    expect(handlers.scheduled).toHaveBeenCalledOnce();
    expect(handlers.search).toHaveBeenCalledOnce();
  });

  it("can keep New chat in a sticky shell above the scrolling navigation", () => {
    act(() => {
      root.render(
        <ChatFirstPrimaryNavigation
          onNewChat={vi.fn()}
          onOpenIntegrations={vi.fn()}
          onOpenScheduled={vi.fn()}
          onSearch={vi.fn()}
          stickyNewChat
        />,
      );
    });

    const shell = container.querySelector(
      ".code-agents-primary-new-chat-shell",
    );
    expect(shell).not.toBeNull();
    expect(shell?.textContent).toContain("New chat");
    expect(container.querySelector("nav")?.textContent).not.toContain(
      "New chat",
    );
    expect(container.querySelector("nav")?.textContent).toContain("Search");
    expect(container.querySelector(".code-agents-nav-list")).not.toBeNull();
  });

  it("shows collapsed navigation labels immediately on hover", async () => {
    act(() => {
      root.render(
        <ChatFirstPrimaryNavigation
          collapsed
          onNewChat={vi.fn()}
          onOpenIntegrations={vi.fn()}
          onOpenScheduled={vi.fn()}
          onSearch={vi.fn()}
        />,
      );
    });

    const integrations = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Integrations"]',
    );
    expect(integrations).not.toBeNull();

    await act(async () => {
      integrations?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      await new Promise((resolve) => window.setTimeout(resolve));
    });

    expect(
      document.querySelector('[data-agent-native-tooltip="true"]')?.textContent,
    ).toContain("Integrations");
  });

  it("keeps collapsed New chat icon-only with an accessible tooltip", () => {
    act(() => {
      root.render(
        <ChatFirstPrimaryNavigation
          collapsed
          onNewChat={vi.fn()}
          onOpenIntegrations={vi.fn()}
          onOpenScheduled={vi.fn()}
          stickyNewChat
        />,
      );
    });

    const newChat = container.querySelector<HTMLButtonElement>(
      ".code-agents-primary-new-chat",
    );
    expect(newChat).not.toBeNull();
    expect(newChat?.querySelector("span")?.className).toContain("sr-only");
    expect(newChat?.getAttribute("aria-label")).toBe("New chat");
    expect(newChat?.getAttribute("title")).toBeNull();
  });

  it("keeps every collapsed primary action icon-only and accessible", () => {
    act(() => {
      root.render(
        <ChatFirstPrimaryNavigation
          collapsed
          onNewChat={vi.fn()}
          onOpenIntegrations={vi.fn()}
          onOpenScheduled={vi.fn()}
          onSearch={vi.fn()}
        />,
      );
    });

    for (const label of ["New chat", "Integrations", "Scheduled", "Search"]) {
      const control = container.querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`,
      );
      expect(control).not.toBeNull();
      expect(control?.getAttribute("title")).toBeNull();
      expect(control?.className).toContain("justify-center");
      expect(control?.className).toContain("px-0");
      expect(control?.querySelector("span")?.className).toContain("sr-only");
    }
  });
});
