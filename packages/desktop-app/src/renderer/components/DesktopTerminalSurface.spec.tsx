// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DesktopTerminalSurface from "./DesktopTerminalSurface.js";

vi.mock("./DesktopTerminalTabs.js", () => ({
  default: ({
    agent,
    active,
    activeApp,
  }: {
    agent: string;
    active?: boolean;
    activeApp?: { id: string };
  }) => (
    <div
      data-terminal-test
      data-terminal-agent={agent}
      data-terminal-active={active === false ? "false" : "true"}
      data-terminal-app={activeApp?.id ?? ""}
    />
  ),
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

  it("offers a new CLI tab from CLI options", async () => {
    act(() => {
      root.render(<DesktopTerminalSurface agent="codex" theme="dark" />);
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
    ).find((candidate) => candidate.textContent?.includes("New CLI tab"));

    expect(item).toBeDefined();
    await act(async () => item?.click());
    expect(
      container.querySelectorAll("[data-desktop-terminal-tab]"),
    ).toHaveLength(2);
  });

  it("toggles the shared sidebar from CLI options", async () => {
    const onToggleSidebar = vi.fn();
    act(() => {
      root.render(
        <DesktopTerminalSurface
          agent="codex"
          theme="dark"
          sidebarOpen
          onToggleSidebar={onToggleSidebar}
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
    ).find((candidate) => candidate.textContent?.includes("Hide sidebar"));

    expect(item).toBeDefined();
    await act(async () => item?.click());
    expect(onToggleSidebar).toHaveBeenCalledOnce();
  });

  it("offers the supported terminal providers", async () => {
    act(() => {
      root.render(
        <DesktopTerminalSurface
          agent="codex"
          theme="dark"
          onAgentChange={vi.fn()}
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

    const providerItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Provider"));
    expect(providerItem).not.toBeUndefined();
    expect(providerItem?.querySelector(".desktop-dropdown-item__main")).toBe(
      null,
    );
    expect(providerItem?.classList.contains("gap-2")).toBe(true);
    expect(providerItem?.querySelector("svg.ms-auto")).not.toBeNull();
    expect(
      Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).some((item) => item.textContent?.includes("Terminal provider")),
    ).toBe(false);
  });

  it("keeps inactive terminal sessions on their original provider", async () => {
    const onAgentChange = vi.fn();
    act(() => {
      root.render(
        <DesktopTerminalSurface
          agent="codex"
          theme="dark"
          onAgentChange={onAgentChange}
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="New terminal"]')
        ?.click();
    });
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-terminal-agent]"),
      ).map((terminal) => terminal.dataset.terminalAgent),
    ).toEqual(["codex", "codex"]);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Terminal options"]')
        ?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerType: "mouse",
          }),
        );
      await Promise.resolve();
    });
    const providerItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Provider"));
    expect(providerItem).toBeDefined();

    await act(async () => {
      providerItem?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const claudeOption = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Claude Code"));
    expect(claudeOption).toBeDefined();

    await act(async () => claudeOption?.click());
    expect(onAgentChange).toHaveBeenCalledWith("claude-code");
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-terminal-agent]"),
      ).map((terminal) => terminal.dataset.terminalAgent),
    ).toEqual(["codex", "claude-code"]);
  });

  it("scopes the active app context to the selected terminal", async () => {
    act(() => {
      root.render(
        <DesktopTerminalSurface
          agent="codex"
          theme="dark"
          activeApp={{ id: "mail", name: "Mail", path: "/inbox" }}
        />,
      );
    });

    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-terminal-test]"),
      ).map((terminal) => [
        terminal.dataset.terminalActive,
        terminal.dataset.terminalApp,
      ]),
    ).toEqual([["true", "mail"]]);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="New terminal"]')
        ?.click();
    });

    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-terminal-test]"),
      ).map((terminal) => [
        terminal.dataset.terminalActive,
        terminal.dataset.terminalApp,
      ]),
    ).toEqual([
      ["false", ""],
      ["true", "mail"],
    ]);
  });
});
