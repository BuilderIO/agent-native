// @vitest-environment jsdom

import { LOCALE_STORAGE_KEY } from "@agent-native/core/localization/shared";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/analytics", () => ({
  captureException: vi.fn(),
}));
vi.mock("../feedback/FeedbackButton.js", () => ({
  FeedbackButton: ({ initialValue }: { initialValue: string }) => (
    <button data-report={initialValue}>Send feedback</button>
  ),
}));
vi.mock(
  "@agent-native/core/client/route-chunk-recovery",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/client/route-chunk-recovery")
    >()),
    recoverFromStaleChunkError: vi.fn(),
  }),
);

import { captureException } from "@agent-native/core/client/analytics";
import { recoverFromStaleChunkError } from "@agent-native/core/client/route-chunk-recovery";

import {
  ErrorBoundary,
  isExpectedRouteNotFound,
  resolveErrorBoundaryThemeClass,
} from "./ErrorBoundary.js";

describe("rendered error boundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(captureException).mockClear();
    vi.mocked(recoverFromStaleChunkError).mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function renderError(error: unknown, genericErrors = true) {
    const router = createMemoryRouter([
      {
        path: "/",
        loader: () => {
          throw error;
        },
        element: <div>Home</div>,
        errorElement: genericErrors ? (
          <ErrorBoundary genericErrors />
        ) : (
          <ErrorBoundary />
        ),
        hydrateFallbackElement: <div>Preparing</div>,
      },
    ]);
    render(<RouterProvider router={router} />);
    return router;
  }

  function expectNoErrorInReports(message: string) {
    const link = screen.getByRole("link", { name: /github/i });
    expect(decodeURIComponent(link.getAttribute("href") ?? "")).not.toContain(
      message,
    );
    expect(
      screen.getByRole("button").getAttribute("data-report"),
    ).not.toContain(message);
  }

  it("shows generic details while retaining the original error and development stack", async () => {
    const error = new TypeError(
      "Cannot read properties of undefined (reading 'example')",
    );
    renderError(error);
    await screen.findByText("Something went wrong");
    expect(screen.getByText("An unexpected error occurred.")).toBeTruthy();
    expect(screen.queryByText(error.message)).toBeNull();
    expectNoErrorInReports(error.message);
    expect(document.querySelector("pre")?.textContent).toContain(error.stack);
    expect(consoleError).toHaveBeenCalledWith("[ErrorBoundary]", error);
    await waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(error, expect.anything()),
    );
  });

  it("keeps thrown string details out of the screen and feedback", async () => {
    const error = "Synthetic internal string failure";
    renderError(error);
    await screen.findByText("An unexpected error occurred.");
    expect(screen.queryByText(error)).toBeNull();
    expectNoErrorInReports(error);
    await waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(error, expect.anything()),
    );
  });

  it("preserves 404 details without reporting an expected not-found error", async () => {
    renderError(
      new Response("Missing", { status: 404, statusText: "Not Found" }),
    );
    await screen.findByText("Page not found");
    expect(screen.getByText("We couldn't find this page.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /github/i })).toBeNull();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("preserves non-404 route response status and status text", async () => {
    renderError(
      new Response("Failed", {
        status: 503,
        statusText: "Service Unavailable",
      }),
      false,
    );
    expect(await screen.findByText("503 Error")).toBeTruthy();
    expect(screen.getByText("Service Unavailable")).toBeTruthy();
  });

  it("keeps the default shared behavior", async () => {
    const error = new TypeError("Synthetic default failure");
    renderError(error, false);
    expect(await screen.findByText(error.message)).toBeTruthy();
    await waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(error, expect.anything()),
    );
  });

  it("uses the selected locale for generic details", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "es-ES");
    renderError(new Error("Synthetic translated failure"));
    expect(
      await screen.findByText("Se produjo un error inesperado."),
    ).toBeTruthy();
    expect(screen.getByText("Algo salió mal")).toBeTruthy();
  });

  it("retains stale chunk recovery before reporting", async () => {
    const error = new TypeError(
      "Failed to fetch dynamically imported module: https://example.test/chunk.js",
    );
    vi.mocked(recoverFromStaleChunkError).mockReturnValue(true);
    renderError(error);
    expect(
      await screen.findByText("Loading the latest version..."),
    ).toBeTruthy();
    await waitFor(() =>
      expect(recoverFromStaleChunkError).toHaveBeenCalledWith(error),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports a stale chunk error if recovery is exhausted", async () => {
    const error = new TypeError(
      "Failed to fetch dynamically imported module: https://example.test/chunk.js",
    );
    vi.mocked(recoverFromStaleChunkError).mockReturnValue(false);
    renderError(error);
    expect(
      await screen.findByText("An unexpected error occurred."),
    ).toBeTruthy();
    expectNoErrorInReports(error.message);
    await waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(error, expect.anything()),
    );
  });
});

function themeRoot(className: string, dataTheme: string | null) {
  return {
    classList: {
      contains: (name: string) => className.split(" ").includes(name),
    },
    getAttribute: () => dataTheme,
  } as unknown as Pick<HTMLElement, "classList" | "getAttribute">;
}

describe("isExpectedRouteNotFound", () => {
  it("recognizes React Router 404 responses", () => {
    expect(
      isExpectedRouteNotFound({
        data: "missing",
        internal: true,
        status: 404,
        statusText: "Not Found",
      }),
    ).toBe(true);
  });

  it("keeps application errors reportable", () => {
    expect(isExpectedRouteNotFound(new Error("render failed"))).toBe(false);
    expect(
      isExpectedRouteNotFound({
        data: "failed",
        internal: true,
        status: 500,
        statusText: "Server Error",
      }),
    ).toBe(false);
  });
});

describe("resolveErrorBoundaryThemeClass", () => {
  it("honors an explicit data theme before storage or the system preference", () => {
    const readStoredTheme = vi.fn(() => "dark");
    const readSystemTheme = vi.fn(() => true);

    expect(
      resolveErrorBoundaryThemeClass(
        themeRoot("", "light"),
        readStoredTheme,
        readSystemTheme,
      ),
    ).toBe("light");
    expect(readStoredTheme).not.toHaveBeenCalled();
    expect(readSystemTheme).not.toHaveBeenCalled();
  });

  it("uses the system theme only when no explicit theme is selected", () => {
    const readStoredTheme = vi.fn(() => null);
    const readSystemTheme = vi.fn(() => true);

    expect(
      resolveErrorBoundaryThemeClass(
        themeRoot("", null),
        readStoredTheme,
        readSystemTheme,
      ),
    ).toBe("dark");
    expect(readSystemTheme).toHaveBeenCalledOnce();
  });
});
