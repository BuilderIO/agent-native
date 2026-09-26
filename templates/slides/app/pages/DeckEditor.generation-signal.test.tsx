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
  analyticsSessionId: "session-1",
  sessionLoading: false,
  authUserId: "canonical-auth-user",
  exportDeckAsPdf: vi.fn(async (..._args: unknown[]) => undefined),
  exportDeckAsPptx: vi.fn(async (..._args: unknown[]) => undefined),
  exportDeckToGoogleSlides: vi.fn(async (..._args: unknown[]) => ({})),
  refreshOpenDeck: vi.fn(
    async (
      _deckId: string,
    ): Promise<{
      id: string;
      slides: unknown[];
      generationContext?: Record<string, unknown> | null;
    } | null> => null,
  ),
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
    refreshOpenDeck: (...args: [string]) => mocks.refreshOpenDeck(...args),
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
      session: mocks.sessionLoading
        ? null
        : { email: "test@example.com", authUserId: mocks.authUserId },
      isLoading: mocks.sessionLoading,
    }),
  };
});
vi.mock("@/lib/export-pdf-client", () => ({
  exportDeckAsPdf: (...args: unknown[]) => mocks.exportDeckAsPdf(...args),
}));
vi.mock("@/lib/export-pptx-client", () => ({
  exportDeckAsPptx: (...args: unknown[]) => mocks.exportDeckAsPptx(...args),
}));
vi.mock("@/lib/export-google-slides-client", () => ({
  exportDeckToGoogleSlides: (...args: unknown[]) =>
    mocks.exportDeckToGoogleSlides(...args),
}));
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

vi.mock("@/components/editor/EditorToolbar", () => ({
  default: (props: {
    onPresent?: (request: { preserveNativeNavigation: true }) => unknown;
    onExportPdf?: () => Promise<void> | void;
    onExportPptx?: () => Promise<void> | void;
    onExportGoogleSlides?: () => Promise<unknown>;
  }) => (
    <div>
      <button
        data-testid="test-present"
        onClick={() => props.onPresent?.({ preserveNativeNavigation: true })}
      />
      <button
        data-testid="test-export-pdf"
        onClick={() => void props.onExportPdf?.()}
      />
      <button
        data-testid="test-export-pptx"
        onClick={() => void props.onExportPptx?.()}
      />
      <button
        data-testid="test-export-google-slides"
        onClick={() => void props.onExportGoogleSlides?.()}
      />
    </div>
  ),
}));
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

import {
  clearStartedGenerationAttempt,
  registerStartedGenerationAttempt,
  SLIDES_GENERATION_STARTED_EVENT,
} from "@/hooks/use-agent-generating";

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
    Object.assign(mocks.deck, {
      generationContext: { generationAttemptId: "attempt-1" },
    });
    mocks.refreshOpenDeck.mockReset().mockResolvedValue(null);
    Object.assign(mocks, {
      broadGenerating: true,
      attemptGenerating: false,
      attemptObservedRun: false,
      analyticsSessionId: "session-1",
      sessionLoading: false,
      authUserId: "canonical-auth-user",
      revision: 0,
    });
    mocks.exportDeckAsPdf.mockClear();
    mocks.exportDeckAsPptx.mockClear();
    mocks.exportDeckToGoogleSlides.mockClear();
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
      {
        initialEntries: ["/deck/deck-1?generation_attempt_id=unissued_attempt"],
      },
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

  it("waits for canonical session identity before claiming an output view", async () => {
    mocks.deck.slides = [{ id: "slide-1", content: "private slide text" }];
    mocks.sessionLoading = true;
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1"] },
    );

    render(<RouterProvider router={router} />);
    expect(lockRequest).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalledWith(
      "output_viewed",
      expect.anything(),
    );

    mocks.sessionLoading = false;
    act(() => publishAgentGeneratingChange());

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        "output_viewed",
        expect.objectContaining({
          output_id: "deck-1",
          auth_user_id: "canonical-auth-user",
        }),
      ),
    );
    expect(lockRequest).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(trackEvent)
        .mock.calls.filter(([name]) => name === "output_viewed"),
    ).toHaveLength(1);
  });

  it("attributes presentation and export starts to the deck and resolved attempt", async () => {
    mocks.deck.slides = [{ id: "slide-1", content: "private slide text" }];
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1"] },
    );

    render(<RouterProvider router={router} />);
    fireEvent.click(screen.getByTestId("test-present"));
    fireEvent.click(screen.getByTestId("test-export-pdf"));
    fireEvent.click(screen.getByTestId("test-export-pptx"));
    fireEvent.click(screen.getByTestId("test-export-google-slides"));

    await waitFor(() =>
      expect(
        vi
          .mocked(trackEvent)
          .mock.calls.filter(([name]) => name === "slide_export_started"),
      ).toHaveLength(3),
    );
    const presentation = vi
      .mocked(trackEvent)
      .mock.calls.find(([name]) => name === "slide_presentation_opened");
    expect(presentation?.[1]).toMatchObject({
      output_id: "deck-1",
      generation_attempt_id: "attempt-1",
    });
    expect(presentation?.[1]).not.toHaveProperty("title");
    expect(presentation?.[1]).not.toHaveProperty("prompt");
    expect(presentation?.[1]).not.toHaveProperty("content");
    const exports = vi
      .mocked(trackEvent)
      .mock.calls.filter(([name]) => name === "slide_export_started");
    expect(exports.map(([, properties]) => properties)).toEqual([
      expect.objectContaining({
        output_id: "deck-1",
        generation_attempt_id: "attempt-1",
        format: "pdf",
      }),
      expect.objectContaining({
        output_id: "deck-1",
        generation_attempt_id: "attempt-1",
        format: "pptx",
      }),
      expect.objectContaining({
        output_id: "deck-1",
        generation_attempt_id: "attempt-1",
        format: "google_slides",
      }),
    ]);
    for (const [, properties] of exports) {
      expect(properties).not.toHaveProperty("title");
      expect(properties).not.toHaveProperty("prompt");
      expect(properties).not.toHaveProperty("content");
    }
  });

  it("omits generation attempt from presentation and exports without a resolved ID", async () => {
    mocks.deck.slides = [{ id: "slide-1", content: "private slide text" }];
    Object.assign(mocks.deck, { generationContext: null });
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      {
        initialEntries: ["/deck/deck-1?generation_attempt_id=unissued_attempt"],
      },
    );

    render(<RouterProvider router={router} />);
    fireEvent.click(screen.getByTestId("test-present"));
    fireEvent.click(screen.getByTestId("test-export-pdf"));
    fireEvent.click(screen.getByTestId("test-export-pptx"));
    fireEvent.click(screen.getByTestId("test-export-google-slides"));

    await waitFor(() =>
      expect(
        vi
          .mocked(trackEvent)
          .mock.calls.filter(([name]) => name === "slide_export_started"),
      ).toHaveLength(3),
    );
    const events = vi
      .mocked(trackEvent)
      .mock.calls.filter(
        ([name]) =>
          name === "slide_presentation_opened" ||
          name === "slide_export_started",
      );
    expect(events).toHaveLength(4);
    for (const [, properties] of events) {
      expect(properties).toHaveProperty("output_id", "deck-1");
      expect(properties).not.toHaveProperty("generation_attempt_id");
      expect(properties).not.toHaveProperty("title");
      expect(properties).not.toHaveProperty("prompt");
      expect(properties).not.toHaveProperty("content");
    }
  });

  it("does not attribute an unissued query attempt to a deck without context", async () => {
    mocks.deck.slides = [{ id: "slide-1", content: "private slide text" }];
    Object.assign(mocks.deck, { generationContext: null });
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      {
        initialEntries: [
          "/deck/deck-1?generation_attempt_id=valid_but_unissued",
        ],
      },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        "output_viewed",
        expect.objectContaining({ output_id: "deck-1" }),
      ),
    );
    const outputViewedEvent = vi
      .mocked(trackEvent)
      .mock.calls.find(([name]) => name === "output_viewed");
    expect(outputViewedEvent?.[1]).not.toHaveProperty("generation_attempt_id");
  });

  it("accepts a query attempt issued for this same deck", async () => {
    const issuedAttemptId = "issued_attempt_for_deck";
    mocks.deck.slides = [{ id: "slide-1", content: "private slide text" }];
    Object.assign(mocks.deck, { generationContext: null });
    registerStartedGenerationAttempt(
      issuedAttemptId,
      "deck-1",
      mocks.targetTabId,
    );
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      {
        initialEntries: [
          `/deck/deck-1?generation_attempt_id=${issuedAttemptId}`,
        ],
      },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        "output_viewed",
        expect.objectContaining({ generation_attempt_id: issuedAttemptId }),
      ),
    );
    clearStartedGenerationAttempt(issuedAttemptId, "deck-1");
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
    mocks.refreshOpenDeck.mockResolvedValue({
      id: "deck-1",
      slides: [{ id: "slide-1", content: "persisted" }],
    });
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
    const outputSaved = vi
      .mocked(trackEvent)
      .mock.calls.filter(([name]) => name === "output_saved");
    expect(outputSaved).toHaveLength(1);
    expect(outputSaved[0]?.[1]).toMatchObject({
      auth_user_id: "canonical-auth-user",
      generation_attempt_id: "attempt-1",
      output_id: "deck-1",
      slide_count: 1,
      persistence_confirmation: "server_readback",
    });
  });

  it("emits one failed outcome from the action-owned run-error producer", async () => {
    Object.assign(mocks.deck, {
      generationContext: {
        generationAttemptId: "attempt-1",
        generationMode: "action",
        threadId: "distinct-agent-thread",
        runId: "agent-run",
        tabId: mocks.targetTabId,
        generationComplete: false,
      },
    });
    mocks.refreshOpenDeck.mockResolvedValue({
      id: "deck-1",
      slides: [{ id: "slide-1", content: "private slide text" }],
      generationContext: {
        generationAttemptId: "attempt-1",
        generationMode: "action",
        threadId: "distinct-agent-thread",
        runId: "agent-run",
        tabId: mocks.targetTabId,
        generationComplete: false,
      },
    });
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
        new CustomEvent("agent-chat:run-error", {
          detail: {
            tabId: mocks.targetTabId,
            runId: "agent-run",
          },
        }),
      );
    });

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        "generation_failed",
        expect.objectContaining({
          generation_attempt_id: "attempt-1",
          output_id: "deck-1",
          outcome: "failed",
          failure_code: "agent_run_error",
          failure_stage: "agent_run",
        }),
      ),
    );
    const outcomes = vi
      .mocked(trackEvent)
      .mock.calls.filter(([name]) => name === "generation_outcome_unresolved");
    expect(outcomes).toHaveLength(0);
    const failures = vi
      .mocked(trackEvent)
      .mock.calls.filter(
        ([name, properties]) =>
          name === "generation_failed" &&
          properties?.generation_attempt_id === "attempt-1",
      );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.[1]).not.toHaveProperty("message");
    expect(failures[0]?.[1]).not.toHaveProperty("prompt");
    expect(failures[0]?.[1]).not.toHaveProperty("content");
  });

  it("settles an action-owned stop by its persisted thread without tab registration", async () => {
    const attemptId = "stopped_attempt";
    Object.assign(mocks.deck, {
      generationContext: {
        generationAttemptId: attemptId,
        generationMode: "action",
        threadId: mocks.targetTabId,
        runId: "agent-run",
      },
    });
    mocks.refreshOpenDeck.mockResolvedValue({
      id: "deck-1",
      slides: [{ id: "slide-1", content: "private slide text" }],
      generationContext: {
        generationAttemptId: attemptId,
        generationMode: "action",
        threadId: mocks.targetTabId,
        runId: "agent-run",
        generationComplete: false,
      },
    });
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      {
        initialEntries: [
          `/deck/deck-1?generating=1&generation_attempt_id=${attemptId}`,
        ],
      },
    );

    render(<RouterProvider router={router} />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: false,
            reason: "stopped",
            threadId: mocks.targetTabId,
            tabId: mocks.targetTabId,
            runId: "agent-run",
          },
        }),
      );
    });

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        "generation_cancelled",
        expect.objectContaining({
          generation_attempt_id: attemptId,
          output_id: "deck-1",
          outcome: "cancelled",
          failure_code: "cancelled",
        }),
      ),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: false,
            reason: "stopped",
            threadId: mocks.targetTabId,
            tabId: mocks.targetTabId,
            runId: "agent-run",
          },
        }),
      );
    });
    const cancellations = vi
      .mocked(trackEvent)
      .mock.calls.filter(
        ([name, properties]) =>
          name === "generation_cancelled" &&
          properties?.generation_attempt_id === attemptId,
      );
    expect(cancellations).toHaveLength(1);
  });

  it("settles an action-owned pre-running failure by trusted tab and run IDs", async () => {
    const attemptId = "start_failed_attempt";
    Object.assign(mocks.deck, {
      generationContext: {
        generationAttemptId: attemptId,
        generationMode: "action",
        threadId: "distinct-agent-thread",
        runId: "distinct-agent-run",
        tabId: mocks.targetTabId,
      },
    });
    mocks.refreshOpenDeck.mockResolvedValue({
      id: "deck-1",
      slides: [],
    });
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      {
        initialEntries: [
          `/deck/deck-1?generating=1&generation_attempt_id=${attemptId}`,
        ],
      },
    );

    render(<RouterProvider router={router} />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:run-error", {
          detail: {
            tabId: "unrelated-tab",
            runId: "distinct-agent-run",
          },
        }),
      );
    });
    expect(trackEvent).not.toHaveBeenCalledWith(
      "generation_failed",
      expect.objectContaining({ generation_attempt_id: attemptId }),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:run-error", {
          detail: {
            tabId: mocks.targetTabId,
            runId: "distinct-agent-run",
          },
        }),
      );
    });

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        "generation_failed",
        expect.objectContaining({
          generation_attempt_id: attemptId,
          failure_code: "agent_run_error",
        }),
      ),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:run-error", {
          detail: {
            tabId: mocks.targetTabId,
            runId: "distinct-agent-run",
          },
        }),
      );
    });
    expect(
      vi
        .mocked(trackEvent)
        .mock.calls.filter(
          ([name, properties]) =>
            name === "generation_failed" &&
            properties?.generation_attempt_id === attemptId,
        ),
    ).toHaveLength(1);
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
      "generation_ui_exited",
      expect.objectContaining({
        generation_attempt_id: "attempt-1",
        exit_reason: "page_exit",
        exit_stage: "active",
      }),
    );
    expect(trackEvent).not.toHaveBeenCalledWith(
      "generation_abandoned",
      expect.anything(),
    );
  });

  it("records a nonterminal page exit before chat delivery", () => {
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
      "generation_ui_exited",
      expect.objectContaining({
        generation_attempt_id: "attempt-1",
        exit_reason: "page_exit",
        exit_stage: "before_submit",
      }),
    );
    expect(trackEvent).not.toHaveBeenCalledWith(
      "generation_outcome_unresolved",
      expect.anything(),
    );
  });

  it("does not reclassify a known setup rejection as an unresolved route exit", async () => {
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
    act(() => clearStartedGenerationAttempt("attempt-1", "deck-1"));
    await act(async () => router?.navigate("/next"));

    expect(trackEvent).not.toHaveBeenCalledWith(
      "generation_outcome_unresolved",
      expect.objectContaining({
        generation_attempt_id: "attempt-1",
        reason: "route_exit_before_submit",
      }),
    );
  });

  it("records client-side navigation as a nonterminal UI exit", async () => {
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
        "generation_ui_exited",
        expect.objectContaining({
          generation_attempt_id: "attempt-1",
          exit_reason: "route_exit",
          exit_stage: "before_submit",
        }),
      ),
    );
    expect(trackEvent).not.toHaveBeenCalledWith(
      "generation_outcome_unresolved",
      expect.anything(),
    );
  });

  it("does not classify editor exit as terminal abandonment while an agent may run", async () => {
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
        "generation_ui_exited",
        expect.objectContaining({
          generation_attempt_id: "attempt-1",
          exit_reason: "route_exit",
          exit_stage: "active",
        }),
      ),
    );
    expect(trackEvent).not.toHaveBeenCalledWith(
      "generation_abandoned",
      expect.anything(),
    );
  });
});
