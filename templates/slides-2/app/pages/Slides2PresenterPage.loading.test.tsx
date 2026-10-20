// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emptyDeck: false,
  renderQuery: {
    data: undefined as unknown,
    error: undefined as unknown,
    isError: false,
    isLoading: false,
  },
  sandboxOnError: null as ((message: string) => void) | null,
  onNext: null as (() => void) | null,
  onPrevious: null as (() => void) | null,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
  getBrowserTabId: () => "presenter-loading-test",
  useActionQuery: (action: string, input?: { slideId?: string }) => {
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
          slides: mocks.emptyDeck
            ? []
            : [
                { id: "slide-1", slideNumber: 1 },
                { id: "slide-2", slideNumber: 2 },
              ],
        });
      case "get-slide-source":
        return result({
          slide: {
            id: input?.slideId ?? "slide-1",
            revision: 3,
            sourceHash: "source-hash",
          },
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
  useT: () => (key: string, values?: { index?: number; total?: number }) =>
    key === "slides2Presenter.position"
      ? `${values?.index} / ${values?.total}`
      : key,
}));

vi.mock("@/components/slides-2-presenter/presenter-channel", () => ({
  clampPresenterIndex: (index: number, total: number) =>
    total > 0 ? Math.max(0, Math.min(total - 1, index)) : 0,
  useSlides2PresenterChannel: () => ({
    available: false,
    send: () => false,
  }),
}));

vi.mock("@/components/slides-2-presenter/Slides2Player", () => ({
  default: ({
    children,
    onNext,
    onPrevious,
  }: {
    children:
      | React.ReactNode
      | ((props: { onNavigationInput: () => void }) => React.ReactNode);
    onNext: () => void;
    onPrevious: () => void;
  }) => {
    mocks.onNext = onNext;
    mocks.onPrevious = onPrevious;
    return typeof children === "function"
      ? children({ onNavigationInput: () => {} })
      : children;
  },
}));

vi.mock("@/components/slides-2-runtime/SandboxedSlide", async () => {
  const { createElement } = await import("react");
  return {
    renderSlideArtifactInSandbox: vi.fn(),
    SandboxedSlide: ({ onError }: { onError?: (message: string) => void }) => {
      mocks.sandboxOnError = onError ?? null;
      return createElement("div");
    },
  };
});

vi.mock("@/pages/Slides2PresenterConsolePage", () => ({
  default: () => null,
}));

import Slides2PresenterPage from "./Slides2PresenterPage";

afterEach(cleanup);

beforeEach(() => {
  mocks.emptyDeck = false;
  mocks.renderQuery = {
    data: undefined,
    error: undefined,
    isError: false,
    isLoading: false,
  };
  mocks.sandboxOnError = null;
  mocks.onNext = null;
  mocks.onPrevious = null;
});

function renderProjection(slide = 1) {
  const router = createMemoryRouter(
    [{ path: "/deck/:id/present", element: <Slides2PresenterPage /> }],
    { initialEntries: [`/deck/deck-1/present?slide=${slide}`] },
  );

  return { ...render(<RouterProvider router={router} />), router };
}

describe("Slides2PresenterPage loading", () => {
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

  it("advances to the next slide while the current slide steps are loading", async () => {
    mocks.renderQuery.isLoading = true;
    const { router } = renderProjection();

    act(() => mocks.onNext?.());

    await waitFor(() => expect(router.state.location.search).toBe("?slide=2"));
  });

  it("returns to the previous slide while the current slide steps are loading", async () => {
    mocks.renderQuery.isLoading = true;
    const { router } = renderProjection(2);

    act(() => mocks.onPrevious?.());

    await waitFor(() => expect(router.state.location.search).toBe("?slide=1"));
  });

  it("announces slide changes while the slide render is loading", async () => {
    mocks.renderQuery.isLoading = true;
    renderProjection();

    expect(screen.getByRole("status").textContent).toBe("1 / 2");
    act(() => mocks.onNext?.());

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("2 / 2"),
    );
  });

  it("exposes the empty-deck message as a status", () => {
    mocks.emptyDeck = true;

    renderProjection();

    expect(screen.getByRole("status").textContent).toBe(
      "presentation.noSlides",
    );
  });
});
