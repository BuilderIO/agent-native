// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentPanel } from "./AgentPanel.js";

const addTab = vi.fn();

vi.mock("./MultiTabAssistantChat.js", () => ({
  MultiTabAssistantChat: ({
    renderOverlay,
  }: {
    renderOverlay?: (props: never) => React.ReactNode;
  }) =>
    renderOverlay?.({
      tabs: [{ id: "thread-1", label: "Current thread", status: "completed" }],
      activeTabId: "thread-1",
      activeTabMessageCount: 1,
      activeTabIsPersisted: true,
      setActiveTabId: vi.fn(),
      addTab,
      closeTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeAllTabs: vi.fn(),
      clearActiveTab: vi.fn(),
      showHistory: false,
      toggleHistory: vi.fn(),
      tabCount: 1,
    } as never) ?? null,
}));

vi.mock("../sharing/index.js", () => ({
  ShareButton: () => <button data-testid="share-trigger">Share</button>,
}));

describe("AgentPanel page header new chat action", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    addTab.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("is a single 24px icon button labelled New chat, with no text pill", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <AgentPanel
            storageKey="page-new-chat-test"
            showHeader={false}
            showPageHeader
            showPageNewChatButton
          />
        </MemoryRouter>,
      );
    });

    const actions = container.querySelectorAll<HTMLButtonElement>(
      "[data-agent-page-new-chat]",
    );
    expect(actions).toHaveLength(1);
    const action = actions[0]!;
    expect(action.getAttribute("aria-label")).toBe("New chat");
    expect(action.textContent).toBe("");
    expect(action.className).toContain("size-6");
    expect(action.querySelector("svg")).not.toBeNull();

    await act(async () => action.click());
    expect(addTab).toHaveBeenCalledTimes(1);
  });
});
