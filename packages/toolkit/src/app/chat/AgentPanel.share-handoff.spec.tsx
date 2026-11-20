// @vitest-environment happy-dom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentShareHandoffRequest } from "../sharing/ShareButton.js";
import { AgentPanel } from "./AgentPanel.js";

const TABS = [
  { id: "thread-1", label: "First", status: "completed" },
  { id: "thread-2", label: "Second", status: "completed" },
];

vi.mock("./MultiTabAssistantChat.js", () => ({
  MultiTabAssistantChat: ({
    renderHeader,
    renderOverlay,
  }: {
    renderHeader?: (props: never) => React.ReactNode;
    renderOverlay?: (props: never) => React.ReactNode;
  }) => {
    const [activeTabId, setActiveTabId] = useState("thread-1");
    const headerProps = {
      tabs: TABS,
      activeTabId,
      activeTabMessageCount: 1,
      activeTabIsPersisted: true,
      setActiveTabId,
      addTab: vi.fn(),
      closeTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeAllTabs: vi.fn(),
      clearActiveTab: vi.fn(),
      showHistory: false,
      toggleHistory: vi.fn(),
      tabCount: 2,
    } as never;
    return (
      <>
        <button
          data-testid="switch-tab"
          onClick={() => setActiveTabId("thread-2")}
        />
        {renderHeader?.(headerProps)}
        {renderOverlay?.(headerProps)}
      </>
    );
  },
}));

vi.mock("../sharing/index.js", () => ({
  ShareButton: ({
    resourceId,
    resourceTitle,
    shareUrl,
    onAgentShareHandoff,
  }: {
    resourceId: string;
    resourceTitle?: string;
    shareUrl?: string;
    onAgentShareHandoff?: (request: AgentShareHandoffRequest) => void;
  }) => (
    <button
      data-testid="share-trigger"
      data-has-handoff={String(Boolean(onAgentShareHandoff))}
      onClick={() =>
        onAgentShareHandoff?.({
          destination: "codex",
          prompt: `prompt for ${resourceId}`,
          shareUrl: shareUrl ?? "",
          resourceType: "chat_thread",
          resourceId,
          resourceTitle,
        })
      }
    />
  ),
}));

describe("AgentPanel share handoff", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  const triggers = () => [
    ...container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="share-trigger"]',
    ),
  ];

  async function render(
    surface: "header" | "page",
    onAgentShareHandoff?: (r: AgentShareHandoffRequest) => void,
  ) {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AgentPanel
            storageKey="share-handoff-test"
            showHeader={surface === "header"}
            showPageHeader={surface === "page"}
            onAgentShareHandoff={onAgentShareHandoff}
          />
        </MemoryRouter>,
      );
    });
  }

  it.each(["header", "page"] as const)(
    "passes the current thread to the %s share button, also after a tab switch",
    async (surface) => {
      const onAgentShareHandoff = vi.fn();
      await render(surface, onAgentShareHandoff);
      expect(triggers().length).toBe(1);
      for (const trigger of triggers()) {
        expect(trigger.dataset.hasHandoff).toBe("true");
      }

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('[data-testid="switch-tab"]')
          ?.click();
      });
      for (const trigger of triggers()) {
        act(() => trigger.click());
      }

      expect(onAgentShareHandoff).toHaveBeenCalledTimes(1);
      for (const [request] of onAgentShareHandoff.mock.calls) {
        expect(request).toMatchObject({
          resourceId: "thread-2",
          resourceTitle: "Second",
          prompt: "prompt for thread-2",
        });
        expect(request.shareUrl).toContain("thread-2");
        expect(request.shareUrl).not.toContain("thread-1");
      }
    },
  );

  it.each(["header", "page"] as const)(
    "uses a callback added or replaced after mount on the %s share button",
    async (surface) => {
      const first = vi.fn();
      const second = vi.fn();
      const clickAll = () => {
        for (const trigger of triggers()) act(() => trigger.click());
      };

      await render(surface);
      expect(triggers()[0]?.dataset.hasHandoff).toBe("false");

      await render(surface, first);
      expect(triggers()[0]?.dataset.hasHandoff).toBe("true");
      clickAll();
      expect(first).toHaveBeenCalledTimes(1);

      await render(surface, second);
      clickAll();
      expect(second).toHaveBeenCalledTimes(1);
      expect(first).toHaveBeenCalledTimes(1);

      await render(surface);
      expect(triggers()[0]?.dataset.hasHandoff).toBe("false");
    },
  );

  it.each(["header", "page"] as const)(
    "leaves the %s share button on native behavior without the callback",
    async (surface) => {
      await render(surface);
      expect(triggers().length).toBeGreaterThan(0);
      for (const trigger of triggers()) {
        expect(trigger.dataset.hasHandoff).toBe("false");
      }
    },
  );
});
