// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DesktopChatFirstSurfaceMenu from "./DesktopChatFirstSurfaceMenu.js";

describe("DesktopChatFirstSurfaceMenu", () => {
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

  it("exposes sidebar and CLI actions from the full-screen menu", async () => {
    const onToggleSidebar = vi.fn();
    const onNewCliTab = vi.fn();

    act(() => {
      root.render(
        <DesktopChatFirstSurfaceMenu
          onToggleSidebar={onToggleSidebar}
          onNewCliTab={onNewCliTab}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Surface options"]',
    );
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      await Promise.resolve();
    });

    const menuItems = () =>
      Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      );
    expect(
      menuItems().some((item) => item.textContent?.includes("Open sidebar")),
    ).toBe(true);
    expect(
      menuItems().some((item) =>
        item.textContent?.includes("Open app in sidebar"),
      ),
    ).toBe(false);
    expect(
      menuItems().some((item) => item.textContent?.includes("New CLI tab")),
    ).toBe(true);

    const sidebarItem = menuItems().find((item) =>
      item.textContent?.includes("Open sidebar"),
    );
    await act(async () => sidebarItem?.click());
    expect(onToggleSidebar).toHaveBeenCalledOnce();
  });

  it("keeps the current-type plus and close controls beside the menu", () => {
    const onNewUiTab = vi.fn();
    const onClose = vi.fn();

    act(() => {
      root.render(
        <DesktopChatFirstSurfaceMenu
          onNewUiTab={onNewUiTab}
          onClose={onClose}
        />,
      );
    });

    const newTab = container.querySelector<HTMLButtonElement>(
      '[aria-label="New UI tab"]',
    );
    const close = container.querySelector<HTMLButtonElement>(
      '[aria-label="Close chat"]',
    );
    expect(newTab).not.toBeNull();
    expect(close).not.toBeNull();
    act(() => newTab?.click());
    act(() => close?.click());
    expect(onNewUiTab).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
