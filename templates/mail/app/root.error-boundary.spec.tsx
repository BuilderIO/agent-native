// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const recovery = vi.hoisted(() => ({ reloads: false }));

vi.mock(
  "@agent-native/core/client/route-chunk-recovery",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/client/route-chunk-recovery")
    >()),
    recoverFromStaleChunkError: vi.fn(() => recovery.reloads),
  }),
);

import { ErrorBoundary } from "./root";

function renderRouteError(error: Error) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        Component: () => {
          throw error;
        },
        ErrorBoundary,
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("Mail ErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("offers Reload when a stale file could not be recovered automatically", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      reload,
    });
    recovery.reloads = false;

    renderRouteError(new TypeError("Importing a module script failed."));

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps showing Mail's loading shell while the automatic reload runs", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    recovery.reloads = true;

    renderRouteError(new TypeError("Importing a module script failed."));

    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });
});
