// @vitest-environment happy-dom

import { AGENT_CHAT_SUBMIT_RESULT_EVENT } from "@agent-native/core/client/agent-chat";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deck: {
    id: "deck-1",
    title: "New deck",
    createdByMe: true,
    aspectRatio: "16:9",
    slides: [] as unknown[],
    generationContext: {
      generationAttemptId: "attempt-1",
      generationMode: undefined as string | undefined,
    },
  },
  broadGenerating: true,
  attemptGenerating: false,
  attemptObservedRun: false,
  attemptTimedOut: false,
  targetTabId: "target-tab",
  scopedCalls: [] as Array<{ attemptId: string | null; tabId: string | null }>,
  startedTabId: null as string | null,
  analyticsSessionId: "session-1",
  updateDeck: vi.fn((_id: string, _changes: Record<string, unknown>) => {}),
  refreshOpenDeck: vi.fn(),
  flushDeckSave: vi.fn(async (_id: string) => {}),
  submitAndConfirm: vi.fn(
    async (
      _message: string,
      _context: string,
      _options?: { submitMessageId?: string },
    ) => ({
      tabId: "target-tab",
      delivered: true,
    }),
  ),
  revision: 0,
  listeners: new Set<() => void>(),
  sendToAgentChat: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/use-agent-generating", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/hooks/use-agent-generating")>();
  const { useSyncExternalStore } = await import("react");

  return {
    ...original,
    getStartedGenerationAttemptTabId: () => mocks.startedTabId,
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
        timedOut: mocks.attemptTimedOut,
        submit: vi.fn(),
        submitAndConfirm: mocks.submitAndConfirm,
      };
    },
  };
});

vi.mock("@/context/DeckContext", () => ({
  useDecks: () => ({
    getDeck: () => mocks.deck,
    reloadDecks: vi.fn(),
    reloadDecksWithStatus: vi.fn(),
    refreshOpenDeck: mocks.refreshOpenDeck,
    updateDeck: mocks.updateDeck,
    updateSlide: vi.fn(),
    updateSlides: vi.fn(),
    deleteSlide: vi.fn(),
    deleteSlides: vi.fn(),
    pasteSlides: vi.fn(),
    duplicateDeck: vi.fn(),
    addSlide: vi.fn(),
    flushDeckSave: mocks.flushDeckSave,
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
  AGENT_CHAT_SUBMIT_TARGET_EVENT: "agentNative.chatSubmitTarget",
  AGENT_CHAT_SUBMIT_RESULT_EVENT: "agentNative.chatSubmitResult",
  sendToAgentChat: mocks.sendToAgentChat,
  useGuidedQuestionFlow: () => ({
    questions: [],
    handleSubmit: vi.fn(),
    handleSkip: vi.fn(),
    refetchPendingQuestion: vi.fn(async () => false),
  }),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
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
vi.mock("@/hooks/use-slide-file-storage-status", () => ({
  useSlideFileStorageStatus: () => ({
    data: { configured: true },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
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
    mocks.deck.generationContext.generationMode = undefined;
    Object.assign(mocks, {
      broadGenerating: true,
      attemptGenerating: false,
      attemptObservedRun: false,
      targetTabId: "target-tab",
      attemptTimedOut: false,
      startedTabId: null,
      analyticsSessionId: "session-1",
      revision: 0,
    });
    mocks.updateDeck.mockReset().mockImplementation((_id, changes) => {
      Object.assign(mocks.deck, changes);
      publishAgentGeneratingChange();
    });
    mocks.flushDeckSave.mockReset().mockResolvedValue(undefined);
    mocks.refreshOpenDeck.mockReset().mockResolvedValue(mocks.deck);
    mocks.submitAndConfirm
      .mockReset()
      .mockResolvedValue({ tabId: "target-tab", delivered: true });
    mocks.deck.generationContext = {
      generationAttemptId: "attempt-1",
      generationMode: undefined,
    };
    mocks.scopedCalls = [];
    mocks.listeners.clear();
    mocks.sendToAgentChat.mockClear();
    mocks.toastError.mockClear();
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

  it("recovers a rejected retry after its rollback save fails and the editor reloads", async () => {
    Object.assign(mocks.deck, {
      generationContext: {
        generationAttemptId: "attempt-1",
        generationFailureCode: "no_output",
        generationFailureAttemptId: "attempt-1",
      },
    });
    mocks.flushDeckSave
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("rollback save failed"))
      .mockResolvedValueOnce(undefined);
    mocks.submitAndConfirm.mockResolvedValueOnce({
      tabId: "retry-tab",
      delivered: false,
    });
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1?source=history"] },
    );

    render(<RouterProvider router={router} />);
    await act(async () => {
      screen.getByRole("button", { name: "deckEditor.tryAgain" }).click();
    });

    const recoveryKey = "slides:empty-generation-retry-recovery:deck-1";
    await waitFor(() =>
      expect(window.localStorage.getItem(recoveryKey)).not.toBeNull(),
    );
    const recovery = JSON.parse(
      window.localStorage.getItem(recoveryKey) ?? "{}",
    ) as {
      kind: string;
      retryAttemptId: string;
      restoreAttemptId: string;
      ownerTabId: string;
      restoreSearchParams: string;
    };
    expect(recovery.kind).toBe("retry_rollback");
    expect(recovery.restoreAttemptId).toBe("attempt-1");
    expect(recovery.ownerTabId).toEqual(expect.any(String));
    expect(recovery.restoreSearchParams).toBe("source=history");

    cleanup();
    router?.dispose();
    router = undefined;
    Object.assign(mocks.deck, {
      generationContext: {
        generationAttemptId: recovery.retryAttemptId,
        generationFailureCode: "no_output",
        generationFailureAttemptId: "attempt-1",
      },
    });
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      {
        initialEntries: [
          `/deck/deck-1?source=history&generating=1&generation_attempt_id=${recovery.retryAttemptId}&generationSubmitId=submit-1`,
        ],
      },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(mocks.deck.generationContext.generationAttemptId).toBe(
        "attempt-1",
      ),
    );
    await waitFor(() =>
      expect(window.localStorage.getItem(recoveryKey)).toBeNull(),
    );
    expect(router.state.location.search).toBe("?source=history");
    expect(mocks.flushDeckSave).toHaveBeenCalledTimes(3);
    expect(
      (
        screen.getByRole("button", {
          name: "deckEditor.tryAgain",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("recovers legacy retry journals and keeps unrelated query parameters", async () => {
    Object.assign(mocks.deck, {
      generationContext: {
        generationAttemptId: "attempt-2",
        generationFailureCode: "no_output",
        generationFailureAttemptId: "attempt-1",
      },
    });
    const recoveryKey = "slides:empty-generation-retry-recovery:deck-1";
    window.localStorage.setItem(
      recoveryKey,
      JSON.stringify({
        retryAttemptId: "attempt-2",
        restoreAttemptId: "attempt-1",
      }),
    );
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      {
        initialEntries: [
          "/deck/deck-1?source=history&generating=1&generation_attempt_id=attempt-2&generationSubmitId=legacy-submit",
        ],
      },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(mocks.deck.generationContext.generationAttemptId).toBe(
        "attempt-1",
      ),
    );
    await waitFor(() =>
      expect(window.localStorage.getItem(recoveryKey)).toBeNull(),
    );
    expect(router.state.location.search).toBe("?source=history");
  });

  it("keeps a newer retry journal when an older editor tab has stale context", async () => {
    const recoveryKey = "slides:empty-generation-retry-recovery:deck-1";
    const serializedRecovery = JSON.stringify({
      kind: "retry_rollback",
      retryAttemptId: "attempt-2",
      restoreAttemptId: "attempt-1",
    });
    window.localStorage.setItem(recoveryKey, serializedRecovery);
    Object.assign(mocks.deck, {
      generationContext: {
        generationAttemptId: "attempt-1",
        generationFailureCode: "no_output",
        generationFailureAttemptId: "attempt-1",
      },
    });
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1?source=history"] },
    );

    render(<RouterProvider router={router} />);

    expect(window.localStorage.getItem(recoveryKey)).toBe(serializedRecovery);
  });

  it("limits retry rollback recovery to the submitting tab", async () => {
    const recoveryKey = "slides:empty-generation-retry-recovery:deck-1";
    const ownerKey = "slides:empty-generation-retry-owner:deck-1";
    const serializedRecovery = JSON.stringify({
      kind: "retry_rollback",
      retryAttemptId: "attempt-2",
      restoreAttemptId: "attempt-1",
      ownerTabId: "retry-owner-tab",
      restoreSearchParams: "source=history",
    });
    window.localStorage.setItem(recoveryKey, serializedRecovery);
    window.sessionStorage.setItem(ownerKey, "other-editor-tab");
    Object.assign(mocks.deck, {
      generationContext: {
        generationAttemptId: "attempt-2",
        generationFailureCode: "no_output",
        generationFailureAttemptId: "attempt-1",
      },
    });
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1?source=history"] },
    );

    render(<RouterProvider router={router} />);

    expect(mocks.deck.generationContext.generationAttemptId).toBe("attempt-2");
    expect(window.localStorage.getItem(recoveryKey)).toBe(serializedRecovery);

    cleanup();
    router?.dispose();
    router = undefined;
    window.sessionStorage.setItem(ownerKey, "retry-owner-tab");
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1?source=history"] },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(mocks.deck.generationContext.generationAttemptId).toBe(
        "attempt-1",
      ),
    );
    await waitFor(() =>
      expect(window.localStorage.getItem(recoveryKey)).toBeNull(),
    );
  });

  it("persists the retry tab mapping before a synchronous submit-target event", async () => {
    Object.assign(mocks.deck, {
      generationContext: {
        generationAttemptId: "attempt-1",
        generationFailureCode: "no_output",
        generationFailureAttemptId: "attempt-1",
      },
    });
    mocks.submitAndConfirm.mockImplementationOnce(
      async (_message, _context, options) => {
        window.dispatchEvent(
          new CustomEvent("agentNative.chatSubmitTarget", {
            detail: {
              submitMessageId: options?.submitMessageId,
              tabId: "retry-tab",
            },
          }),
        );
        return { tabId: "retry-tab", delivered: true };
      },
    );
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1"] },
    );

    render(<RouterProvider router={router} />);
    await act(async () => {
      screen.getByRole("button", { name: "deckEditor.tryAgain" }).click();
    });

    const submitMessageId = new URLSearchParams(
      router.state.location.search,
    ).get("generationSubmitId");
    expect(submitMessageId).toBeTruthy();
    expect(
      window.sessionStorage.getItem(
        `slides:new-deck-generation:deck-1:${submitMessageId}`,
      ),
    ).toBe("retry-tab");
  });

  it("shows feedback when retry delivery is rejected", async () => {
    Object.assign(mocks.deck, {
      generationContext: {
        generationAttemptId: "attempt-1",
        generationFailureCode: "no_output",
        generationFailureAttemptId: "attempt-1",
      },
    });
    mocks.submitAndConfirm.mockResolvedValueOnce({
      tabId: "retry-tab",
      delivered: false,
    });
    const toastError = vi.spyOn(toast, "error");
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1"] },
    );

    render(<RouterProvider router={router} />);
    await act(async () => {
      screen.getByRole("button", { name: "deckEditor.tryAgain" }).click();
    });

    expect(toastError).toHaveBeenCalledWith("home.generationStartFailed");
    expect(mocks.deck.generationContext).toMatchObject({
      generationAttemptId: "attempt-1",
      generationFailureCode: "no_output",
      generationFailureAttemptId: "attempt-1",
    });
  });

  it("recovers an accepted retry after its failure-marker save fails and reloads", async () => {
    Object.assign(mocks.deck, {
      generationContext: {
        generationAttemptId: "attempt-1",
        generationFailureCode: "no_output",
        generationFailureAttemptId: "attempt-1",
      },
    });
    mocks.flushDeckSave
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("accepted retry save failed"))
      .mockResolvedValueOnce(undefined);
    let recoveryAtSubmit: unknown;
    let recoveryAtConfirmation: unknown;
    mocks.submitAndConfirm.mockImplementation(
      async (_message, _context, options) => {
        recoveryAtSubmit = JSON.parse(
          window.localStorage.getItem(
            "slides:empty-generation-retry-recovery:deck-1",
          ) ?? "null",
        );
        window.dispatchEvent(
          new CustomEvent(AGENT_CHAT_SUBMIT_RESULT_EVENT, {
            detail: {
              submitMessageId: options?.submitMessageId,
              delivered: true,
            },
          }),
        );
        recoveryAtConfirmation = JSON.parse(
          window.localStorage.getItem(
            "slides:empty-generation-retry-recovery:deck-1",
          ) ?? "null",
        );
        return { tabId: "retry-tab", delivered: true };
      },
    );
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1"] },
    );

    render(<RouterProvider router={router} />);
    await act(async () => {
      screen.getByRole("button", { name: "deckEditor.tryAgain" }).click();
    });

    expect(recoveryAtSubmit).toMatchObject({ kind: "retry_rollback" });
    expect(recoveryAtConfirmation).toMatchObject({ kind: "retry_accepted" });
    const recoveryKey = "slides:empty-generation-retry-recovery:deck-1";
    const acceptedRecovery = JSON.parse(
      window.localStorage.getItem(recoveryKey) ?? "{}",
    ) as { kind: string; retryAttemptId: string };
    expect(acceptedRecovery.kind).toBe("retry_accepted");

    cleanup();
    router?.dispose();
    router = undefined;
    Object.assign(mocks.deck, {
      generationContext: {
        generationAttemptId: acceptedRecovery.retryAttemptId,
        generationFailureCode: "no_output",
        generationFailureAttemptId: "attempt-1",
      },
    });
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1"] },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(mocks.deck.generationContext).toMatchObject({
        generationFailureCode: null,
        generationFailureAttemptId: null,
      }),
    );
    await waitFor(() =>
      expect(window.localStorage.getItem(recoveryKey)).toBeNull(),
    );
    expect(mocks.flushDeckSave).toHaveBeenCalledTimes(3);
  });

  it("recovers an empty-deck failure after its terminal save fails and reloads", async () => {
    mocks.flushDeckSave.mockRejectedValueOnce(new Error("failure save failed"));
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
    });
    mocks.attemptGenerating = false;
    act(publishAgentGeneratingChange);

    const recoveryKey = "slides:empty-generation-retry-recovery:deck-1";
    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem(recoveryKey) ?? "null"),
      ).toEqual({
        kind: "generation_failure",
        attemptId: "attempt-1",
        failureCode: "no_output",
      }),
    );

    cleanup();
    router?.dispose();
    router = undefined;
    mocks.attemptObservedRun = false;
    mocks.deck.generationContext = {
      generationAttemptId: "attempt-1",
      generationMode: undefined,
    };
    mocks.flushDeckSave.mockReset().mockResolvedValue(undefined);
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      { initialEntries: ["/deck/deck-1"] },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(mocks.deck.generationContext).toMatchObject({
        generationAttemptId: "attempt-1",
        generationFailureCode: "no_output",
        generationFailureAttemptId: "attempt-1",
      }),
    );
    await waitFor(() =>
      expect(window.localStorage.getItem(recoveryKey)).toBeNull(),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "deckEditor.tryAgain",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("restores retry run tracking from the persisted submit-to-tab mapping", async () => {
    const submitMessageId = "retry-submit";
    const tabId = "retry-tab";
    mocks.deck.generationContext = {
      generationAttemptId: "retry-attempt",
      generationMode: undefined,
    };
    mocks.targetTabId = tabId;
    mocks.attemptGenerating = true;
    mocks.attemptObservedRun = true;
    window.sessionStorage.setItem(
      `slides:new-deck-generation:deck-1:${submitMessageId}`,
      tabId,
    );
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      {
        initialEntries: [
          `/deck/deck-1?generating=1&generation_attempt_id=retry-attempt&generationSubmitId=${submitMessageId}`,
        ],
      },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() =>
      expect(mocks.scopedCalls).toContainEqual({
        attemptId: "retry-attempt",
        tabId,
      }),
    );

    mocks.attemptGenerating = false;
    act(publishAgentGeneratingChange);

    await waitFor(() =>
      expect(mocks.deck.generationContext).toMatchObject({
        generationAttemptId: "retry-attempt",
        generationFailureCode: "no_output",
        generationFailureAttemptId: "retry-attempt",
      }),
    );
    expect(trackEvent).toHaveBeenCalledWith(
      "generation_failed",
      expect.objectContaining({
        generation_attempt_id: "retry-attempt",
        failure_code: "no_output",
      }),
    );
  });

  it("offers a stalled action-owned generation in its original chat", async () => {
    mocks.attemptTimedOut = true;
    mocks.startedTabId = "target-tab";
    mocks.deck.generationContext.generationMode = "action";
    router = createMemoryRouter(
      [{ path: "/deck/:id", element: <DeckEditor /> }],
      {
        initialEntries: [
          "/deck/deck-1?generating=1&generation_attempt_id=attempt-1",
        ],
      },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "deckEditor.generationStalled",
        expect.objectContaining({
          description: "deckEditor.generationStalledDescription",
          action: expect.objectContaining({
            label: "deckEditor.continueInChat",
            onClick: expect.any(Function),
          }),
        }),
      ),
    );

    const options = mocks.toastError.mock.calls[0]?.[1] as {
      action: { onClick: () => void };
    };
    act(() => options.action.onClick());

    expect(mocks.sendToAgentChat).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "deckEditor.continueGenerationPrompt",
        context: expect.stringContaining("Deck ID: deck-1"),
        submit: true,
        openSidebar: true,
        targetTabId: "target-tab",
      }),
    );
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
