// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deck: {
    id: "deck-1",
    title: "New deck",
    createdByMe: true,
    aspectRatio: "16:9",
    slides: [] as unknown[],
    generationContext: { generationAttemptId: "attempt-1" },
  },
  broadGenerating: true,
  attemptGenerating: false,
  attemptObservedRun: false,
  targetTabId: "target-tab",
  scopedCalls: [] as Array<{ attemptId: string | null; tabId: string | null }>,
  analyticsSessionId: "session-1",
  revision: 0,
  listeners: new Set<() => void>(),
}));

vi.mock("@/hooks/use-agent-generating", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/hooks/use-agent-generating")>();
  const { useSyncExternalStore } = await import("react");

  return {
    ...original,
    useAgentGenerating: (options?: { tabId: string | null }) => {
      useSyncExternalStore(
        (listener) => {
          mocks.listeners.add(listener);
          return () => mocks.listeners.delete(listener);
        },
        () => mocks.revision,
        () => mocks.revision,
      );

      const isTargetTab =
        options !== undefined && options.tabId === mocks.targetTabId;
      if (options !== undefined) {
        const generationContext = mocks.deck.generationContext as Record<
          string,
          unknown
        >;
        mocks.scopedCalls.push({
          attemptId:
            typeof generationContext.generationAttemptId === "string"
              ? generationContext.generationAttemptId
              : null,
          tabId: options.tabId ?? null,
        });
      }
      return {
        generating: isTargetTab
          ? mocks.attemptGenerating
          : options === undefined && mocks.broadGenerating,
        runError: false,
        stopReason: null,
        observedRun: isTargetTab && mocks.attemptObservedRun,
        timedOut: false,
        submit: vi.fn(),
      };
    },
  };
});

vi.mock("@/context/DeckContext", () => ({
  useDecks: () => ({
    getDeck: () => mocks.deck,
    reloadDecks: vi.fn(),
    reloadDecksWithStatus: vi.fn(),
    refreshOpenDeck: vi.fn(),
    updateDeck: vi.fn(),
    updateSlide: vi.fn(),
    updateSlides: vi.fn(),
    deleteSlide: vi.fn(),
    deleteSlides: vi.fn(),
    pasteSlides: vi.fn(),
    duplicateDeck: vi.fn(),
    addSlide: vi.fn(),
    flushDeckSave: vi.fn(),
    reorderSlides: vi.fn(),
    setDeckSlides: vi.fn(),
    undo: vi.fn(),
    loading: false,
    loadError: false,
  }),
  useSaveState: () => ({ hasUnsavedChanges: false }),
  clearSlideEditingActive: vi.fn(),
  deckIdFromPathname: vi.fn(),
  defaultSlideContent: { blank: "" },
  flushPendingSaves: vi.fn(),
  hasUnsavedDeckChanges: vi.fn(() => false),
  markSlideEditingActive: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useGuidedQuestionFlow: () => ({
    questions: [],
    handleSubmit: vi.fn(),
    handleSkip: vi.fn(),
  }),
}));
vi.mock("@agent-native/core/client/analytics", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@agent-native/core/client/analytics")
    >();
  return {
    ...original,
    getAnalyticsSessionId: () => mocks.analyticsSessionId,
    trackEvent: vi.fn(),
  };
});
vi.mock("@agent-native/core/client/collab", () => ({
  useCollaborativeDoc: () => ({
    activeUsers: [],
    agentActive: false,
    agentPresent: false,
  }),
  emailToColor: () => "#000000",
  emailToName: () => "Test user",
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    ...original,
    useSession: () => ({
      session: { email: "test@example.com" },
      isLoading: false,
    }),
  };
});
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/client/i18n")>();
  return {
    ...original,
    useT: () => (key: string) => key,
  };
});
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: null, isLoading: false, isError: false }),
}));

vi.mock("@/hooks/use-deck-access", () => ({
  useDeckAccessStatus: () => ({
    data: { exists: true, hasAccess: true, visibility: "private" },
    isError: false,
    isLoading: false,
  }),
  useRequestDeckAccess: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/use-deck-design-system", () => ({
  useDeckDesignSystem: () => ({
    designSystem: null,
    imageStyleReferenceUrls: [],
  }),
}));
vi.mock("@/hooks/use-deck-presence", () => ({
  useDeckPresence: () => ({
    slidePresence: new Map(),
    agentPresent: false,
    agentActive: false,
    agentSlideId: null,
    recentEdits: [],
  }),
}));
vi.mock("@/hooks/use-deck-role", () => ({
  useDeckRole: () => ({ canEdit: true, canComment: true }),
}));
vi.mock("@/hooks/use-slide-comments", () => ({
  useSlideComments: () => ({ data: [] }),
}));
vi.mock("@/lib/pending-deck-changes", () => ({
  shouldBlockPendingDeckNavigation: () => false,
  usePendingDeckUnloadGuard: vi.fn(),
}));

vi.mock("@/components/editor/EditorToolbar", () => ({ default: () => null }));
vi.mock("@/components/editor/EditorSidebar", () => ({
  default: () => null,
  getSlideSelection: () => [],
}));
vi.mock("@/components/editor/SlideEditor", () => ({ default: () => null }));
vi.mock("@/components/editor/GeneratingSlidePreview", () => ({
  default: () => <div data-testid="generating-preview" />,
}));
vi.mock("@/components/editor/ImageGenPanel", () => ({ default: () => null }));
vi.mock("@/components/editor/AssetLibraryPanel", () => ({
  default: () => null,
}));
vi.mock("@/components/editor/HistoryPanel", () => ({ default: () => null }));
vi.mock("@/components/deck/SlideRenderer", () => ({ default: () => null }));

import { trackEvent } from "@agent-native/core/client/analytics";

import { SLIDES_GENERATION_STARTED_EVENT } from "@/hooks/use-agent-generating";

import DeckEditor from "./DeckEditor";

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
let lockTail: Promise<void> = Promise.resolve();
const lockRequest = vi.fn(
  (_name: string, _options: unknown, callback: (lock: unknown) => unknown) => {
    const previous = lockTail;
    let release: () => void;
    lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(async () => {
      try {
        return await callback({});
      } finally {
        release();
      }
    });
  },
);
let originalLocksDescriptor: PropertyDescriptor | undefined;

function publishAgentGeneratingChange() {
  mocks.revision += 1;
  for (const listener of mocks.listeners) listener();
}

describe("DeckEditor generation signal wiring", () => {
  let router: ReturnType<typeof createMemoryRouter> | undefined;

  beforeEach(() => {
    originalLocksDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "locks",
    );
    lockTail = Promise.resolve();
    lockRequest.mockClear();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: lockRequest },
    });
    window.sessionStorage.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageStub,
    });
    window.localStorage.clear();
    mocks.deck.slides = [];
    Object.assign(mocks, {
      broadGenerating: true,
      attemptGenerating: false,
      attemptObservedRun: false,
      targetTabId: "target-tab",
      analyticsSessionId: "session-1",
      revision: 0,
    });
    mocks.deck.generationContext = { generationAttemptId: "attempt-1" };
    mocks.scopedCalls = [];
    mocks.listeners.clear();
    window.innerWidth = 390;
    vi.mocked(trackEvent).mockClear();
  });

  afterEach(() => {
    cleanup();
    router?.dispose();
    router = undefined;
    if (originalLocksDescriptor) {
      Object.defineProperty(navigator, "locks", originalLocksDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "locks");
    }
    vi.restoreAllMocks();
  });

  it("emits one content-free output view after the deck has slides", async () => {
    mocks.deck.slides = [{ id: "slide-1", content: "private slide text" }];
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1"] },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        "output_viewed",
        expect.objectContaining({
          app_name: "slides",
          template_name: "slides",
          output_id: "deck-1",
          output_type: "deck",
          slide_count: 1,
          source: "deck_editor",
          generation_attempt_id: "attempt-1",
        }),
      ),
    );
    const outputViewedEvent = vi
      .mocked(trackEvent)
      .mock.calls.find(([name]) => name === "output_viewed");
    expect(JSON.stringify(outputViewedEvent)).not.toContain(
      "private slide text",
    );

    act(() => publishAgentGeneratingChange());
    expect(
      vi
        .mocked(trackEvent)
        .mock.calls.filter(([name]) => name === "output_viewed"),
    ).toHaveLength(1);
  });

  it("emits one output view per deck even when a deck is revisited", async () => {
    mocks.deck.slides = [{ id: "slide-1", content: "slide" }];
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1"] },
    );

    render(<RouterProvider router={router} />);
    const outputViews = () =>
      vi
        .mocked(trackEvent)
        .mock.calls.filter(([name]) => name === "output_viewed");
    await waitFor(() => expect(outputViews()).toHaveLength(1));

    await act(async () => router?.navigate("/deck/deck-2"));
    await waitFor(() => expect(outputViews()).toHaveLength(2));

    await act(async () => router?.navigate("/deck/deck-1"));
    expect(outputViews()).toHaveLength(2);
  });

  it("does not emit a second output view when the editor remounts in the tab", async () => {
    mocks.deck.slides = [{ id: "slide-1", content: "slide" }];
    router = createMemoryRouter(
      [
        { path: "/deck/:id", element: <DeckEditor /> },
        { path: "/other", element: <div>Other</div> },
      ],
      { initialEntries: ["/deck/deck-1"] },
    );

    render(<RouterProvider router={router} />);
    const outputViews = () =>
      vi
        .mocked(trackEvent)
        .mock.calls.filter(([name]) => name === "output_viewed");
    await waitFor(() => expect(outputViews()).toHaveLength(1));

    await act(async () => router?.navigate("/other"));
    await act(async () => router?.navigate("/deck/deck-1"));
    expect(outputViews()).toHaveLength(1);
  });

  it("emits a new output view for the same deck in a new analytics session", async () => {
    mocks.deck.slides = [{ id: "slide-1", content: "slide" }];
    router = createMemoryRouter(
      [
        { path: "/deck/:id", element: <DeckEditor /> },
        { path: "/other", element: <div>Other</div> },
      ],
      { initialEntries: ["/deck/deck-1"] },
    );

    render(<RouterProvider router={router} />);
    const outputViews = () =>
      vi
        .mocked(trackEvent)
        .mock.calls.filter(([name]) => name === "output_viewed");
    await waitFor(() => expect(outputViews()).toHaveLength(1));

    mocks.analyticsSessionId = "session-2";
    await act(async () => router?.navigate("/other"));
    await act(async () => router?.navigate("/deck/deck-1"));

    await waitFor(() => expect(outputViews()).toHaveLength(2));
  });

  it("deduplicates deck views across tabs in the same analytics session", async () => {
    mocks.deck.slides = [{ id: "slide-1", content: "slide" }];
    window.localStorage.setItem(
      "slides:output-viewed",
      JSON.stringify({ sessionId: "session-1", deckIds: ["deck-1"] }),
    );
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1"] },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => expect(lockRequest).toHaveBeenCalledOnce());
    expect(
      vi
        .mocked(trackEvent)
        .mock.calls.filter(([name]) => name === "output_viewed"),
    ).toHaveLength(0);
  });

  it("serializes simultaneous deck views and bounds the shared marker", async () => {
    mocks.deck.slides = [{ id: "slide-1", content: "slide" }];
    window.localStorage.setItem(
      'slides:output-viewed:["previous-session","old-deck"]',
      "1",
    );
    router = createMemoryRouter(
      [
        {
          path: "/deck/:id",
          element: (
            <>
              <DeckEditor />
              <DeckEditor />
            </>
          ),
        },
      ],
      { initialEntries: ["/deck/deck-1"] },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => expect(lockRequest).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        vi
          .mocked(trackEvent)
          .mock.calls.filter(([name]) => name === "output_viewed"),
      ).toHaveLength(1),
    );
    expect(window.localStorage.getItem("slides:output-viewed")).toBe(
      JSON.stringify({ sessionId: "session-1", deckIds: ["deck-1"] }),
    );
    expect(
      window.localStorage.getItem(
        'slides:output-viewed:["previous-session","old-deck"]',
      ),
    ).toBeNull();
    expect(window.localStorage.getItem("slides:output-viewed-cleanup-v1")).toBe(
      "1",
    );
  });

  it("does not emit when shared storage cannot persist the cross-tab claim", async () => {
    mocks.deck.slides = [{ id: "slide-1", content: "slide" }];
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1"] },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => expect(lockRequest).toHaveBeenCalledOnce());
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("clears generation state when the target tab finishes while another chat stays busy", async () => {
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      {
        initialEntries: [
          "/deck/deck-1?generating=1&generation_attempt_id=attempt-1",
        ],
      },
    );

    render(<RouterProvider router={router} />);
    expect(screen.getByTestId("generating-preview")).toBeTruthy();
    expect(router.state.location.search).toContain("generating=1");

    mocks.attemptGenerating = true;
    mocks.attemptObservedRun = true;
    act(() => {
      window.dispatchEvent(
        new CustomEvent(SLIDES_GENERATION_STARTED_EVENT, {
          detail: {
            generationAttemptId: "attempt-1",
            outputId: "deck-1",
            tabId: mocks.targetTabId,
          },
        }),
      );
    });

    mocks.attemptGenerating = false;
    publishAgentGeneratingChange();

    await waitFor(() => {
      const params = new URLSearchParams(router?.state.location.search);
      expect(params.has("generating")).toBe(false);
      expect(params.has("generation_attempt_id")).toBe(false);
      expect(mocks.broadGenerating).toBe(true);
      expect(screen.queryByTestId("generating-preview")).toBeNull();
    });
  });

  it("does not carry the prior tab into a retry or enable its stale failure", async () => {
    Object.assign(mocks.deck, {
      generationContext: {
        generationAttemptId: "attempt-1",
        generationFailureCode: "no_output",
        generationFailureAttemptId: "attempt-1",
      },
    });
    mocks.targetTabId = "old-tab";
    mocks.attemptGenerating = true;
    mocks.attemptObservedRun = true;
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      {
        initialEntries: [
          "/deck/deck-1?generating=1&generation_attempt_id=attempt-1",
        ],
      },
    );

    render(<RouterProvider router={router} />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent(SLIDES_GENERATION_STARTED_EVENT, {
          detail: {
            generationAttemptId: "attempt-1",
            outputId: "deck-1",
            tabId: "old-tab",
          },
        }),
      );
    });
    await waitFor(() =>
      expect(mocks.scopedCalls).toContainEqual({
        attemptId: "attempt-1",
        tabId: "old-tab",
      }),
    );

    Object.assign(mocks.deck, {
      generationContext: {
        generationAttemptId: "attempt-2",
        generationFailureCode: "no_output",
        generationFailureAttemptId: "attempt-1",
      },
    });
    act(publishAgentGeneratingChange);

    await waitFor(() =>
      expect(mocks.scopedCalls).toContainEqual({
        attemptId: "attempt-2",
        tabId: null,
      }),
    );
    expect(mocks.scopedCalls).not.toContainEqual({
      attemptId: "attempt-2",
      tabId: "old-tab",
    });
    expect(
      (
        screen.getByRole("button", {
          name: "deckEditor.tryAgain",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("keeps a submitted attempt open when pagehide enters the back-forward cache", () => {
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      {
        initialEntries: [
          "/deck/deck-1?generating=1&generation_attempt_id=attempt-1",
        ],
      },
    );

    render(<RouterProvider router={router} />);
    mocks.attemptGenerating = true;
    mocks.attemptObservedRun = true;
    act(() => {
      window.dispatchEvent(
        new CustomEvent(SLIDES_GENERATION_STARTED_EVENT, {
          detail: {
            generationAttemptId: "attempt-1",
            outputId: "deck-1",
            tabId: mocks.targetTabId,
          },
        }),
      );
      publishAgentGeneratingChange();
    });

    const persistedPageHide = new Event("pagehide") as PageTransitionEvent;
    Object.defineProperty(persistedPageHide, "persisted", { value: true });
    act(() => window.dispatchEvent(persistedPageHide));
    expect(trackEvent).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(trackEvent).toHaveBeenCalledWith(
      "generation_abandoned",
      expect.objectContaining({
        generation_attempt_id: "attempt-1",
        reason: "page_exit",
      }),
    );
  });

  it("closes an attempt when pagehide occurs before agentSubmit", () => {
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      {
        initialEntries: [
          "/deck/deck-1?generating=1&generation_attempt_id=attempt-1",
        ],
      },
    );

    render(<RouterProvider router={router} />);
    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(trackEvent).toHaveBeenCalledWith(
      "generation_outcome_unresolved",
      expect.objectContaining({
        generation_attempt_id: "attempt-1",
        outcome: "unresolved",
        reason: "page_exit_before_submit",
      }),
    );
  });

  it("closes an attempt when client-side navigation unmounts the editor", async () => {
    router = createMemoryRouter(
      [
        { path: "/deck/:id", element: <DeckEditor /> },
        { path: "/next", element: <div /> },
      ],
      {
        initialEntries: [
          "/deck/deck-1?generating=1&generation_attempt_id=attempt-1",
        ],
      },
    );

    render(<RouterProvider router={router} />);
    await act(async () => router?.navigate("/next"));

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        "generation_outcome_unresolved",
        expect.objectContaining({
          generation_attempt_id: "attempt-1",
          outcome: "unresolved",
          reason: "route_exit_before_submit",
        }),
      ),
    );
  });

  it("marks an active generation abandoned when client-side navigation leaves the editor", async () => {
    router = createMemoryRouter(
      [
        { path: "/deck/:id", element: <DeckEditor /> },
        { path: "/next", element: <div /> },
      ],
      {
        initialEntries: [
          "/deck/deck-1?generating=1&generation_attempt_id=attempt-1",
        ],
      },
    );

    render(<RouterProvider router={router} />);
    mocks.attemptGenerating = true;
    mocks.attemptObservedRun = true;
    act(() => {
      window.dispatchEvent(
        new CustomEvent(SLIDES_GENERATION_STARTED_EVENT, {
          detail: {
            generationAttemptId: "attempt-1",
            outputId: "deck-1",
            tabId: mocks.targetTabId,
          },
        }),
      );
      publishAgentGeneratingChange();
    });

    await act(async () => router?.navigate("/next"));

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        "generation_abandoned",
        expect.objectContaining({
          generation_attempt_id: "attempt-1",
          reason: "route_exit",
        }),
      ),
    );
  });
});
