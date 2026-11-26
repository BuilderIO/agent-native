// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentPanel } from "./AgentPanel.js";

const header = vi.hoisted(() => ({
  showHistory: false,
  addTab: () => {},
  toggleHistory: () => {},
}));

vi.mock("./MultiTabAssistantChat.js", () => ({
  MultiTabAssistantChat: ({
    renderHeader,
  }: {
    renderHeader?: (props: never) => React.ReactNode;
  }) =>
    renderHeader?.({
      tabs: [{ id: "thread-1", label: "Current thread", status: "completed" }],
      activeTabId: "thread-1",
      activeTabMessageCount: 1,
      activeTabIsPersisted: true,
      setActiveTabId: () => {},
      addTab: header.addTab,
      closeTab: () => {},
      closeOtherTabs: () => {},
      closeAllTabs: () => {},
      clearActiveTab: () => {},
      showHistory: header.showHistory,
      toggleHistory: header.toggleHistory,
      tabCount: 1,
    } as never) ?? null,
}));

vi.mock("../sharing/index.js", () => ({
  ShareButton: () => <button data-testid="share-trigger">Share</button>,
}));

vi.mock("../resources/ResourcesPanel.js", () => ({
  ResourcesPanel: () => null,
}));

describe("AgentPanel in a host's panel head", () => {
  let root: Root;
  let container: HTMLDivElement;
  let head: HTMLDivElement;

  const render = (headerHost: HTMLElement | null = head) =>
    act(async () => {
      root.render(
        <MemoryRouter>
          <AgentPanel
            storageKey="header-host-test"
            onCollapse={() => {}}
            headerHost={headerHost}
          />
        </MemoryRouter>,
      );
    });

  const openOptions = (scope: ParentNode) =>
    act(async () => {
      const trigger = scope.querySelector<HTMLButtonElement>(
        '[aria-label="Agent panel options"]',
      );
      trigger?.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          cancelable: true,
        }),
      );
      trigger?.click();
    });

  beforeEach(() => {
    header.showHistory = false;
    header.addTab = vi.fn();
    header.toggleHistory = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    container = document.createElement("div");
    head = document.createElement("div");
    document.body.append(head, container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    head.remove();
    document.body.replaceChildren();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("puts the chat picker, New chat, Chat history and the options menu there", async () => {
    await render();

    const picker = head.querySelector("[data-agent-thread-switcher]");
    expect(picker?.textContent).toContain("Current thread");
    expect(picker?.className).toContain("h-8");
    const buttons = ["New chat", "All chats", "Agent panel options"].map(
      (label) =>
        head.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`),
    );
    for (const button of buttons) expect(button?.className).toContain("size-8");
    expect(
      container.querySelector(
        "[data-agent-thread-switcher], [aria-label='Agent panel options']",
      ),
    ).toBeNull();

    await act(async () => buttons[0]?.click());
    expect(header.addTab).toHaveBeenCalledOnce();
    await act(async () => buttons[1]?.click());
    expect(header.toggleHistory).toHaveBeenCalledOnce();
  });

  it("leaves Collapse sidebar and All chats out of the options menu", async () => {
    await render();
    await openOptions(head);

    const menu = document.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
    expect(menu?.textContent).not.toContain("Collapse sidebar");
    expect(menu?.textContent).not.toContain("All chats");
  });

  it("keeps both in the options menu of its own header", async () => {
    await render(null);
    await openOptions(container);

    const menu = document.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain("Collapse sidebar");
    expect(menu?.textContent).toContain("All chats");
  });

  it("gives focus back to Chat history when the list closes and leaves it nowhere", async () => {
    header.showHistory = true;
    await render();
    const toggle = head.querySelector<HTMLButtonElement>(
      "[data-agent-panel-history-toggle]",
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");

    (document.activeElement as HTMLElement | null)?.blur();
    header.showHistory = false;
    await render();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("leaves closing to the host, with no collapse button of its own", async () => {
    await render();

    expect(document.querySelector('[aria-label="Collapse sidebar"]')).toBe(
      null,
    );
  });

  it("keeps the terminal picker there in terminal mode", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AgentPanel
            storageKey="header-host-cli-test"
            onCollapse={() => {}}
            headerHost={head}
            defaultMode="cli"
            renderCliTab={() => <div />}
          />
        </MemoryRouter>,
      );
    });

    const picker = head.querySelector("[data-agent-thread-switcher]");
    expect(picker?.textContent).toContain("Terminal 1");
    expect(picker?.className).toContain("h-8");
  });

  it("keeps a picker back to chat there in Workspace mode", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AgentPanel
            storageKey="header-host-resources-test"
            onCollapse={() => {}}
            headerHost={head}
            defaultMode="resources"
          />
        </MemoryRouter>,
      );
    });

    const picker = head.querySelector("[data-agent-thread-switcher]");
    expect(picker?.textContent).toContain("Current thread");
    expect(picker?.className).toContain("h-8");
  });

  it("leaves focus that has moved on when the list closes", async () => {
    header.showHistory = true;
    await render();
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    elsewhere.focus();

    header.showHistory = false;
    await render();
    expect(document.activeElement).toBe(elsewhere);
  });
});
