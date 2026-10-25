// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  title: null as React.ReactNode,
  actions: null as React.ReactNode,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app-shell/header-actions", () => ({
  HeaderActionsProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useHeaderTitle: () => store.title,
  useHeaderActions: () => store.actions,
}));
vi.mock("@agent-native/toolkit/app-shell", () => ({
  useHeaderTitle: () => store.title,
  useHeaderActions: () => store.actions,
}));
vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentToggleButton: () => <button type="button">Agent</button>,
}));
vi.mock("@agent-native/toolkit/app/chat/agentkit-chat/rail", () => ({
  isAgentChatHomeHandoffActive: () => false,
  useAgentChatHomeHandoff: () => false,
  useAgentChatHomeHandoffLinks: () => undefined,
}));
vi.mock("@agent-native/toolkit/app/settings", () => ({
  isSettingsPathname: (pathname: string) => pathname.startsWith("/settings"),
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: () => null,
  SheetContent: () => null,
  SheetDescription: () => null,
  SheetTitle: () => null,
}));
vi.mock("@/lib/app-config", () => ({ APP_TITLE: "Chat" }));
vi.mock("./Sidebar", () => ({ Sidebar: () => null }));
vi.mock("./AgentInspector", () => ({
  AgentInspector: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { Header } from "./Header";
import { Layout } from "./Layout";
import { MobileAppBar } from "./MobileAppBar";

describe("MobileAppBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    store.title = null;
    store.actions = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function bars() {
    return container.querySelectorAll<HTMLElement>("[data-mobile-app-bar]");
  }

  it("is one 48px bar with a 32px menu button, the title and the actions", () => {
    const onOpenNavigation = vi.fn();
    act(() =>
      root.render(
        <MobileAppBar
          onOpenNavigation={onOpenNavigation}
          title="Thread title"
          actions={<button type="button">Workspace</button>}
        />,
      ),
    );

    const bar = bars()[0];
    expect(bar.classList.contains("h-12")).toBe(true);
    const menu = bar.querySelector<HTMLButtonElement>(
      '[aria-label="navigation.openNavigation"]',
    );
    expect(menu?.classList.contains("size-8")).toBe(true);
    expect(menu?.classList.contains("md:hidden")).toBe(true);
    expect(bar.textContent).toContain("Thread title");
    expect(bar.textContent).toContain("Workspace");
    expect(bar.querySelector("h1")).toBeNull();

    act(() => menu?.click());
    expect(onOpenNavigation).toHaveBeenCalledTimes(1);
  });

  it("renders no empty actions group", () => {
    act(() => root.render(<MobileAppBar onOpenNavigation={() => {}} />));
    expect(bars()[0].children).toHaveLength(2);
  });

  function renderLayout(pathname: string) {
    act(() =>
      root.render(
        <MemoryRouter initialEntries={[pathname]}>
          <Layout>
            <div data-route-content="" />
          </Layout>
        </MemoryRouter>,
      ),
    );
  }

  it("keeps the AgentKit header on phones until the chat route publishes its header", () => {
    renderLayout("/chat/thread-1");

    expect(bars()).toHaveLength(1);
    expect(bars()[0].textContent).toBe("Chat");
    expect(
      container
        .querySelector("[data-agent-chat-canvas]")
        ?.hasAttribute("data-chat-header-in-app-bar"),
    ).toBe(false);
  });

  it("carries the published thread title and toolbar in the single chat bar", () => {
    store.title = "Quarterly plan";
    store.actions = <button type="button">Workspace</button>;
    renderLayout("/chat/thread-1");

    expect(bars()).toHaveLength(1);
    expect(bars()[0].textContent).toContain("Quarterly plan");
    expect(bars()[0].textContent).toContain("Workspace");
    expect(
      container
        .querySelector("[data-agent-chat-canvas]")
        ?.getAttribute("data-chat-header-in-app-bar"),
    ).toBe("true");
  });

  it("gives routes that own their toolbar a menu-only bar", () => {
    renderLayout("/home");

    expect(bars()).toHaveLength(1);
    expect(bars()[0].textContent).toBe("");
    expect(bars()[0].classList.contains("md:hidden")).toBe(true);
  });

  it("does not repeat the nav label as a page heading", () => {
    act(() =>
      root.render(
        <MemoryRouter initialEntries={["/observability"]}>
          <Header onOpenMobileSidebar={() => {}} />
        </MemoryRouter>,
      ),
    );

    expect(bars()).toHaveLength(1);
    expect(container.querySelector("h1")).toBeNull();
    expect(bars()[0].textContent).toBe("Agent");
  });
});
