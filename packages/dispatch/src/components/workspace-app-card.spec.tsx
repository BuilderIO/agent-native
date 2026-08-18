// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "./ui/tooltip";
import { WorkspaceAppCard } from "./workspace-app-card";

const clientState = vi.hoisted(() => ({ inBuilderFrame: false }));

vi.mock("@agent-native/core/client", () => ({
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useActionQuery: () => ({
    data: { resources: [], counts: {} },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  isInBuilderFrame: () => clientState.inBuilderFrame,
}));

describe("WorkspaceAppCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clientState.inBuilderFrame = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: window,
    });
    Object.defineProperty(window, "top", {
      configurable: true,
      value: window,
    });
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

    expect(
      container.querySelector('a[aria-label="Open Analytics"]')?.className,
    ).toContain("focus-visible:ring-2");

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

  it("navigates the top window when the card is rendered inside an iframe", async () => {
    const topWindow = { location: { href: "" } } as unknown as Window;
    const expectedUrl = new URL("/analytics", window.location.href).href;
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(window, "top", {
      configurable: true,
      value: topWindow,
    });

    await act(async () => {
      root.render(
        <TooltipProvider>
          <WorkspaceAppCard
            app={{
              id: "analytics",
              name: "Analytics",
              path: "/analytics",
              status: "ready",
            }}
          />
        </TooltipProvider>,
      );
    });

    const link = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="Open Analytics"]',
    );
    expect(link).not.toBeNull();

    await act(async () => {
      link?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(topWindow.location.href).toBe(expectedUrl);
  });

  it("uses the top window for Builder webviews even without a parent iframe", async () => {
    const topWindow = { location: { href: "" } } as unknown as Window;
    const expectedUrl = new URL("/analytics", window.location.href).href;
    clientState.inBuilderFrame = true;
    Object.defineProperty(window, "top", {
      configurable: true,
      value: topWindow,
    });

    await act(async () => {
      root.render(
        <TooltipProvider>
          <WorkspaceAppCard
            app={{
              id: "analytics",
              name: "Analytics",
              path: "/analytics",
              status: "ready",
            }}
          />
        </TooltipProvider>,
      );
    });

    const link = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="Open Analytics"]',
    );
    await act(async () => {
      link?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(topWindow.location.href).toBe(expectedUrl);
  });
});
