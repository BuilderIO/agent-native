// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentPanel } from "./AgentPanel.js";

type MockHeaderProps = {
  renderOverlay?: (props: never) => React.ReactNode;
};

vi.mock("./MultiTabAssistantChat.js", () => ({
  MultiTabAssistantChat: ({ renderOverlay }: MockHeaderProps) =>
    renderOverlay?.({
      tabs: [{ id: "thread-1", label: "Current thread", status: "completed" }],
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
  ShareButton: ({
    triggerContent,
    triggerClassName,
  }: {
    triggerContent?: React.ReactNode;
    triggerClassName?: string;
  }) => (
    <button data-testid="share-trigger" data-trigger-class={triggerClassName}>
      {triggerContent ?? "Share"}
    </button>
  ),
}));

describe("AgentPanel page header share trigger", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    localStorage.clear();
  });

  it("renders the default icon and host-provided content through ShareButton", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    const renderPanel = async (triggerContent?: React.ReactNode) =>
      act(async () => {
        root!.render(
          <MemoryRouter>
            <AgentPanel
              storageKey="page-header-share-test"
              showHeader={false}
              showPageHeader
              pageHeaderShareTriggerContent={triggerContent}
            />
          </MemoryRouter>,
        );
      });

    await renderPanel();
    const defaultButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="share-trigger"]',
    );
    expect(defaultButton?.querySelector("svg")).not.toBeNull();
    expect(defaultButton?.dataset.triggerClass).toContain("size-8");

    await renderPanel(
      <span className="flex items-center gap-1.5">
        <svg data-testid="custom-share-icon" aria-hidden="true" />
        <span>Share</span>
      </span>,
    );
    const customButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="share-trigger"]',
    );
    expect(customButton?.textContent).toBe("Share");
    expect(
      customButton?.querySelector('[data-testid="custom-share-icon"]'),
    ).not.toBeNull();
    expect(customButton?.dataset.triggerClass).toContain("w-auto");
    expect(customButton?.dataset.triggerClass).toContain("px-2");
  });
});
