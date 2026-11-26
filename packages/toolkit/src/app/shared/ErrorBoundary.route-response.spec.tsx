// @vitest-environment jsdom

import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/analytics", () => ({
  captureException: vi.fn(),
}));
vi.mock("../feedback/FeedbackButton.js", () => ({
  FeedbackButton: ({ initialValue }: { initialValue: string }) => (
    <button data-report={initialValue}>Send feedback</button>
  ),
}));

import { captureException } from "@agent-native/core/client/analytics";

import { ErrorBoundary } from "./ErrorBoundary.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps custom route status text out of generic UI and reports but retains diagnostics", async () => {
  const statusText = "Synthetic internal service failure";
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const router = createMemoryRouter([
    {
      path: "/",
      loader: () => {
        throw new Response("Failed", { status: 503, statusText });
      },
      element: <div>Home</div>,
      errorElement: <ErrorBoundary genericErrors />,
      hydrateFallbackElement: <div>Preparing</div>,
    },
  ]);
  render(<RouterProvider router={router} />);

  expect(await screen.findByText("503 Error")).toBeTruthy();
  expect(screen.getByText("An unexpected error occurred.")).toBeTruthy();
  expect(screen.queryByText(statusText)).toBeNull();
  expect(
    decodeURIComponent(
      screen.getByRole("link", { name: /github/i }).getAttribute("href") ?? "",
    ),
  ).not.toContain(statusText);
  expect(screen.getByRole("button").getAttribute("data-report")).not.toContain(
    statusText,
  );
  await waitFor(() =>
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ status: 503, statusText }),
      expect.anything(),
    ),
  );
  expect(consoleError).toHaveBeenCalledWith(
    "[ErrorBoundary]",
    expect.objectContaining({ status: 503, statusText }),
  );
});
