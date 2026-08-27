// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "./ui/tooltip";
import { WorkspaceAppCard } from "./workspace-app-card";

vi.mock("../../../core/dist/client/use-action.js", () => ({
  useActionMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useActionQuery: () => ({
    data: {
      ownerEmail: "owner@example.com",
      orgId: null,
      visibility: "private",
      role: "owner",
      shares: [],
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(async () => undefined),
  }),
}));

vi.mock("../../../core/dist/client/i18n.js", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    String(values?.defaultValue ?? key),
}));

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
  useT: () => (key: string, values?: Record<string, unknown>) =>
    String(values?.defaultValue ?? key),
}));

const frameState = vi.hoisted(() => ({ inBuilderFrame: false }));

vi.mock("@agent-native/core/client/host", () => ({
  isInBuilderFrame: () => frameState.inBuilderFrame,
}));

describe("WorkspaceAppCard", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    frameState.inBuilderFrame = false;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens ready apps inline and keeps new-tab opening in the chevron menu", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <TooltipProvider>
            <WorkspaceAppCard
              app={{
                id: "analytics",
                name: "Analytics",
                path: "/analytics",
                url: "https://analytics.agent-native.com",
                description: "Explore product and growth performance.",
                status: "ready",
              }}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const openButton = container.querySelector<HTMLButtonElement>(
      ".app-open-actions__primary",
    );
    expect(openButton).not.toBeNull();
    expect(openButton?.textContent).toContain("Open app");
    expect(container.querySelector('a[href="/analytics"]')).toBeNull();

    expect(
      container.querySelector(
        'button[aria-label="Open options for Analytics"]',
      ),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("Open in new tab");
    expect(document.body.textContent).not.toContain("Add app");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Open options for Analytics"]',
        )
        ?.dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
        );
    });
    const newTabItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Open in new tab"));
    expect(newTabItem).not.toBeUndefined();
    expect(newTabItem?.getAttribute("href")).toBe("/analytics");
    expect(newTabItem?.getAttribute("target")).toBe("_blank");
    const openMenu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(openMenu?.className).toContain("w-48");
    expect(openMenu?.className).toContain("min-w-max");
    expect(openMenu?.className).toContain("bg-popover");
    expect(openMenu?.className).toContain("shadow-md");
    expect(newTabItem?.querySelector("svg")).not.toBeNull();

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

  it("opens mounted workspace apps at their published URL", async () => {
    frameState.inBuilderFrame = true;
    const originalParent = window.parent;
    const originalTop = window.top;
    const topWindow = { location: { href: "" } } as unknown as Window;
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(window, "top", {
      configurable: true,
      value: topWindow,
    });

    try {
      await act(async () => {
        root.render(
          <MemoryRouter>
            <TooltipProvider>
              <WorkspaceAppCard
                app={{
                  id: "feedback-leaderboard",
                  name: "Feedback leaderboard",
                  path: "/feedback-leaderboard",
                  url: "https://agent-workspace.builder.io/feedback-leaderboard/leaderboard",
                  status: "ready",
                }}
              />
            </TooltipProvider>
          </MemoryRouter>,
        );
      });

      const openButton = container.querySelector<HTMLButtonElement>(
        ".app-open-actions__primary",
      );
      expect(openButton).not.toBeNull();
      expect(openButton?.textContent).toContain("Open app");
      expect(
        container.querySelector(
          'a[href="https://agent-workspace.builder.io/feedback-leaderboard/leaderboard"]',
        ),
      ).toBeNull();

      await act(async () => openButton?.click());
      expect(topWindow.location.href).toBe(
        "https://agent-workspace.builder.io/feedback-leaderboard/leaderboard",
      );
    } finally {
      Object.defineProperty(window, "parent", {
        configurable: true,
        value: originalParent,
      });
      Object.defineProperty(window, "top", {
        configurable: true,
        value: originalTop,
      });
    }
  });

  it("keeps mounted workspace apps inline outside Builder", async () => {
    const originalTop = window.top;
    const topWindow = { location: { href: "" } } as unknown as Window;
    Object.defineProperty(window, "top", {
      configurable: true,
      value: topWindow,
    });

    try {
      await act(async () => {
        root.render(
          <MemoryRouter>
            <TooltipProvider>
              <WorkspaceAppCard
                app={{
                  id: "feedback-leaderboard",
                  name: "Feedback leaderboard",
                  path: "/feedback-leaderboard",
                  url: "https://agent-workspace.builder.io/feedback-leaderboard/leaderboard",
                  status: "ready",
                }}
              />
            </TooltipProvider>
          </MemoryRouter>,
        );
      });

      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(".app-open-actions__primary")
          ?.click(),
      );
      expect(topWindow.location.href).toBe("");
    } finally {
      Object.defineProperty(window, "top", {
        configurable: true,
        value: originalTop,
      });
    }
  });

  it("opens Share from the app settings menu instead of the card actions", async () => {
    const animationFrameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrameCallbacks.push(callback);
      return animationFrameCallbacks.length;
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <TooltipProvider>
              <WorkspaceAppCard
                app={{
                  id: "analytics",
                  name: "Analytics",
                  path: "/analytics",
                  status: "ready",
                }}
              />
            </TooltipProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    expect(container.querySelector('button[aria-label="Share"]')).toBeNull();

    const settingsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Settings for Analytics"]',
    );
    expect(settingsButton).not.toBeNull();

    await act(async () => {
      settingsButton?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });

    const shareItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "Share");
    expect(shareItem).not.toBeUndefined();

    await act(async () => shareItem?.click());

    expect(container.querySelector('button[aria-label="Share"]')).toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(animationFrameCallbacks).toHaveLength(1);

    await act(async () => animationFrameCallbacks.shift()?.(0));

    expect(
      container.querySelector('button[aria-label="Share"]'),
    ).not.toBeNull();
    expect(
      document.body.querySelector("[data-agent-native-share-overlay]"),
    ).not.toBeNull();

    const shareButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Share"]',
    );
    expect(shareButton).not.toBeNull();

    await act(async () => shareButton?.click());
    expect(animationFrameCallbacks).toHaveLength(1);

    await act(async () => animationFrameCallbacks.shift()?.(0));
    expect(document.activeElement).toBe(settingsButton);
  });

  it("keeps pinning in the app open menu", async () => {
    const onTogglePinned = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <TooltipProvider>
            <WorkspaceAppCard
              app={{
                id: "analytics",
                name: "Analytics",
                path: "/analytics",
                status: "ready",
              }}
              isPinned
              onTogglePinned={onTogglePinned}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const optionsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open options for Analytics"]',
    );
    expect(optionsButton).not.toBeNull();

    await act(async () => {
      optionsButton?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });

    const pinItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Unpin this app"));
    expect(pinItem).not.toBeUndefined();

    await act(async () => pinItem?.click());
    expect(onTogglePinned).toHaveBeenCalledOnce();
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
    const settingsMenu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(settingsMenu?.className).toContain("w-48");
    expect(settingsMenu?.className).toContain("bg-popover");
    expect(settingsMenu?.className).toContain("shadow-md");
    expect(document.querySelectorAll('[role="menuitem"] svg').length).toBe(5);

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
                branchName: "pending-branch-id",
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
    expect(container.textContent).toContain("Open in Builder");
    expect(container.textContent).not.toContain("pending-branch-id");
    expect(container.querySelector(".app-open-actions")).toBeNull();
    expect(
      container.querySelector('button[aria-label="Open options for New app"]'),
    ).toBeNull();
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
    const renderedLabels = Array.from(
      document.querySelectorAll("span"),
      (span) => span.textContent,
    );
    expect(renderedLabels).not.toContain("agents.dashboardMetadataCreated");
    expect(renderedLabels).not.toContain("agents.notTracked");
  });

  it("hides metadata rows without tracked values", async () => {
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
                createdBy: "Not tracked",
                teams: ["Not tracked"],
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

    const renderedLabels = Array.from(
      document.querySelectorAll("span"),
      (span) => span.textContent,
    );
    expect(renderedLabels).not.toContain("agents.notTracked");
    expect(renderedLabels).not.toContain("agents.dashboardMetadataCreated");
    expect(renderedLabels).not.toContain("dispatch.pages.appMetadataOwner");
    expect(renderedLabels).not.toContain("dispatch.pages.appMetadataTeams");
  });
});
