// @vitest-environment happy-dom

import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renderQuery: {
    data: undefined as unknown,
    error: undefined as unknown,
    isError: false,
    isLoading: false,
  },
  sandboxOnError: null as ((message: string) => void) | null,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
  getBrowserTabId: () => "presenter-loading-test",
  useActionQuery: (action: string) => {
    const result = (data: unknown) => ({
      data,
      error: undefined,
      isError: false,
      isLoading: false,
    });

    switch (action) {
      case "get-deck":
        return result({
          id: "deck-1",
          title: "Deck",
          slides: [{ id: "slide-1", slideNumber: 1 }],
        });
      case "get-slide-source":
        return result({
          slide: { id: "slide-1", revision: 3, sourceHash: "source-hash" },
        });
      case "get-slide-render":
        return mocks.renderQuery;
      default:
        throw new Error(`Unexpected presenter query: ${action}`);
    }
  },
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  writeClientAppState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/open-slide-presenter/presenter-channel", () => ({
  clampPresenterIndex: (index: number, total: number) =>
    total > 0 ? Math.max(0, Math.min(total - 1, index)) : 0,
  useOpenSlidePresenterChannel: () => ({
    available: false,
    send: () => false,
  }),
}));

vi.mock("@/components/open-slide-presenter/OpenSlidePlayer", () => ({
  default: ({
    children,
  }: {
    children:
      | React.ReactNode
      | ((props: { onNavigationInput: () => void }) => React.ReactNode);
  }) =>
    typeof children === "function"
      ? children({ onNavigationInput: () => {} })
      : children,
}));

vi.mock("@/components/open-slide-runtime/SandboxedSlide", async () => {
  const { createElement } = await import("react");
  return {
    renderSlideArtifactInSandbox: vi.fn(),
    SandboxedSlide: ({ onError }: { onError?: (message: string) => void }) => {
      mocks.sandboxOnError = onError ?? null;
      return createElement("div");
    },
  };
});

vi.mock("@/pages/OpenSlidePresenterConsolePage", () => ({
  default: () => null,
}));

import OpenSlidePresenterPage from "./OpenSlidePresenterPage";

afterEach(cleanup);

beforeEach(() => {
  mocks.renderQuery = {
    data: undefined,
    error: undefined,
    isError: false,
    isLoading: false,
  };
  mocks.sandboxOnError = null;
});

function renderProjection() {
  const router = createMemoryRouter(
    [{ path: "/deck/:id/present", element: <OpenSlidePresenterPage /> }],
    { initialEntries: ["/deck/deck-1/present?slide=1"] },
  );

  return render(<RouterProvider router={router} />);
}

describe("OpenSlidePresenterPage loading", () => {
  it("keeps the projection loading while its render artifact is pending", () => {
    mocks.renderQuery.isLoading = true;

    const { container } = renderProjection();

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("presentation.loadFailed")).toBeNull();
  });

  it("shows the load failure after rendering settles without an artifact", () => {
    renderProjection();

    expect(screen.getByText("presentation.loadFailed")).toBeTruthy();
  });

  it("shows a render error after the action fails", () => {
    mocks.renderQuery.error = new Error("render failed");
    mocks.renderQuery.isError = true;

    renderProjection();

    expect(screen.getByText("render failed")).toBeTruthy();
    expect(screen.queryByText("presentation.loadFailed")).toBeNull();
  });

  it("shows a Worker render error after the artifact loads", () => {
    mocks.renderQuery.data = {
      deckId: "deck-1",
      slideId: "slide-1",
      revision: 3,
      sourceHash: "source-hash",
    };

    renderProjection();

    const sandboxOnError = mocks.sandboxOnError;
    expect(sandboxOnError).toBeTypeOf("function");
    act(() => sandboxOnError?.("sandbox render failed"));

    expect(screen.getByRole("alert").textContent).toBe("sandbox render failed");
  });
});
