// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ROUTE_TRANSITION_INDICATOR_DELAY_MS,
  RouteTransitionIndicator,
} from "./RouteTransitionIndicator.js";

function Shell() {
  return (
    <>
      <RouteTransitionIndicator />
      <Outlet />
    </>
  );
}

describe("RouteTransitionIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("shows the pending destination when lazy route loading is slow", async () => {
    let resolveLoader!: () => void;
    const loader = new Promise<void>((resolve) => {
      resolveLoader = resolve;
    });
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <Shell />,
          children: [
            { index: true, element: <div>Home</div> },
            {
              path: "slow",
              loader: () => loader,
              element: <div>Slow route</div>,
            },
          ],
        },
      ],
      { initialEntries: ["/"] },
    );

    act(() => {
      root.render(<RouterProvider router={router} />);
    });

    act(() => {
      void router.navigate("/slow");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-route-transition-indicator="true"]'),
    ).toBeNull();

    act(() => {
      vi.advanceTimersByTime(ROUTE_TRANSITION_INDICATOR_DELAY_MS);
    });

    const indicator = container.querySelector(
      '[data-route-transition-indicator="true"]',
    );
    expect(indicator?.getAttribute("data-route-transition-target")).toBe(
      "/slow",
    );
    expect(indicator?.textContent).toContain("/slow");

    act(() => {
      resolveLoader();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-route-transition-indicator="true"]'),
    ).toBeNull();
  });
});
