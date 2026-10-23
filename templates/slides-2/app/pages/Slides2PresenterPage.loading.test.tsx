// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  FrameKeyboard,
  SlideFrameController,
} from "@/components/slides-2-runtime/SandboxedSlide";

const mocks = vi.hoisted(() => ({
  emptyDeck: false,
  skippedSlides: false,
  buildStepDeck: false,
  renderQuery: {
    data: undefined as unknown,
    error: undefined as unknown,
    isError: false,
    isLoading: false,
  },
  sandboxOnError: null as ((message: string) => void) | null,
  sandboxOnKeyboard: null as ((keyboard: FrameKeyboard) => void) | null,
  sandboxOnStepCount: null as ((stepCount: number) => void) | null,
  sandboxOnReady: null as (() => void) | null,
  sandboxOnController: null as
    | ((controller: SlideFrameController | null) => void)
    | null,
  sandboxInitialRevealedSteps: undefined as number | null | undefined,
  renderSlideArtifactInSandbox: vi.fn(),
  playerOnFrameKeyboard: vi.fn(),
  onNext: null as (() => void) | null,
  onPrevious: null as (() => void) | null,
  onPresenterMessage: null as ((message: any) => void) | null,
  presenterSend: vi.fn(() => false),
  sourceSlideIds: [] as string[],
  playerState: null as { index: number; total: number } | null,
  playerBlackout: null as string | null,
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
            : mocks.buildStepDeck
              ? [
                  { id: "slide-1", slideNumber: 1 },
                  { id: "slide-2", slideNumber: 2 },
                  { id: "slide-3", slideNumber: 3 },
                ]
              : mocks.skippedSlides
                ? [
                    { id: "slide-1", slideNumber: 1, skipped: false },
                    { id: "slide-2", slideNumber: 2, skipped: true },
                    { id: "slide-3", slideNumber: 3, skipped: false },
                  ]
                : [
                    { id: "slide-1", slideNumber: 1 },
                    { id: "slide-2", slideNumber: 2 },
                  ],
        });
      case "get-slide-source":
        mocks.sourceSlideIds.push(input?.slideId ?? "");
        return result({
          slide: {
            id: input?.slideId ?? "slide-1",
            revision: 3,
            sourceHash: "source-hash",
          },
        });
      case "get-slide-render": {
        const data = mocks.renderQuery.data;
        return {
          ...mocks.renderQuery,
          data:
            data && typeof data === "object" && input?.slideId
              ? { ...(data as Record<string, unknown>), slideId: input.slideId }
              : data,
        };
      }
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
  useSlides2PresenterChannel: (
    _deckId: string,
    onMessage: (message: unknown) => void,
  ) => {
    mocks.onPresenterMessage = onMessage;
    return { available: false, send: mocks.presenterSend };
  },
}));

vi.mock("@/components/slides-2-presenter/Slides2Player", () => ({
  default: ({
    children,
    index,
    total,
    onNext,
    onPrevious,
    blackout,
    onPresentationStateChange,
  }: {
    children:
      | React.ReactNode
      | ((props: {
          onFrameKeyboard: (keyboard: FrameKeyboard) => void;
          onNavigationInput: () => void;
        }) => React.ReactNode);
    index: number;
    total: number;
    onNext: () => void;
    onPrevious: () => void;
    blackout: string | null;
    onPresentationStateChange?: (state: {
      index: number;
      total: number;
      blackout: string | null;
      startedAt: number;
    }) => void;
  }) => {
    mocks.playerState = { index, total };
    mocks.playerBlackout = blackout;
    mocks.onNext = onNext;
    mocks.onPrevious = onPrevious;
    React.useEffect(() => {
      onPresentationStateChange?.({
        index,
        total,
        blackout,
        startedAt: Date.now(),
      });
    }, [blackout, index, onPresentationStateChange, total]);
    return typeof children === "function"
      ? children({
          onFrameKeyboard: mocks.playerOnFrameKeyboard,
          onNavigationInput: () => {},
        })
      : children;
  },
}));

vi.mock("@/components/slides-2-runtime/SandboxedSlide", async () => {
  const { createElement } = await import("react");
  return {
    renderSlideArtifactInSandbox: mocks.renderSlideArtifactInSandbox,
    SandboxedSlide: ({
      onError,
      onKeyboard,
      onStepCount,
      onReady,
      onController,
      initialRevealedSteps,
    }: {
      onError?: (message: string) => void;
      onKeyboard?: (keyboard: FrameKeyboard) => void;
      onStepCount?: (stepCount: number) => void;
      onReady?: () => void;
      onController?: (controller: SlideFrameController | null) => void;
      initialRevealedSteps?: number | null;
    }) => {
      mocks.sandboxOnError = onError ?? null;
      mocks.sandboxOnKeyboard = onKeyboard ?? null;
      mocks.sandboxOnStepCount = onStepCount ?? null;
      mocks.sandboxOnReady = onReady ?? null;
      mocks.sandboxOnController = onController ?? null;
      mocks.sandboxInitialRevealedSteps = initialRevealedSteps;
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
  mocks.skippedSlides = false;
  mocks.buildStepDeck = false;
  mocks.renderQuery = {
    data: undefined,
    error: undefined,
    isError: false,
    isLoading: false,
  };
  mocks.sandboxOnError = null;
  mocks.sandboxOnKeyboard = null;
  mocks.sandboxOnStepCount = null;
  mocks.sandboxOnReady = null;
  mocks.sandboxOnController = null;
  mocks.sandboxInitialRevealedSteps = undefined;
  mocks.renderSlideArtifactInSandbox.mockReset();
  mocks.playerOnFrameKeyboard.mockClear();
  mocks.onNext = null;
  mocks.onPrevious = null;
  mocks.onPresenterMessage = null;
  mocks.presenterSend.mockClear();
  mocks.sourceSlideIds = [];
  mocks.playerState = null;
  mocks.playerBlackout = null;
});

function renderProjection(slide = 1) {
  const router = createMemoryRouter(
    [{ path: "/deck/:id/present", element: <Slides2PresenterPage /> }],
    { initialEntries: [`/deck/deck-1/present?slide=${slide}`] },
  );

  return { ...render(<RouterProvider router={router} />), router };
}

describe("Slides2PresenterPage loading", () => {
  it("forwards slide frame keyboard messages to the presenter controls", () => {
    mocks.renderQuery.data = {
      deckId: "deck-1",
      slideId: "slide-1",
      revision: 3,
      sourceHash: "source-hash",
    };
    renderProjection();

    const keyboard = {
      key: "ArrowRight",
      keyCode: 39,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isTypingTarget: false,
      isControlTarget: false,
      isComposing: false,
    };
    expect(mocks.sandboxOnKeyboard).toBeTypeOf("function");
    act(() => mocks.sandboxOnKeyboard?.(keyboard));

    expect(mocks.playerOnFrameKeyboard).toHaveBeenCalledWith(keyboard);
  });

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

  it("reveals build steps before advancing and returns to the previous slide fully revealed", async () => {
    mocks.buildStepDeck = true;
    mocks.renderQuery.data = {
      deckId: "deck-1",
      slideId: "slide-1",
      revision: 3,
      sourceHash: "source-hash",
    };
    mocks.renderSlideArtifactInSandbox.mockResolvedValue({} as never);
    const { router } = renderProjection();

    act(() => mocks.onNext?.());
    await waitFor(() => expect(router.state.location.search).toBe("?slide=2"));
    await waitFor(() =>
      expect(mocks.sandboxOnStepCount).toBeTypeOf("function"),
    );
    expect(mocks.sandboxInitialRevealedSteps).toBe(0);

    const frameSend = vi.fn();
    act(() => {
      mocks.sandboxOnController?.({ send: frameSend });
      mocks.sandboxOnStepCount?.(2);
      mocks.sandboxOnReady?.();
    });
    await waitFor(() =>
      expect(mocks.presenterSend).toHaveBeenLastCalledWith({
        type: "state",
        state: expect.objectContaining({
          index: 1,
          total: 3,
          stepIndex: 0,
          stepCount: 2,
        }),
      }),
    );

    act(() => mocks.onNext?.());
    await waitFor(() =>
      expect(frameSend).toHaveBeenLastCalledWith({
        type: "set-revealed-steps",
        revealedSteps: 1,
      }),
    );
    expect(router.state.location.search).toBe("?slide=2");

    act(() => mocks.onNext?.());
    await waitFor(() =>
      expect(frameSend).toHaveBeenLastCalledWith({
        type: "set-revealed-steps",
        revealedSteps: 2,
      }),
    );
    expect(router.state.location.search).toBe("?slide=2");

    act(() => mocks.onNext?.());
    await waitFor(() => expect(router.state.location.search).toBe("?slide=3"));

    act(() => mocks.onPrevious?.());
    await waitFor(() => expect(router.state.location.search).toBe("?slide=2"));
    await waitFor(() => expect(mocks.sandboxInitialRevealedSteps).toBeNull());
    act(() => {
      mocks.sandboxOnController?.({ send: frameSend });
      mocks.sandboxOnStepCount?.(2);
      mocks.sandboxOnReady?.();
    });
    await waitFor(() =>
      expect(mocks.presenterSend).toHaveBeenLastCalledWith({
        type: "state",
        state: expect.objectContaining({
          index: 1,
          total: 3,
          stepIndex: 2,
          stepCount: 2,
        }),
      }),
    );
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

  it("keeps raw slide positions while presenting and syncing visible slides", async () => {
    mocks.skippedSlides = true;
    const { router } = renderProjection(2);

    await waitFor(() => expect(router.state.location.search).toBe("?slide=3"));
    expect(screen.getByRole("status").textContent).toBe("2 / 2");
    expect(mocks.playerState).toEqual({ index: 1, total: 2 });
    expect(mocks.sourceSlideIds.at(-1)).toBe("slide-3");

    act(() => mocks.onPrevious?.());
    await waitFor(() => expect(router.state.location.search).toBe("?slide=1"));
    expect(screen.getByRole("status").textContent).toBe("1 / 2");

    act(() => mocks.onPresenterMessage?.({ type: "goto", index: 1 }));
    await waitFor(() => expect(router.state.location.search).toBe("?slide=3"));
    expect(screen.getByRole("status").textContent).toBe("2 / 2");
    expect(mocks.playerState).toEqual({ index: 1, total: 2 });
    expect(mocks.sourceSlideIds.at(-1)).toBe("slide-3");

    act(() => mocks.onPresenterMessage?.({ type: "request-state" }));
    expect(mocks.presenterSend).toHaveBeenLastCalledWith({
      type: "state",
      state: expect.objectContaining({ index: 1, total: 2 }),
    });
  });

  it("applies presenter blackout commands to the audience and reports state back", async () => {
    renderProjection();

    act(() =>
      mocks.onPresenterMessage?.({ type: "toggle-blackout", mode: "black" }),
    );
    await waitFor(() => expect(mocks.playerBlackout).toBe("black"));
    await waitFor(() =>
      expect(mocks.presenterSend).toHaveBeenLastCalledWith({
        type: "state",
        state: expect.objectContaining({ blackout: "black" }),
      }),
    );

    act(() =>
      mocks.onPresenterMessage?.({ type: "toggle-blackout", mode: "white" }),
    );
    await waitFor(() => expect(mocks.playerBlackout).toBe("white"));
    await waitFor(() =>
      expect(mocks.presenterSend).toHaveBeenLastCalledWith({
        type: "state",
        state: expect.objectContaining({ blackout: "white" }),
      }),
    );
  });

  it("switches the audience deck when the presenter sends a deck change", async () => {
    const { router } = renderProjection();

    act(() =>
      mocks.onPresenterMessage?.({ type: "switch-deck", deckId: "deck-2" }),
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/deck/deck-2/present"),
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
