// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn((_message: any) => true),
  onMessage: null as null | ((message: any) => void),
  callAction: vi.fn(),
  compareAndSetClientAppState: vi.fn(),
  readClientAppState: vi.fn(),
  queue: null as { commands: Array<Record<string, unknown>> } | null,
  projectionState: null as null | {
    index: number;
    total: number;
    blackout: "black" | "white" | null;
    startedAt: number;
  },
  commandSequence: 0,
  hasSkippedSlide: false,
}));

const localStorageState = new Map<string, string>();
const localStorageStub: Storage = {
  get length() {
    return localStorageState.size;
  },
  clear: () => localStorageState.clear(),
  getItem: (key) => localStorageState.get(key) ?? null,
  key: (index) => [...localStorageState.keys()][index] ?? null,
  removeItem: (key) => localStorageState.delete(key),
  setItem: (key, value) => localStorageState.set(key, String(value)),
};

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
          slides: mocks.hasSkippedSlide
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
        const slideId = String(input.slideId ?? "slide-1");
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
  useT: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "slides2Presenter.position" && values) {
      return `${values.index} / ${values.total}`;
    }
    return values
      ? key.replace(/{{(\w+)}}/g, (_match, name: string) =>
          String(values[name]),
        )
      : key;
  },
  useFormatters: () => ({
    formatDate: (value: number | Date, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", options).format(value),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat("en-US", options).format(value),
  }),
}));

vi.mock("@/components/slides-2-presenter/presenter-channel", () => ({
  clampPresenterIndex: (index: number, total: number) =>
    total > 0 ? Math.max(0, Math.min(total - 1, index)) : 0,
  useSlides2PresenterChannel: (
    _deckId: string,
    onMessage: (message: unknown) => void,
  ) => {
    mocks.onMessage = onMessage;
    return { available: true, send: mocks.send };
  },
}));

vi.mock("@/components/slides-2-runtime/Slides2Canvas", () => ({
  Slides2Canvas: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/slides-2-runtime/SandboxedSlide", () => ({
  SandboxedSlide: ({
    artifact,
    initialRevealedSteps,
  }: {
    artifact: { slideId: string };
    initialRevealedSteps?: number | null;
  }) => (
    <div
      data-testid="sandboxed-slide-preview"
      data-slide-id={artifact.slideId}
      data-revealed-steps={initialRevealedSteps ?? "all"}
    />
  ),
}));

import Slides2PresenterConsolePage from "./Slides2PresenterConsolePage";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageStub,
  });
  window.localStorage.clear();
  mocks.send.mockClear();
  mocks.callAction.mockClear();
  mocks.compareAndSetClientAppState.mockClear();
  mocks.readClientAppState.mockClear();
  mocks.onMessage = null;
  mocks.queue = null;
  mocks.projectionState = null;
  mocks.commandSequence = 0;
  mocks.hasSkippedSlide = false;
  mocks.send.mockImplementation((message) => {
    const state = mocks.projectionState;
    if (!state) return true;
    let changed = false;

    switch (message.type) {
      case "goto":
        mocks.projectionState = { ...state, index: message.index };
        changed = true;
        break;
      case "next":
        mocks.projectionState = { ...state, index: state.index + 1 };
        changed = true;
        break;
      case "prev":
        mocks.projectionState = { ...state, index: state.index - 1 };
        changed = true;
        break;
      case "toggle-blackout":
        mocks.projectionState = { ...state, blackout: message.mode };
        changed = true;
        break;
    }

    if (changed && mocks.projectionState) {
      mocks.onMessage?.({ type: "state", state: mocks.projectionState });
    }
    return true;
  });
  mocks.readClientAppState.mockImplementation(async () => mocks.queue);
  mocks.callAction.mockImplementation(async (_name, input) => {
    mocks.commandSequence += 1;
    const command = {
      ...(input as Record<string, unknown>),
      commandId: `00000000-0000-4000-8000-${String(mocks.commandSequence).padStart(12, "0")}`,
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

function renderConsole(slide = 1) {
  const router = createMemoryRouter(
    [
      {
        path: "/deck/:id/present",
        element: <Slides2PresenterConsolePage />,
      },
    ],
    {
      initialEntries: [`/deck/deck-1/present?view=presenter&slide=${slide}`],
    },
  );

  render(<RouterProvider router={router} />);
  return router;
}

function linkProjection(overrides: Record<string, unknown> = {}) {
  const state = {
    index: 0,
    total: 2,
    blackout: null,
    startedAt: Date.now(),
    ...overrides,
  };
  mocks.projectionState = state;
  act(() => {
    mocks.onMessage?.({
      type: "state",
      state,
    });
  });
}

describe("Slides2PresenterConsolePage", () => {
  it("aligns the current slide and up-next labels above their previews", () => {
    renderConsole();

    expect(screen.getByText("slides2Presenter.nowShowing")).toBeTruthy();
    expect(screen.getAllByText("presentation.upNext")).toHaveLength(2);
    expect(screen.getByLabelText("1 / 2").textContent).toBe("01 / 02");
  });

  it("matches the presenter notes and stage spacing from the console reference", () => {
    renderConsole();

    const referenceLabelClasses = [
      "font-sans",
      "text-[11px]",
      "font-medium",
      "tracking-[0.08em]",
    ];
    const labels = [
      screen.getByText("slides2Presenter.presenterLabel"),
      screen.getByRole("heading", { name: "slides2Presenter.nowShowing" }),
      screen
        .getAllByRole("heading", { name: "presentation.upNext" })
        .find((heading) => heading.className.includes("font-sans"))!,
      screen.getByRole("heading", { name: "presentation.speakerNotes" }),
      screen.getAllByText("slides2Presenter.jumpLabel")[0],
    ];
    for (const label of labels) {
      for (const className of referenceLabelClasses) {
        expect(label.className).toContain(className);
      }
    }

    expect(
      screen
        .getByRole("main")
        .parentElement?.classList.contains("bg-neutral-950"),
    ).toBe(true);
    expect(
      screen.getByRole("heading", { name: "presentation.speakerNotes" })
        .className,
    ).toContain("uppercase");
    expect(
      screen.getByRole("group", { name: "slides2Presenter.notesTextSize" })
        .textContent,
    ).toBe("A↓A↑");
    expect(screen.getByRole("main").className).toContain("lg:gap-6");
    expect(
      screen.getByRole("button", { name: "slides2Presenter.shortcutJump" })
        .className,
    ).toContain("sr-only");
  });

  it("keeps raw URL positions while navigating the visible slide sequence", async () => {
    mocks.hasSkippedSlide = true;
    const router = renderConsole(2);

    await waitFor(() =>
      expect(router.state.location.search).toBe("?view=presenter&slide=3"),
    );
    expect(screen.getAllByText("2 / 2").length).toBeGreaterThan(0);
    expect(
      screen
        .getAllByTestId("sandboxed-slide-preview")[0]
        .getAttribute("data-slide-id"),
    ).toBe("slide-3");

    fireEvent.click(
      screen.getByRole("button", { name: "presentation.previousSlide" }),
    );
    await waitFor(() =>
      expect(router.state.location.search).toBe("?view=presenter&slide=1"),
    );
    expect(screen.getAllByText("1 / 2").length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: "presentation.nextSlide" }),
    );
    await waitFor(() =>
      expect(router.state.location.search).toBe("?view=presenter&slide=3"),
    );
    expect(
      screen
        .getAllByTestId("sandboxed-slide-preview")[0]
        .getAttribute("data-slide-id"),
    ).toBe("slide-3");
  });

  it("maps the visible projection index back to its raw slide position", async () => {
    mocks.hasSkippedSlide = true;
    const router = renderConsole();
    linkProjection({ index: 1, total: 2 });

    await waitFor(() =>
      expect(router.state.location.search).toBe("?view=presenter&slide=3"),
    );
    expect(screen.getAllByText("2 / 2").length).toBeGreaterThan(0);
    expect(
      screen
        .getAllByTestId("sandboxed-slide-preview")[0]
        .getAttribute("data-slide-id"),
    ).toBe("slide-3");
  });

  it("does not navigate when arrow keys are used inside editable content", () => {
    const router = renderConsole();
    const editableContent = document.createElement("div");
    editableContent.setAttribute("contenteditable", "plaintext-only");
    Object.defineProperty(editableContent, "isContentEditable", {
      configurable: true,
      value: true,
    });
    document.body.append(editableContent);

    try {
      fireEvent.keyDown(editableContent, { key: "ArrowRight" });

      expect(router.state.location.search).toBe("?view=presenter&slide=1");
    } finally {
      editableContent.remove();
    }
  });

  it("keeps navigation and blackout controls local while the projection is unlinked", () => {
    const router = renderConsole();

    expect(screen.getByRole("status").textContent).toContain(
      "slides2Presenter.projectionNotLinked",
    );
    const previews = screen.getAllByTestId("sandboxed-slide-preview");
    expect(previews[0].getAttribute("data-revealed-steps")).toBe("0");
    expect(previews[1].getAttribute("data-revealed-steps")).toBe("0");
    const previous = screen.getByRole("button", {
      name: "presentation.previousSlide",
    });
    const next = screen.getByRole("button", {
      name: "presentation.nextSlide",
    });
    const jumpInput = screen.getByRole("spinbutton", {
      name: "slides2Presenter.shortcutJump",
    });
    const jump = screen.getByRole("button", {
      name: "slides2Presenter.shortcutJump",
    });
    const blackout = screen.getByRole("button", {
      name: "slides2Presenter.blackout",
    });
    const whiteout = screen.getByRole("button", {
      name: "slides2Presenter.whiteout",
    });

    for (const control of [previous, next, jumpInput, blackout, whiteout]) {
      expect((control as HTMLButtonElement | HTMLInputElement).disabled).toBe(
        false,
      );
    }

    mocks.send.mockClear();
    mocks.callAction.mockClear();

    fireEvent.click(next);
    expect(
      screen
        .getAllByTestId("sandboxed-slide-preview")[0]
        .getAttribute("data-slide-id"),
    ).toBe("slide-2");

    fireEvent.click(previous);
    expect(
      screen
        .getAllByTestId("sandboxed-slide-preview")[0]
        .getAttribute("data-slide-id"),
    ).toBe("slide-1");

    fireEvent.change(jumpInput, { target: { value: "2" } });
    fireEvent.click(jump);
    expect(router.state.location.search).toBe("?view=presenter&slide=2");
    expect(
      screen
        .getAllByTestId("sandboxed-slide-preview")[0]
        .getAttribute("data-slide-id"),
    ).toBe("slide-2");

    fireEvent.click(blackout);
    expect(blackout.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(whiteout);
    expect(whiteout.getAttribute("aria-pressed")).toBe("true");

    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalledWith({ type: "next" });
    expect(mocks.send).not.toHaveBeenCalledWith({ type: "previous" });
    expect(mocks.send).not.toHaveBeenCalledWith({ type: "blackout" });
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

  it("relays slide jumps and blackout modes to the linked projection", async () => {
    mocks.hasSkippedSlide = true;
    const router = renderConsole();
    linkProjection();

    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "slides2Presenter.shortcutJump",
      }),
      { target: { value: "2" } },
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "slides2Presenter.shortcutJump",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(router.state.location.search).toBe("?view=presenter&slide=3");
    expect(mocks.callAction).toHaveBeenCalledWith("control-presenter", {
      deckId: "deck-1",
      operation: "goto",
      slideNumber: 3,
    });
    expect(mocks.send).toHaveBeenCalledWith({ type: "goto", index: 2 });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "slides2Presenter.blackout" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.callAction).toHaveBeenLastCalledWith("control-presenter", {
      deckId: "deck-1",
      operation: "blackout",
      mode: "black",
    });
    expect(mocks.send).toHaveBeenLastCalledWith({
      type: "toggle-blackout",
      mode: "black",
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "slides2Presenter.whiteout" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.callAction).toHaveBeenLastCalledWith("control-presenter", {
      deckId: "deck-1",
      operation: "blackout",
      mode: "white",
    });
    expect(mocks.send).toHaveBeenLastCalledWith({
      type: "toggle-blackout",
      mode: "white",
    });
  });

  it("relays the B and W presenter shortcuts to the linked projection", async () => {
    renderConsole();
    linkProjection();

    await act(async () => {
      fireEvent.keyDown(window, { key: "B" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.callAction).toHaveBeenCalledWith("control-presenter", {
      deckId: "deck-1",
      operation: "blackout",
      mode: "black",
    });
    expect(mocks.send).toHaveBeenCalledWith({
      type: "toggle-blackout",
      mode: "black",
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "W" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.callAction).toHaveBeenLastCalledWith("control-presenter", {
      deckId: "deck-1",
      operation: "blackout",
      mode: "white",
    });
    expect(mocks.send).toHaveBeenLastCalledWith({
      type: "toggle-blackout",
      mode: "white",
    });
  });

  it("previews the next build step on the active slide", () => {
    renderConsole();
    linkProjection({ stepIndex: 1, stepCount: 3 });

    const previews = screen.getAllByTestId("sandboxed-slide-preview");
    expect(previews[0].getAttribute("data-slide-id")).toBe("slide-1");
    expect(previews[0].getAttribute("data-revealed-steps")).toBe("1");
    expect(previews[1].getAttribute("data-slide-id")).toBe("slide-1");
    expect(previews[1].getAttribute("data-revealed-steps")).toBe("2");
  });

  it("starts the next slide at step zero after the current builds are exhausted", () => {
    renderConsole();
    linkProjection({ stepIndex: 2, stepCount: 2 });

    const previews = screen.getAllByTestId("sandboxed-slide-preview");
    expect(previews[1].getAttribute("data-slide-id")).toBe("slide-2");
    expect(previews[1].getAttribute("data-revealed-steps")).toBe("0");
  });

  it("starts the next slide at step zero while the build count is unknown", () => {
    renderConsole();
    linkProjection({ stepIndex: 0, stepCount: null });

    const previews = screen.getAllByTestId("sandboxed-slide-preview");
    expect(previews[1].getAttribute("data-slide-id")).toBe("slide-2");
    expect(previews[1].getAttribute("data-revealed-steps")).toBe("0");
  });

  it("previews remaining build steps when the current slide is the last one", () => {
    renderConsole();
    linkProjection({ index: 1, stepIndex: 0, stepCount: 1 });

    expect(screen.getAllByText("presentation.upNext").length).toBeGreaterThan(
      0,
    );
    const previews = screen.getAllByTestId("sandboxed-slide-preview");
    expect(previews[1].getAttribute("data-slide-id")).toBe("slide-2");
    expect(previews[1].getAttribute("data-revealed-steps")).toBe("1");
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
      screen.getByRole("button", { name: "slides2Presenter.switchDeck" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Other presentation" }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "slides2Presenter.switchToDeck",
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
      "slides2Presenter.controlFailed",
    );
  });

  it("falls back to local preview controls when projection replies stop", () => {
    vi.useFakeTimers();
    renderConsole();
    linkProjection();

    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(6_000));

    expect(screen.getByRole("status").textContent).toContain(
      "slides2Presenter.projectionNotLinked",
    );
    const next = screen.getByRole("button", {
      name: "presentation.nextSlide",
    });
    expect((next as HTMLButtonElement).disabled).toBe(false);
    mocks.send.mockClear();
    mocks.callAction.mockClear();
    fireEvent.click(next);
    expect(
      screen
        .getAllByTestId("sandboxed-slide-preview")[0]
        .getAttribute("data-slide-id"),
    ).toBe("slide-2");
    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalledWith({ type: "next" });
  });

  it("shows a live clock and resets the elapsed timer locally", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T12:00:00.000Z"));
    renderConsole();

    const currentTime = screen.getByTitle("slides2Presenter.currentTime");
    expect(currentTime).toBeTruthy();
    expect(currentTime.textContent).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
    const elapsedTimer = screen.getByTitle("slides2Presenter.elapsedTime");
    expect(elapsedTimer.textContent).toBe("00:00");

    act(() => vi.advanceTimersByTime(7_000));
    expect(elapsedTimer.textContent).toBe("00:07");
    fireEvent.click(
      screen.getByRole("button", { name: "slides2Presenter.resetTimer" }),
    );
    expect(elapsedTimer.textContent).toBe("00:00");
    act(() => vi.advanceTimersByTime(1_000));
    expect(elapsedTimer.textContent).toBe("00:01");
  });

  it("lets the presenter adjust speaker-notes text size", () => {
    renderConsole();
    const note = screen.getByText("Notes for slide-1");
    const panel = note.closest("div.rounded-md");
    expect(panel?.classList.contains("bg-neutral-900")).toBe(true);
    expect(panel?.classList.contains("text-[13.5px]")).toBe(true);
    expect(panel?.classList.contains("p-3")).toBe(true);
    expect(
      panel?.firstElementChild?.classList.contains("space-y-[0.65em]"),
    ).toBe(true);
    expect(
      panel?.firstElementChild?.classList.contains("whitespace-pre-wrap"),
    ).toBe(true);

    const increase = screen.getByRole("button", {
      name: "slides2Presenter.increaseNotesTextSize",
    });
    expect(increase.getAttribute("title")).toBe(
      "slides2Presenter.increaseNotesTextSize",
    );
    fireEvent.click(increase);
    expect(panel?.classList.contains("text-base")).toBe(true);
    fireEvent.click(increase);
    expect(panel?.classList.contains("text-lg")).toBe(true);
    expect((increase as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(
      screen.getByRole("button", {
        name: "slides2Presenter.decreaseNotesTextSize",
      }),
    );
    expect(panel?.classList.contains("text-base")).toBe(true);
  });

  it("persists speaker-notes text size across presenter remounts", async () => {
    renderConsole();
    const increase = screen.getByRole("button", {
      name: "slides2Presenter.increaseNotesTextSize",
    });
    fireEvent.click(increase);

    await waitFor(() =>
      expect(
        window.localStorage.getItem("slides-2:presenter-notes-text-size"),
      ).toBe("2"),
    );
    cleanup();
    renderConsole();

    const note = screen.getByText("Notes for slide-1");
    const panel = note.closest("div.rounded-md");
    expect(panel?.classList.contains("text-base")).toBe(true);
  });
});
