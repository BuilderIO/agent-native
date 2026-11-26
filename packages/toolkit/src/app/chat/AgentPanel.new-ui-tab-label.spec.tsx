// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentPanel } from "./AgentPanel.js";

type MockHeaderProps = {
  renderOverlay?: (props: never) => React.ReactNode;
};

vi.mock("./MultiTabAssistantChat.js", () => ({
  MultiTabAssistantChat: ({ renderOverlay }: MockHeaderProps) =>
    renderOverlay?.({
      tabs: [{ id: "thread-1", label: "", status: "completed" }],
      activeTabId: "thread-1",
      activeTabMessageCount: 1,
      activeTabIsPersisted: true,
      setActiveTabId: vi.fn(),
      addTab: vi.fn(),
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

describe("AgentPanel newUiTabLabel", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
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

  it("titles an untitled active chat with the app-provided label in the page header", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const testRoot = createRoot(container);
    root = testRoot;

    await act(async () => {
      testRoot.render(
        <MemoryRouter>
          <AgentPanel
            storageKey="new-ui-tab-label-test"
            showHeader={false}
            showPageHeader
            newUiTabLabel="Custom new chat"
          />
        </MemoryRouter>,
      );
    });

    const title = container.querySelector("[data-agent-page-chat-header] h1");
    expect(title?.textContent).toBe("Custom new chat");

    await act(async () => {
      testRoot.render(
        <MemoryRouter>
          <AgentPanel
            storageKey="new-ui-tab-label-test"
            showHeader={false}
            showPageHeader
            newUiTabLabel="Updated chat"
          />
        </MemoryRouter>,
      );
    });
    expect(
      container.querySelector("[data-agent-page-chat-header] h1")?.textContent,
    ).toBe("Updated chat");
  });
});
