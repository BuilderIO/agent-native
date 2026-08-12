// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "./ui/tooltip";
import { WorkspaceAppCard } from "./workspace-app-card";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useActionQuery: () => ({
    data: { resources: [], counts: {} },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: (value: string) => value,
  }),
  useT: () => (key: string) => key,
}));

describe("WorkspaceAppCard", () => {
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

  it("uses one explicit open action and one settings control", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <TooltipProvider>
            <WorkspaceAppCard
              app={{
                id: "analytics",
                name: "Analytics",
                path: "/analytics",
                description: "Explore product and growth performance.",
                status: "ready",
              }}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const appLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/analytics"]',
    );
    expect(appLink).not.toBeNull();
    expect(appLink?.textContent).toContain("Open app");
    expect(appLink?.getAttribute("target")).toBe("_blank");
    expect(appLink?.getAttribute("rel")).toBe("noreferrer");
    expect(appLink?.querySelector("svg")).toBeNull();

    expect(
      container.querySelector(
        'button[aria-label="Open options for Analytics"]',
      ),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("Open in new tab");
    expect(document.body.textContent).not.toContain("Add app");

    const settingsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Settings for Analytics"]',
    );
    expect(settingsButton).not.toBeNull();
    expect(settingsButton?.className).toContain("size-7");
    expect(
      container.querySelector(
        'button[aria-label="More actions for Analytics"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="View agent resources for Analytics"]',
      ),
    ).toBeNull();
  });

  it("labels per-app context as agent resources while preserving workspace scope", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <TooltipProvider>
            <WorkspaceAppCard
              app={{
                id: "analytics",
                name: "Analytics",
                path: "/analytics",
                description: "Explore product and growth performance.",
                status: "ready",
              }}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const settingsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Settings for Analytics"]',
    );

    await act(async () => {
      settingsButton?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const resourcesItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Agent resources"));
    expect(resourcesItem).not.toBeUndefined();

    await act(async () => resourcesItem?.click());

    expect(document.body.textContent).toContain("Analytics agent resources");
    expect(document.body.textContent).toContain(
      "Workspace-scope agent resources are inherited at runtime.",
    );
    expect(document.body.textContent).toContain(
      "All-app agent resources live once at workspace scope",
    );
  });

  it("opens pending Builder apps in a new tab", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <TooltipProvider>
            <WorkspaceAppCard
              app={{
                id: "new-app",
                name: "New app",
                path: "/new-app",
                builderUrl: "https://builder.example.com/projects/new-app",
                status: "pending",
              }}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const appLink = container.querySelector<HTMLAnchorElement>(
      'a[href="https://builder.example.com/projects/new-app"]',
    );
    expect(appLink).not.toBeNull();
    expect(appLink?.getAttribute("href")).toBe(
      "https://builder.example.com/projects/new-app",
    );
    expect(appLink?.getAttribute("target")).toBe("_blank");
    expect(appLink?.getAttribute("rel")).toBe("noreferrer");
  });

  it("shows ownership metadata in the settings menu", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <TooltipProvider>
            <WorkspaceAppCard
              app={{
                id: "analytics",
                name: "Analytics",
                path: "/analytics",
                createdAt: "2026-07-28T12:00:00.000Z",
                createdBy: "creator@example.com",
                owner: "owner@example.com",
                teams: ["Growth", "Operations"],
                status: "ready",
              }}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const settingsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Settings for Analytics"]',
    );
    expect(settingsButton).not.toBeNull();

    await act(async () => {
      settingsButton?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });

    expect(document.body.textContent).toContain("creator@example.com");
    expect(document.body.textContent).toContain("owner@example.com");
    expect(document.body.textContent).toContain("Growth, Operations");
  });
});
