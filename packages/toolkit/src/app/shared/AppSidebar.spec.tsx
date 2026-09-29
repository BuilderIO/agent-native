// @vitest-environment happy-dom

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSidebar, RouterSidebarLink } from "./AppSidebar.js";

function CurrentPath() {
  const { pathname } = useLocation();
  return <span data-testid="current-path">{pathname}</span>;
}

vi.mock("../feedback/FeedbackButton.js", () => ({
  FeedbackButton: () => null,
}));

describe("AppSidebar (router links)", () => {
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

  it("opens a tooltip for every icon on the collapsed rail", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <AppSidebar
            collapsed
            showBadge={false}
            brandName="Slides"
            items={[{ label: "Decks", to: "/home" }]}
            secondaryItems={[{ label: "Settings", to: "/settings" }]}
          />
        </MemoryRouter>,
      );
    });

    const rail = Array.from(
      container.querySelectorAll<HTMLElement>("aside a, aside button"),
    );
    expect(rail.map((element) => element.getAttribute("aria-label"))).toEqual([
      "Slides",
      "Decks",
      "Settings",
      "Expand sidebar",
    ]);

    for (const element of rail) {
      act(() => element.focus());
      const labels = Array.from(
        document.querySelectorAll('[role="tooltip"]'),
      ).map((node) => node.textContent);
      expect(labels).toContain(element.getAttribute("aria-label"));
      act(() => element.blur());
    }
  });

  it("keeps rail and settings-gear tooltip links mounted across rerenders", () => {
    const renderLinks = (revision: number) => (
      <MemoryRouter>
        <TooltipProvider>
          <CurrentPath />
          <Tooltip>
            <TooltipTrigger asChild>
              <RouterSidebarLink
                to="/inbox"
                aria-label="Inbox"
                data-testid="rail-link"
                data-revision={revision}
              >
                Inbox
              </RouterSidebarLink>
            </TooltipTrigger>
            <TooltipContent>Inbox</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <RouterSidebarLink
                to="/settings"
                aria-label="Settings"
                data-testid="settings-gear-link"
                data-revision={revision}
              >
                Settings
              </RouterSidebarLink>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </MemoryRouter>
    );

    act(() => root.render(renderLinks(1)));
    const railLink = container.querySelector('[data-testid="rail-link"]');
    const settingsGearLink = container.querySelector(
      '[data-testid="settings-gear-link"]',
    );

    expect(railLink).not.toBeNull();
    expect(settingsGearLink).not.toBeNull();

    act(() => root.render(renderLinks(2)));

    expect(container.querySelector('[data-testid="rail-link"]')).toBe(railLink);
    expect(container.querySelector('[data-testid="settings-gear-link"]')).toBe(
      settingsGearLink,
    );
    expect(railLink?.getAttribute("data-revision")).toBe("2");
    expect(settingsGearLink?.getAttribute("data-revision")).toBe("2");

    act(() => (settingsGearLink as HTMLAnchorElement).click());
    expect(
      container.querySelector('[data-testid="current-path"]')?.textContent,
    ).toBe("/settings");
  });
});
