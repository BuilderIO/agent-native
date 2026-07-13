// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "./ui/tooltip";
import { WorkspaceAppCard } from "./workspace-app-card";

vi.mock("@agent-native/core/client", () => ({
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useActionQuery: () => ({
    data: { resources: [], counts: {} },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
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

  it("uses one visible, consistent action treatment for context, keys, and more", async () => {
    await act(async () => {
      root.render(
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
        </TooltipProvider>,
      );
    });

    const appLink = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="Open Analytics"]',
    );
    expect(appLink?.getAttribute("href")).toBe("/analytics");
    expect(appLink?.getAttribute("target")).toBeNull();
    expect(appLink?.getAttribute("rel")).toBeNull();
    expect(appLink?.className).toContain("focus-visible:ring-2");

    const actions = [
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="View context resources for Analytics"]',
      ),
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Manage keys for Analytics"]',
      ),
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="More actions for Analytics"]',
      ),
    ];

    for (const action of actions) {
      expect(action).not.toBeNull();
      expect(action?.className).toContain("size-7");
      expect(action?.className).toContain("text-muted-foreground");
      expect(action?.className).toContain(
        "transition-[background-color,color]",
      );
      expect(action?.className).not.toContain("opacity-0");
    }
  });

  it("opens pending Builder apps in a new tab", async () => {
    await act(async () => {
      root.render(
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
        </TooltipProvider>,
      );
    });

    const appLink = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="Open New app"]',
    );
    expect(appLink?.getAttribute("href")).toBe(
      "https://builder.example.com/projects/new-app",
    );
    expect(appLink?.getAttribute("target")).toBe("_blank");
    expect(appLink?.getAttribute("rel")).toBe("noreferrer");
  });
});
