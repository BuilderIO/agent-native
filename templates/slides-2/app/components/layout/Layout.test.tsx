/* @vitest-environment happy-dom */
import type { AgentPanelProps } from "@agent-native/toolkit/app/chat";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const {
  agentSidebarMock,
  navigateChatMock,
  flushDeckSaveMock,
  toastErrorMock,
  useDecksMock,
  creativeContextLabEnabled,
  mcpAppWidgetEmbed,
  useRealAgentSidebar,
  sidebarSnapshot,
  sendToAgentChatMock,
  useActionQueryMock,
  threadList,
} = vi.hoisted(() => ({
  mcpAppWidgetEmbed: { value: false },
  useRealAgentSidebar: { value: false },
  sidebarSnapshot: { value: null as unknown },
  agentSidebarMock: vi.fn(),
  navigateChatMock: vi.fn(),
  flushDeckSaveMock: vi.fn(),
  toastErrorMock: vi.fn(),
  useDecksMock: vi.fn(),
  creativeContextLabEnabled: { value: false },
  sendToAgentChatMock: vi.fn(),
  useActionQueryMock: vi.fn(),
  threadList: {
    threads: [
      {
        id: "thread-1",
        title: "Launch brief",
        preview: "Create a launch brief",
        messageCount: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ],
    activeThreadId: "thread-1",
    isLoading: false,
    evictedThreadIds: [],
    createThread: vi.fn(async (id?: string) => id ?? "thread-2"),
    openThread: vi.fn(async () => "opened" as const),
    switchThread: vi.fn(),
    detachThread: vi.fn(),
    forkThread: vi.fn(),
    saveThreadData: vi.fn(async () => true),
    generateTitle: vi.fn(async () => null),
    searchThreads: vi.fn(async () => []),
    refreshThreads: vi.fn(async () => undefined),
    loadMoreThreads: vi.fn(async () => undefined),
    hasMoreThreads: false,
    isLoadingMoreThreads: false,
    threadsLoadError: false,
    restoredThreadIdOnListFailure: null,
    isNewThread: vi.fn(() => false),
    isThreadPersisted: vi.fn(() => true),
    confirmThreadSnapshotPersisted: vi.fn(),
    pinThread: vi.fn(async () => true),
    renameThread: vi.fn(async () => true),
  },
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  fetchAgentEngineConfiguredState: async () => "unavailable",
  isAgentChatHomeHandoffActive: vi.fn(() => false),
  navigateWithAgentChatViewTransition: navigateChatMock,
  sendToAgentChat: sendToAgentChatMock,
  useAgentChatHomeHandoff: vi.fn(() => false),
  useAgentChatHomeHandoffLinks: vi.fn(),
  useAgentEngineConfigured: () => ({
    canChat: useRealAgentSidebar.value,
    missing: false,
    state: useRealAgentSidebar.value ? "configured" : "unknown",
  }),
  useAgentChatContext: () => ({ items: [] }),
  useChatThreads: () => threadList,
  useDevMode: () => ({ isDevMode: false }),
  useChatModels: () => ({
    availableModels: [],
    configuredModels: [],
    defaultModel: "",
    selectedModel: "",
    selectedEngine: "",
    selectedEffort: "medium",
    isLoading: false,
    selectionReady: false,
    unavailableSelection: null,
    onModelChange: vi.fn(),
    onEffortChange: vi.fn(),
    refreshEngines: vi.fn(),
  }),
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: useActionQueryMock,
}));
vi.mock("@agent-native/core/client/mcp-app-host", () => ({
  useIsMcpAppWidgetEmbed: () => mcpAppWidgetEmbed.value,
}));
vi.mock("@agent-native/toolkit/app/chat", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/toolkit/app/chat")>();
  return {
    ...actual,
    AgentSidebar: (props: ComponentProps<typeof actual.AgentSidebar>) => {
      agentSidebarMock(props);
      if (useRealAgentSidebar.value) {
        return (
          <div data-testid="agent-sidebar">
            {props.children}
            <div className="agent-sidebar-panel">
              <actual.AgentChatSurface
                createTransport={createSidebarTransport}
                defaultMode="chat"
                restoreActiveThread={false}
                showGuidedQuestions={false}
                showModelSelector={false}
                showTabBar={false}
              />
            </div>
          </div>
        );
      }
      return (
        <div data-testid="agent-sidebar">
          {props.composerSlot}
          {props.children}
        </div>
      );
    },
    focusAgentChat: vi.fn(),
  };
});
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, values?: Record<string, unknown>) =>
    ({
      "agent.slideNumber": `Slide ${values?.number}`,
      "deckEditor.applyResult": "Apply",
      "deckEditor.continueInChat": "Continue in chat",
      "deckEditor.regenerateResult": "Regenerate",
      "deckResult.saved": "Saved",
      "history.slideCount": `${values?.count} slides`,
    })[key] ?? key,
}));
vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));
vi.mock("@agent-native/toolkit/app/org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/toolkit/app/org")>()),
  InvitationBanner: () => <div data-testid="invitation-banner" />,
}));
vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextComposerChip: () => (
    <div data-testid="creative-context-composer-chip" />
  ),
  useCreativeContextLab: () => creativeContextLabEnabled.value,
}));
vi.mock("@agent-native/toolkit/app-shell", () => ({
  HeaderActionsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@shared/google-docs", () => ({
  extractGoogleSlidesUrls: () => [],
}));
vi.mock("@tabler/icons-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tabler/icons-react")>()),
  IconBulb: () => <span data-testid="bulb-icon" />,
  IconMenu2: () => <span data-testid="menu-icon" />,
}));
vi.mock("@/context/DeckContext", () => ({ useDecks: useDecksMock }));
vi.mock("@/hooks/use-sidebar-collapsed", () => ({
  useSidebarCollapsed: () => ({ collapsed: false, setCollapsed: vi.fn() }),
}));
vi.mock("@/lib/tab-id", () => ({ TAB_ID: "slides-test" }));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: {
      authUserId: "user-1",
      email: "first@example.test",
      orgId: "workspace-1",
    },
    status: "authenticated",
  }),
}));
vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => ({
    data: { configured: true },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
vi.mock("../editor/GoogleDriveConnectionCta", () => ({
  GoogleDriveConnectionCta: () => null,
}));
vi.mock("../editor/SlidesComposerContextProvider", () => ({
  SlidesComposerContextProvider: () => null,
}));
vi.mock("./AgentWorkIndicator", () => ({
  AgentWorkIndicator: () => <div data-testid="agent-work-indicator" />,
}));
vi.mock("./Header", () => ({ Header: () => <div data-testid="header" /> }));
vi.mock("./Sidebar", () => ({
  Sidebar: () => <aside data-testid="app-sidebar" />,
}));

import { SLIDES_DECK_RESULT_RENDERER } from "@shared/action-ui";

import {
  publishSlidesSelection,
  readPublishedSlidesSelection,
} from "@/lib/slide-agent-context";
import "@/lib/register-chat-renderers";

import { Layout } from "./Layout";

type SidebarTransportFactory = NonNullable<AgentPanelProps["createTransport"]>;
type SidebarTransport = ReturnType<SidebarTransportFactory>;
type SidebarThreadSnapshot = NonNullable<
  Awaited<ReturnType<NonNullable<SidebarTransport["getThreadSnapshot"]>>>
>;

function createSidebarTransport(): SidebarTransport {
  return {
    getThreadSnapshot: async ({ threadId }) => {
      const snapshot = sidebarSnapshot.value as { id?: unknown } | null;
      return snapshot?.id === threadId
        ? (snapshot as SidebarThreadSnapshot)
        : null;
    },
    startRun: vi.fn(async () => ({ runId: "unused-run" })),
    async *subscribeToRun() {},
    cancelRun: vi.fn(async () => undefined),
    assertAiSetupReady: vi.fn(async () => undefined),
  } as SidebarTransport;
}

function savedSlidesResultSnapshot(): SidebarThreadSnapshot {
  const capturedAt = "2026-10-20T12:00:00.000Z";
  const toolCall = {
    id: "tool-create-deck",
    name: "create-deck",
    input: {
      promptDraft: {
        generationContext: { originalPrompt: "Create a launch brief" },
      },
    },
    output: {
      id: "deck-1",
      title: "Launch brief",
      slideCount: 3,
      slides: [
        {
          id: "slide-1",
          layout: "content",
          content: '<div class="fmd-slide"><h1>Launch</h1></div>',
        },
        {
          id: "slide-2",
          layout: "content",
          content: '<div class="fmd-slide"><h1>Audience</h1></div>',
        },
        {
          id: "slide-3",
          layout: "content",
          content: '<div class="fmd-slide"><h1>Plan</h1></div>',
        },
      ],
    },
    status: "completed",
    runId: "run-1",
    messageId: "assistant-1",
    metadata: { chatUI: { renderer: SLIDES_DECK_RESULT_RENDERER } },
  };
  const event = (sequence: number, body: Record<string, unknown>) => ({
    ...body,
    id: `event-${sequence}`,
    threadId: "thread-1",
    runId: "run-1",
    sequence,
    occurredAt: capturedAt,
  });

  return {
    id: "thread-1",
    title: "Launch brief",
    createdAt: capturedAt,
    updatedAt: capturedAt,
    messages: [
      {
        id: "user-1",
        role: "user",
        status: "complete",
        createdAt: capturedAt,
        parts: [{ type: "text", text: "Create a launch brief" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        status: "complete",
        createdAt: capturedAt,
        parts: [{ type: "text", text: "Your launch brief is ready." }],
      },
    ],
    events: [
      event(1, { type: "run.started" }),
      event(2, {
        type: "tool.started",
        toolCall: { ...toolCall, status: "running" },
      }),
      event(3, { type: "tool.updated", toolCall }),
      event(4, { type: "run.completed" }),
    ],
    runs: [
      {
        id: "run-1",
        threadId: "thread-1",
        status: "completed",
        lastSequence: 4,
        startedAt: capturedAt,
        completedAt: capturedAt,
      },
    ],
    toolCalls: [toolCall],
  } as unknown as SidebarThreadSnapshot;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  publishSlidesSelection(null);
  Reflect.deleteProperty(window, "ReactNativeWebView");
});

function renderLayout(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Layout>
        <div data-testid="page-content">Content</div>
      </Layout>
      <NavigateAway />
    </MemoryRouter>,
  );
}

function NavigateAway() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/")}>
      Navigate away
    </button>
  );
}

function CurrentPath() {
  const location = useLocation();
  return (
    <output data-testid="current-path">
      {`${location.pathname}${location.search}`}
    </output>
  );
}

describe("Slides Layout", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ runs: [] })),
    );
    agentSidebarMock.mockClear();
    navigateChatMock.mockClear();
    flushDeckSaveMock.mockReset().mockResolvedValue(undefined);
    toastErrorMock.mockReset();
    useDecksMock.mockReturnValue({
      decks: [],
      loading: false,
      flushDeckSave: flushDeckSaveMock,
    });
    creativeContextLabEnabled.value = false;
    mcpAppWidgetEmbed.value = false;
    useRealAgentSidebar.value = false;
    sidebarSnapshot.value = null;
    sendToAgentChatMock.mockReset();
    useActionQueryMock.mockReset().mockReturnValue({
      data: undefined,
      isPending: false,
    });
  });

  it("renders only the page inside an MCP App widget, with no app chrome", () => {
    mcpAppWidgetEmbed.value = true;
    renderLayout("/deck/deck-1");

    expect(screen.getByTestId("page-content")).toBeTruthy();
    expect(screen.queryByTestId("agent-sidebar")).toBeNull();
    expect(screen.queryByTestId("app-sidebar")).toBeNull();
    expect(screen.queryByTestId("header")).toBeNull();
    expect(screen.queryByTestId("menu-icon")).toBeNull();
    expect(screen.queryByTestId("agent-work-indicator")).toBeNull();
    expect(agentSidebarMock).not.toHaveBeenCalled();
  });

  it("keeps the app chrome outside an MCP App widget", () => {
    renderLayout("/home");

    expect(screen.getByTestId("agent-sidebar")).toBeTruthy();
    expect(screen.getByTestId("app-sidebar")).toBeTruthy();
  });

  it("renders registered Slides results in the real right sidebar", async () => {
    useRealAgentSidebar.value = true;
    sidebarSnapshot.value = savedSlidesResultSnapshot();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Layout>
              <div data-testid="page-content">Content</div>
            </Layout>
            <CurrentPath />
          </TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const previewStrip = await waitFor(() => {
      const strip = document.querySelector("[data-slides-deck-preview-strip]");
      expect(strip).not.toBeNull();
      return strip;
    });
    expect(document.querySelector(".agent-sidebar-panel")).not.toBeNull();
    expect(previewStrip?.querySelectorAll("iframe")).toHaveLength(3);
    expect(document.body.textContent).toContain("Launch brief");
    expect(screen.getByRole("link", { name: "Apply" })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Apply" }));
    expect(screen.getByTestId("current-path").textContent).toBe("/deck/deck-1");

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(sendToAgentChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Regenerate this saved deck"),
        context: expect.stringContaining('"deckId":"deck-1"'),
        submit: true,
        openSidebar: true,
        chatTarget: "local",
      }),
    );
  });

  it("hides the Creative Context composer chip until its lab is enabled", () => {
    const offRender = renderLayout("/");
    expect(screen.queryByTestId("creative-context-composer-chip")).toBeNull();
    offRender.unmount();

    creativeContextLabEnabled.value = true;
    renderLayout("/");
    expect(screen.getByTestId("creative-context-composer-chip")).toBeTruthy();
  });

  it.each([
    ["thread/one", "/chat/thread%2Fone?deckId=deck-1"],
    [undefined, "/chat?deckId=deck-1"],
  ])(
    "opens fullscreen with thread %s while retaining deck context",
    (threadId, path) => {
      renderLayout("/deck/deck-1");
      const props = agentSidebarMock.mock.lastCall![0];
      expect(props.storageKey).toBeUndefined();
      act(() => props.onFullscreenRequest(threadId));
      expect(navigateChatMock).toHaveBeenCalledWith(expect.any(Function), path);
    },
  );

  it("enables agent-panel auto-open only during a run", () => {
    renderLayout("/");

    expect(agentSidebarMock).toHaveBeenCalledWith(
      expect.objectContaining({ openOnChatRunning: false }),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "chat-a" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "chat-b" },
        }),
      );
    });
    expect(agentSidebarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ openOnChatRunning: true }),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "chat-a" },
        }),
      );
    });
    expect(agentSidebarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ openOnChatRunning: true }),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "chat-b" },
        }),
      );
    });
    expect(agentSidebarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ openOnChatRunning: false }),
    );
  });

  it("clears running tabs when leaving full-page chat", () => {
    renderLayout("/chat");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "chat-a" },
        }),
      );
    });

    act(() => {
      screen.getByRole("button", { name: "Navigate away" }).click();
    });

    expect(agentSidebarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ openOnChatRunning: false }),
    );
  });

  it("keeps the app shell visible on the empty root route", () => {
    renderLayout("/");

    expect(screen.getByTestId("app-sidebar")).toBeTruthy();
    expect(screen.getByTestId("header")).toBeTruthy();
    expect(screen.getByTestId("invitation-banner")).toBeTruthy();
    expect(screen.getByTestId("agent-work-indicator")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "sidebar.openNavigation" }),
    ).toBeTruthy();
    expect(screen.getByTestId("page-content")).toBeTruthy();
  });

  it("opens the mobile navigation by keyboard and returns focus after Escape", async () => {
    renderLayout("/");

    const opener = screen.getByRole("button", {
      name: "sidebar.openNavigation",
    });
    opener.focus();
    fireEvent.keyDown(opener, { key: "Enter", code: "Enter" });
    fireEvent.keyUp(opener, { key: "Enter", code: "Enter" });
    fireEvent.click(opener, { detail: 0 });

    const dialog = await screen.findByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("preserves the deck route toolbar boundary", () => {
    renderLayout("/deck/deck-1");

    expect(screen.queryByTestId("app-sidebar")).toBeNull();
    expect(screen.queryByTestId("header")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "sidebar.openNavigation" }),
    ).toBeNull();
    expect(screen.getByTestId("page-content")).toBeTruthy();
  });

  it("blocks deck chat when flushing the save fails", async () => {
    const error = new Error("save failed");
    flushDeckSaveMock.mockRejectedValueOnce(error);
    renderLayout("/deck/deck-1");

    const history = agentSidebarMock.mock.lastCall![0].chatHistory as {
      beforeStart: () => Promise<void>;
    };
    const startRun = vi.fn();
    await expect(
      (async () => {
        await history.beforeStart();
        startRun();
      })(),
    ).rejects.toBe(error);
    expect(startRun).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("settings.saveFailed");
  });

  it("blocks deck chat after a terminal typed save failure", async () => {
    const error = Object.assign(new Error("Failed to save deck deck-1"), {
      status: 400,
      errorCode: "slide_content_hash_required",
    });
    flushDeckSaveMock.mockRejectedValueOnce(error);
    renderLayout("/deck/deck-1");

    const history = agentSidebarMock.mock.lastCall![0].chatHistory as {
      beforeStart: () => Promise<void>;
    };
    const startRun = vi.fn();
    await expect(
      (async () => {
        await history.beforeStart();
        startRun();
      })(),
    ).rejects.toBe(error);
    expect(startRun).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("settings.saveFailed");
  });

  it("keeps malformed chat history distinct from an empty version list", () => {
    renderLayout("/deck/deck-1");

    const history = agentSidebarMock.mock.lastCall![0].chatHistory as {
      list: { getVersions: (result: unknown) => unknown };
    };

    expect(history.list.getVersions({ versions: [] })).toEqual([]);
    expect(history.list.getVersions({ versions: null })).toBeNull();
  });

  it("acknowledges a mobile flush only after the matching deck is saved", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, "ReactNativeWebView", {
      configurable: true,
      value: { postMessage },
    });
    renderLayout("/deck/deck-1");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.mobileDeckSaveFlush", {
          detail: { requestId: "request-1", deckId: "deck-1" },
        }),
      );
    });

    await waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
    expect(flushDeckSaveMock).toHaveBeenCalledWith("deck-1");
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({
      type: "agentNative.mobileDeckSaveFlush.ack",
      requestId: "request-1",
      requestedDeckId: "deck-1",
      activeDeckId: "deck-1",
      status: "flushed",
    });
  });

  it("reports nonmatching Slides routes without flushing another deck", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, "ReactNativeWebView", {
      configurable: true,
      value: { postMessage },
    });
    renderLayout("/deck/deck-2");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.mobileDeckSaveFlush", {
          detail: { requestId: "request-2", deckId: "deck-1" },
        }),
      );
    });

    expect(postMessage).toHaveBeenCalledOnce();
    expect(flushDeckSaveMock).not.toHaveBeenCalled();
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({
      type: "agentNative.mobileDeckSaveFlush.ack",
      requestId: "request-2",
      requestedDeckId: "deck-1",
      activeDeckId: "deck-2",
      status: "not-target",
    });
  });

  it("never acknowledges a failed deck save as flushed", async () => {
    flushDeckSaveMock.mockRejectedValueOnce(new Error("save failed"));
    const postMessage = vi.fn();
    Object.defineProperty(window, "ReactNativeWebView", {
      configurable: true,
      value: { postMessage },
    });
    renderLayout("/deck/deck-1");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.mobileDeckSaveFlush", {
          detail: { requestId: "request-3", deckId: "deck-1" },
        }),
      );
    });

    await waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
    expect(JSON.parse(postMessage.mock.calls[0][0])).toMatchObject({
      requestedDeckId: "deck-1",
      activeDeckId: "deck-1",
      status: "failed",
    });
  });

  it("updates the agent scope label as the current slide changes", () => {
    renderLayout("/deck/deck-1");

    expect(agentSidebarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dynamicSuggestions: false,
        scope: expect.objectContaining({ label: "agent.thisSlide" }),
      }),
    );

    act(() => {
      publishSlidesSelection({
        deckId: "deck-1",
        slideId: "slide-2",
        slideIndex: 1,
        slideNumber: 2,
        items: [],
      });
    });
    expect(agentSidebarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ label: "Slide 2" }),
      }),
    );

    act(() => {
      publishSlidesSelection({
        deckId: "deck-1",
        slideId: "slide-5",
        slideIndex: 4,
        slideNumber: 5,
        items: [],
      });
    });
    expect(agentSidebarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ label: "Slide 5" }),
      }),
    );
  });

  it("keeps chat scope renders stable while the caret moves within a target", () => {
    renderLayout("/deck/deck-1");

    const selection = {
      deckId: "deck-1",
      slideId: "slide-1",
      slideNumber: 1,
      items: [{ objectId: "text-1", textPreview: "first" }],
    };
    act(() => publishSlidesSelection(selection));
    const callsAfterTargetSelection = agentSidebarMock.mock.calls.length;

    act(() =>
      publishSlidesSelection({
        ...selection,
        items: [{ objectId: "text-1", textPreview: "second" }],
      }),
    );

    expect(agentSidebarMock).toHaveBeenCalledTimes(callsAfterTargetSelection);
    expect(readPublishedSlidesSelection()?.items).toEqual([
      { objectId: "text-1", textPreview: "second" },
    ]);

    act(() =>
      publishSlidesSelection({
        ...selection,
        items: [{ objectId: "text-2", textPreview: "second" }],
      }),
    );

    expect(agentSidebarMock.mock.calls.length).toBeGreaterThan(
      callsAfterTargetSelection,
    );
    expect(agentSidebarMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        scope: expect.objectContaining({
          context: expect.stringContaining("Selected element targets: text-2."),
        }),
      }),
    );
  });

  it("gives Settings the full width", () => {
    renderLayout("/settings/notifications");

    expect(screen.getByTestId("agent-sidebar")).toBeTruthy();
    expect(screen.queryByTestId("app-sidebar")).toBeNull();
    expect(screen.queryByTestId("header")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "sidebar.openNavigation" }),
    ).toBeNull();
    expect(screen.getByTestId("page-content")).toBeTruthy();
  });

  it("renders full-page chat without the sidebar wrapper", () => {
    renderLayout("/chat");

    expect(screen.queryByTestId("agent-sidebar")).toBeNull();
    expect(screen.queryByTestId("agent-work-indicator")).toBeNull();
    expect(screen.getByTestId("app-sidebar")).toBeTruthy();
    expect(screen.getByTestId("page-content")).toBeTruthy();
  });
});
