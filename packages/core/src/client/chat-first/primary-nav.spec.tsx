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

  it("marks the selected navigation tab without selecting Search", () => {
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

    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(3);
    const activeTab = container.querySelector(
      '[role="tab"][aria-selected="true"]',
    );
    expect(activeTab?.textContent).toContain("Integrations");
    expect(activeTab?.className).toContain("bg-sidebar-accent");
    expect(activeTab?.className).not.toContain("border-sidebar-foreground/45");
    expect(
      container.querySelector('[role="tab"][aria-selected="false"]')?.className,
    ).toContain("code-agents-primary-new-chat");
    const searchButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Search"),
    );
    expect(searchButton?.getAttribute("role")).toBeNull();
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it("keeps Search as an action and calls each navigation handler", () => {
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
    expect(
      container.querySelector('[role="tablist"]')?.textContent,
    ).not.toContain("New chat");
    expect(container.querySelector(".code-agents-nav-list")).not.toBeNull();
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
    expect(newChat?.getAttribute("title")).toBe("New chat");
  });
});
