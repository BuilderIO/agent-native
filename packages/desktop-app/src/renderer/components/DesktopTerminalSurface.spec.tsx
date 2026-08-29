// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DesktopTerminalSurface from "./DesktopTerminalSurface.js";

vi.mock("./DesktopTerminalTabs.js", () => ({
  default: () => <div data-terminal-test />,
}));

describe("DesktopTerminalSurface", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

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

  it("offers a new UI tab from CLI options", async () => {
    const onNewUiTab = vi.fn();
    act(() => {
      root.render(
        <DesktopTerminalSurface
          agent="codex"
          theme="dark"
          onNewUiTab={onNewUiTab}
        />,
      );
    });

    await act(async () => {
      const trigger = container.querySelector<HTMLButtonElement>(
        '[aria-label="Terminal options"]',
      );
      trigger?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      await Promise.resolve();
    });
    const item = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((candidate) => candidate.textContent?.includes("New UI tab"));

    expect(item).toBeDefined();
    await act(async () => item?.click());
    expect(onNewUiTab).toHaveBeenCalledOnce();
  });

  it("opens the shared sidebar from CLI options", async () => {
    const onOpenSidebar = vi.fn();
    act(() => {
      root.render(
        <DesktopTerminalSurface
          agent="codex"
          theme="dark"
          onOpenSidebar={onOpenSidebar}
        />,
      );
    });

    await act(async () => {
      const trigger = container.querySelector<HTMLButtonElement>(
        '[aria-label="Terminal options"]',
      );
      trigger?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      await Promise.resolve();
    });
    const item = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((candidate) => candidate.textContent?.includes("Open sidebar"));

    expect(item).toBeDefined();
    await act(async () => item?.click());
    expect(onOpenSidebar).toHaveBeenCalledOnce();
  });
});
