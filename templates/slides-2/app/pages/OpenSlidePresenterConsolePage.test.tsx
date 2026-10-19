// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(() => true),
  onMessage: null as null | ((message: any) => void),
  callAction: vi.fn(),
  compareAndSetClientAppState: vi.fn(),
  readClientAppState: vi.fn(),
  queue: null as { commands: Array<Record<string, unknown>> } | null,
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  writeClientAppState: vi.fn().mockResolvedValue(undefined),
  compareAndSetClientAppState: (...args: unknown[]) =>
    mocks.compareAndSetClientAppState(...args),
  readClientAppState: (...args: unknown[]) => mocks.readClientAppState(...args),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
  callAction: (...args: unknown[]) => mocks.callAction(...args),
  deleteClientAppState: vi.fn(async () => undefined),
  getBrowserTabId: () => "presenter-console-test",
  useChangeVersion: () => 0,
  useDbSync: vi.fn(),
  useSession: () => ({ status: "authenticated" }),
  useActionQuery: (action: string, input: Record<string, unknown> = {}) => {
    const ok = (data: unknown) => ({
      data,
      error: undefined,
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    });
    switch (action) {
      case "get-deck":
        return ok({
          id: "deck-1",
          title: "Presenter console test",
          slides: [
            { id: "slide-1", slideNumber: 1 },
            { id: "slide-2", slideNumber: 2 },
          ],
        });
      case "list-decks":
        return ok({
          decks: [
            {
              id: "deck-1",
              title: "Presenter console test",
              previewSlide: { id: "slide-1" },
              previewTooLarge: false,
            },
            {
              id: "deck-2",
              title: "Other presentation",
              previewSlide: { id: "other-slide" },
              previewTooLarge: true,
            },
          ],
        });
      case "get-slide-source": {
        const slideId = input.slideId === "slide-2" ? "slide-2" : "slide-1";
        return ok({
          slide: {
            id: slideId,
            revision: 1,
            sourceHash: `${slideId}-hash`,
            notes: `Notes for ${slideId}`,
          },
        });
      }
      case "get-slide-render":
        return ok({
          deckId: "deck-1",
          slideId: input.slideId,
          revision: 1,
          sourceHash: `${String(input.slideId)}-hash`,
        });
      default:
        throw new Error(`Unexpected presenter query: ${action}`);
    }
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values
      ? key.replace(/{{(\w+)}}/g, (_match, name: string) =>
          String(values[name]),
        )
      : key,
  useFormatters: () => ({
    formatDate: (value: number | Date, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", options).format(value),
  }),
}));

vi.mock("@/components/open-slide-presenter/presenter-channel", () => ({
  clampPresenterIndex: (index: number, total: number) =>
    total > 0 ? Math.max(0, Math.min(total - 1, index)) : 0,
  useOpenSlidePresenterChannel: (
    _deckId: string,
    onMessage: (message: unknown) => void,
  ) => {
    mocks.onMessage = onMessage;
    return { available: true, send: mocks.send };
  },
}));

vi.mock("@/components/open-slide-runtime/OpenSlideCanvas", () => ({
  OpenSlideCanvas: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/open-slide-runtime/SandboxedSlide", () => ({
  SandboxedSlide: () => null,
}));

import OpenSlidePresenterConsolePage from "./OpenSlidePresenterConsolePage";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  mocks.send.mockClear();
  mocks.callAction.mockClear();
  mocks.compareAndSetClientAppState.mockClear();
  mocks.readClientAppState.mockClear();
  mocks.onMessage = null;
  mocks.queue = null;
  mocks.readClientAppState.mockImplementation(async () => mocks.queue);
  mocks.callAction.mockImplementation(async (_name, input) => {
    const command = {
      ...(input as Record<string, unknown>),
      commandId: "0e8d67ad-7f0e-4d2c-94d6-b74b2f88b5cb",
      issuedAt: Date.now(),
    };
    mocks.queue = {
      commands: [...(mocks.queue?.commands ?? []), command],
    };
    return command;
  });
  mocks.compareAndSetClientAppState.mockImplementation(
    async (_key, expected, next) => {
      if (JSON.stringify(mocks.queue) !== JSON.stringify(expected)) {
        return false;
      }
      mocks.queue = next as { commands: Array<Record<string, unknown>> };
      return true;
    },
  );
});

function renderConsole() {
  const router = createMemoryRouter(
    [
      {
        path: "/deck/:id/present",
        element: <OpenSlidePresenterConsolePage />,
      },
    ],
    { initialEntries: ["/deck/deck-1/present?view=presenter&slide=1"] },
  );

  render(<RouterProvider router={router} />);
  return router;
}

function linkProjection() {
  act(() => {
    mocks.onMessage?.({
      type: "state",
      state: {
        index: 0,
        total: 2,
        blackout: null,
        startedAt: Date.now(),
      },
    });
  });
}

describe("OpenSlidePresenterConsolePage", () => {
  it("shows an unlinked state and prevents preview-only navigation controls", () => {
    renderConsole();

    expect(screen.getByRole("status").textContent).toContain(
      "openSlidePresenter.projectionNotLinked",
    );
    expect(
      screen
        .getByRole("button", { name: "presentation.nextSlide" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "openSlidePresenter.blackout" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "openSlidePresenter.whiteout" })
        .hasAttribute("disabled"),
    ).toBe(true);

    mocks.send.mockClear();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(mocks.send).not.toHaveBeenCalledWith({ type: "next" });
  });

  it("enables live controls after receiving projection state", async () => {
    renderConsole();
    linkProjection();

    expect(screen.queryByRole("status")).toBeNull();
    const next = screen.getByRole("button", { name: "presentation.nextSlide" });
    expect((next as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(next);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.callAction).toHaveBeenCalledWith("control-presenter", {
      deckId: "deck-1",
      operation: "next",
    });
    expect(mocks.send).toHaveBeenCalledWith({ type: "next" });
    expect(mocks.queue?.commands).toEqual([]);
  });

  it("relays agent queued controls from SQL application state", async () => {
    mocks.queue = {
      commands: [
        {
          commandId: "1ef4ac1a-4354-4dd8-a0a1-661164e3ed0c",
          deckId: "deck-1",
          issuedAt: Date.now(),
          operation: "goto",
          slideNumber: 2,
        },
      ],
    };

    renderConsole();
    linkProjection();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.send).toHaveBeenCalledWith({ type: "goto", index: 1 });
    expect(mocks.queue?.commands).toEqual([]);
  });

  it("switches both presenter tabs when an agent queues a deck switch", async () => {
    const router = renderConsole();
    mocks.queue = {
      commands: [
        {
          commandId: "44c0b387-9914-42de-9b56-5d642cb3a8f8",
          deckId: "deck-1",
          issuedAt: Date.now(),
          operation: "switch-deck",
          targetDeckId: "deck-2",
        },
      ],
    };
    linkProjection();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.send).toHaveBeenCalledWith({
      type: "switch-deck",
      deckId: "deck-2",
    });
    expect(mocks.queue?.commands).toEqual([]);
    expect(router.state.location.pathname).toBe("/deck/deck-2/present");
    expect(router.state.location.search).toBe("?view=presenter");
  });

  it("routes deck switches through the action queue before navigating the console", async () => {
    const router = renderConsole();
    linkProjection();

    fireEvent.click(
      screen.getByRole("button", { name: "openSlidePresenter.switchDeck" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Other presentation" }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "openSlidePresenter.switchToDeck",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.callAction).toHaveBeenCalledWith("control-presenter", {
      deckId: "deck-1",
      operation: "switch-deck",
      targetDeckId: "deck-2",
    });
    expect(mocks.send).toHaveBeenCalledWith({
      type: "switch-deck",
      deckId: "deck-2",
    });
    expect(mocks.queue?.commands).toEqual([]);
    expect(router.state.location.pathname).toBe("/deck/deck-2/present");
    expect(router.state.location.search).toBe("?view=presenter");
  });

  it("shows localized fallback copy for errors without an action message", async () => {
    mocks.callAction.mockRejectedValueOnce("opaque failure");
    renderConsole();
    linkProjection();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "presentation.nextSlide" }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "openSlidePresenter.controlFailed",
    );
  });

  it("drops the live state when projection replies stop", () => {
    vi.useFakeTimers();
    renderConsole();
    linkProjection();

    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(6_000));

    expect(screen.getByRole("status").textContent).toContain(
      "openSlidePresenter.projectionNotLinked",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "presentation.nextSlide",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("shows a live clock and resets the elapsed timer locally", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T12:00:00.000Z"));
    renderConsole();

    expect(screen.getByTitle("openSlidePresenter.currentTime")).toBeTruthy();
    const elapsedTimer = screen.getByTitle("openSlidePresenter.elapsedTime");
    expect(elapsedTimer.textContent).toBe("00:00");

    act(() => vi.advanceTimersByTime(7_000));
    expect(elapsedTimer.textContent).toBe("00:07");
    fireEvent.click(
      screen.getByRole("button", { name: "openSlidePresenter.resetTimer" }),
    );
    expect(elapsedTimer.textContent).toBe("00:00");
    act(() => vi.advanceTimersByTime(1_000));
    expect(elapsedTimer.textContent).toBe("00:01");
  });

  it("lets the presenter adjust speaker-notes text size", () => {
    renderConsole();
    const note = screen.getByText("Notes for slide-1");
    const panel = note.closest("div.rounded-md");
    expect(panel?.classList.contains("text-sm")).toBe(true);

    const increase = screen.getByRole("button", {
      name: "openSlidePresenter.increaseNotesTextSize",
    });
    expect(increase.getAttribute("title")).toBe(
      "openSlidePresenter.increaseNotesTextSize",
    );
    fireEvent.click(increase);
    expect(panel?.classList.contains("text-base")).toBe(true);
    fireEvent.click(increase);
    expect(panel?.classList.contains("text-lg")).toBe(true);
    expect((increase as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(
      screen.getByRole("button", {
        name: "openSlidePresenter.decreaseNotesTextSize",
      }),
    );
    expect(panel?.classList.contains("text-base")).toBe(true);
  });
});
