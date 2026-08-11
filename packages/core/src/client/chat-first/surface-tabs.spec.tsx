// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatFirstSurfaceTabs } from "./surface-tabs.js";

describe("ChatFirstSurfaceTabs", () => {
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
  });

  it("keeps the complete workspace app list available in the picker", () => {
    const apps = Array.from({ length: 16 }, (_, index) => ({
      id: `app-${index}`,
      name: `App ${index}`,
    }));

    act(() => {
      root.render(
        <ChatFirstSurfaceTabs
          tabs={[]}
          activeTabId={null}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onCloseOthers={vi.fn()}
          onCloseToRight={vi.fn()}
          onCloseAll={vi.fn()}
          onOpenSurface={vi.fn()}
          apps={apps}
          onOpenApp={vi.fn()}
        />,
      );
    });

    const emptyState = container.querySelector<HTMLElement>(
      "[data-surface-empty-state]",
    );
    expect(emptyState?.className).toContain("overflow-y-auto");
    expect(
      container.querySelectorAll("[data-chat-first-surface-app]"),
    ).toHaveLength(apps.length);
  });

  it("keeps tab semantics and activation on the keyboard focus target", () => {
    const tabs = [
      {
        id: "browser:docs",
        kind: "browser" as const,
        title: "Docs",
        url: "https://example.com/docs",
      },
      {
        id: "app:analytics:/",
        kind: "app" as const,
        title: "Analytics",
        appId: "analytics",
        path: "/",
      },
    ];
    const onActivate = vi.fn();

    act(() => {
      root.render(
        <ChatFirstSurfaceTabs
          tabs={tabs}
          activeTabId={tabs[0].id}
          onActivate={onActivate}
          onClose={vi.fn()}
          onCloseOthers={vi.fn()}
          onCloseToRight={vi.fn()}
          onCloseAll={vi.fn()}
        />,
      );
    });

    const tabButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    expect(tabButtons.map((button) => button.tagName)).toEqual([
      "BUTTON",
      "BUTTON",
    ]);
    expect(tabButtons.map((button) => button.tabIndex)).toEqual([0, -1]);

    act(() => {
      tabButtons[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });
    expect(onActivate).toHaveBeenCalledWith(tabs[0]);

    act(() => {
      tabButtons[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
      );
    });
    expect(onActivate).toHaveBeenCalledWith(tabs[1]);
  });
});
