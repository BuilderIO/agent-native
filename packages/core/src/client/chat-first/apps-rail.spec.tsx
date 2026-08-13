// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatFirstAppsRail } from "./apps-rail.js";

describe("ChatFirstAppsRail", () => {
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

  it("grays non-selected app icons while keeping the selected icon in color", () => {
    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[
            { id: "content", name: "Content" },
            { id: "analytics", name: "Analytics" },
          ]}
          activeAppId="content"
          collapsed
          onOpenApp={vi.fn()}
          renderIcon={(app) => <span>{app.name}</span>}
        />,
      );
    });

    const selectedIcon = container.querySelector<HTMLElement>(
      '[data-app-id="content"] [data-chat-first-app-icon]',
    );
    const inactiveIcon = container.querySelector<HTMLElement>(
      '[data-app-id="analytics"] [data-chat-first-app-icon]',
    );

    expect(selectedIcon?.className).not.toContain("grayscale");
    expect(inactiveIcon?.className).toContain("grayscale");
  });

  it("keeps app icons in color when no app is selected", () => {
    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[{ id: "content", name: "Content" }]}
          collapsed
          onOpenApp={vi.fn()}
          renderIcon={(app) => <span>{app.name}</span>}
        />,
      );
    });

    const icon = container.querySelector<HTMLElement>(
      "[data-chat-first-app-icon]",
    );
    expect(icon?.className).not.toContain("grayscale");
  });
});
