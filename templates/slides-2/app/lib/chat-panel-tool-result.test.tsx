// @vitest-environment happy-dom

import {
  AgentChatSurface,
  type AgentPanelProps,
} from "@agent-native/toolkit/app/chat";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const chatMocks = vi.hoisted(() => ({
  sendToAgentChat: vi.fn(),
  useActionQuery: vi.fn(),
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

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: chatMocks.useActionQuery,
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  sendToAgentChat: chatMocks.sendToAgentChat,
  useChatThreads: () => chatMocks.threadList,
  useAgentChatContext: () => ({ items: [] }),
  useDevMode: () => ({ isDevMode: false }),
  useAgentEngineConfigured: () => ({
    canChat: true,
    missing: false,
    state: "configured",
  }),
  createAgentNativeAgentKitTransport: () => ({
    persistThreadSnapshot: vi.fn(async () => undefined),
  }),
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  DEFAULT_LOCALE: "en",
  useT: () => (key: string, values?: Record<string, unknown>) => {
    const translations: Record<string, string> = {
      "history.slideCount": `${values?.count} slides`,
      "agent.slideNumber": `Slide ${values?.number}`,
      "deckResult.saved": "Saved",
      "deckEditor.accessApprovalOpenDeck": "Open deck",
      "deckEditor.applyResult": "Apply",
      "deckEditor.continueInChat": "Continue in chat",
      "deckEditor.regenerateResult": "Regenerate",
    };
    return translations[key] ?? key;
  },
  useFormatters: () => ({
    formatDate: (value: string | Date) =>
      value instanceof Date ? value.toISOString() : value,
    formatNumber: String,
  }),
  useOptionalLocale: () => undefined,
}));

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

vi.mock("@/components/slides-2-runtime/SandboxedSlide", () => ({
  SandboxedSlide: ({
    artifact,
    title,
  }: {
    artifact: { html: string; slideId: string };
    title: string;
  }) => (
    <iframe
      title={title}
      sandbox="allow-scripts"
      data-worker-slide={artifact.slideId}
      srcDoc={artifact.html}
    />
  ),
}));

import { SLIDES_DECK_RESULT_RENDERER } from "@shared/action-ui";

import "./register-chat-renderers.js";

const capturedAt = "2026-10-20T12:00:00.000Z";

type Slides2TransportFactory = NonNullable<AgentPanelProps["createTransport"]>;
type Slides2Transport = ReturnType<Slides2TransportFactory>;
type Slides2ThreadSnapshot = NonNullable<
  Awaited<ReturnType<NonNullable<Slides2Transport["getThreadSnapshot"]>>>
>;
const deckResult = {
  id: "deck/1",
  title: "Launch brief",
  slideCount: 12,
  slides: Array.from({ length: 4 }, (_, index) => ({
    id: `slide-${index + 1}`,
    layout: "content",
    content: `<div class="fmd-slide"><h1>Slide ${index + 1}</h1></div>`,
  })),
};

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="current-path">
      {`${location.pathname}${location.search}`}
    </output>
  );
}

function persistedToolSnapshot(override?: {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  renderer?: string;
}): Slides2ThreadSnapshot {
  const tool = {
    id: `tool-${override?.name ?? "create-deck"}`,
    name: override?.name ?? "create-deck",
    input: override?.input ?? {
      promptDraft: {
        generationContext: { originalPrompt: "Create a launch brief" },
      },
    },
    output: override?.output ?? deckResult,
    status: "completed",
    runId: "run-1",
    messageId: "assistant-1",
    ...(!override || override.renderer
      ? {
          metadata: {
            chatUI: {
              renderer: override?.renderer ?? SLIDES_DECK_RESULT_RENDERER,
            },
          },
        }
      : {}),
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
        toolCall: { ...tool, status: "running" },
      }),
      event(3, { type: "tool.updated", toolCall: tool }),
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
    toolCalls: [tool],
  } as unknown as Slides2ThreadSnapshot;
}

describe("shared chat tool result rendering", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ runs: [] })),
    );
    chatMocks.sendToAgentChat.mockReset();
    chatMocks.useActionQuery.mockReset();
    chatMocks.useActionQuery.mockReturnValue({
      data: undefined,
      isPending: false,
    });
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  it("renders a saved deck preview and keeps Apply and Regenerate available", async () => {
    const snapshot = persistedToolSnapshot();
    const createTransport: Slides2TransportFactory = () =>
      ({
        getThreadSnapshot: async () => snapshot,
        startRun: vi.fn(async () => ({ runId: "unused-run" })),
        async *subscribeToRun() {},
        cancelRun: vi.fn(async () => undefined),
        assertAiSetupReady: vi.fn(async () => undefined),
      }) as Slides2Transport;

    await act(async () => {
      root.render(
        <MemoryRouter>
          <LocationProbe />
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <AgentChatSurface
                className="h-full"
                createTransport={createTransport}
                defaultMode="chat"
                showGuidedQuestions={false}
                showModelSelector={false}
                restoreActiveThread={false}
                showHeader={false}
                showTabBar={false}
                storageKey="slides-2-chat-render-test"
              />
            </TooltipProvider>
          </QueryClientProvider>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-slides-deck-preview-strip]"),
      ).not.toBeNull();
    });

    const previewStrip = container.querySelector(
      "[data-slides-deck-preview-strip]",
    );
    expect(previewStrip?.hasAttribute("inert")).toBe(true);
    expect(previewStrip?.querySelectorAll(":scope > div")).toHaveLength(3);
    const previewFrames = Array.from(
      previewStrip?.querySelectorAll("iframe") ?? [],
    );
    expect(previewFrames).toHaveLength(3);
    expect(previewFrames.map((frame) => frame.getAttribute("sandbox"))).toEqual(
      ["", "", ""],
    );
    expect(previewFrames[0]?.srcdoc).toContain("Slide 1");
    expect(container.querySelector("h1")).toBeNull();
    expect(container.textContent).toContain("Launch brief");
    expect(container.textContent).toContain("Apply");
    expect(container.textContent).toContain("Regenerate");
    const applyLink = Array.from(container.querySelectorAll("a")).find(
      (link) => link.getAttribute("href") === "/deck/deck%2F1",
    );
    expect(applyLink?.textContent).toContain("Apply");
    await act(async () => applyLink?.click());
    expect(
      container.querySelector("[data-testid='current-path']")?.textContent,
    ).toBe("/deck/deck%2F1");

    const regenerateButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "Regenerate");
    expect(regenerateButton).toBeDefined();
    await act(async () => regenerateButton?.click());
    expect(chatMocks.sendToAgentChat).toHaveBeenCalledWith({
      message: expect.stringContaining("Regenerate this saved deck"),
      context: JSON.stringify({
        appId: "slides-2",
        deckId: "deck/1",
        deckTitle: "Launch brief",
        originalPrompt: "Create a launch brief",
      }),
      submit: true,
      openSidebar: true,
      chatTarget: "local",
    });
  });

  it("renders a slide edit with its preview and actions in saved chat", async () => {
    const sourceHash = "c".repeat(64);
    chatMocks.useActionQuery.mockImplementation((action: string) =>
      action === "get-slide-render"
        ? {
            data: {
              protocolVersion: 1,
              deckId: "deck/1",
              slideId: "slide-2",
              revision: 4,
              sourceHash,
              width: 1920,
              height: 1080,
              html: '<div class="fmd-slide"><h1>Saved slide</h1></div>',
            },
            isPending: false,
          }
        : action === "get-deck"
          ? {
              data: {
                id: "deck/1",
                title: "Launch brief",
                slideCount: 12,
                slides: [
                  {
                    id: "slide-2",
                    slideNumber: 2,
                    layout: "statement",
                    content:
                      '<div class="fmd-slide"><h1>Saved slide</h1></div>',
                    sourceTsx:
                      "export default function Slide() { return null; }",
                    revision: 4,
                    sourceHash,
                  },
                ],
              },
              isPending: false,
            }
          : { data: undefined, isPending: false },
    );
    const snapshot = persistedToolSnapshot({
      name: "update-slide-source",
      input: {
        deckId: "deck/1",
        slideId: "slide-2",
        sourceTsx: "export default function Slide() { return null; }",
      },
      output: {
        deckId: "deck/1",
        slideId: "slide-2",
        position: 1,
        revision: 4,
        sourceHash,
        sourceTsx: "export default function Slide() { return null; }",
      },
    });
    const createTransport: Slides2TransportFactory = () =>
      ({
        getThreadSnapshot: async () => snapshot,
        startRun: vi.fn(async () => ({ runId: "unused-run" })),
        async *subscribeToRun() {},
        cancelRun: vi.fn(async () => undefined),
        assertAiSetupReady: vi.fn(async () => undefined),
      }) as Slides2Transport;

    await act(async () => {
      root.render(
        <MemoryRouter>
          <LocationProbe />
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <AgentChatSurface
                className="h-full"
                createTransport={createTransport}
                defaultMode="chat"
                showGuidedQuestions={false}
                showModelSelector={false}
                restoreActiveThread={false}
                showHeader={false}
                showTabBar={false}
                storageKey="slides-2-slide-edit-result-test"
              />
            </TooltipProvider>
          </QueryClientProvider>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-slides-updated-slide-preview]"),
      ).not.toBeNull();
    });

    expect(
      container.querySelector('[data-agent-composer-slot="area"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-agent-composer-slot="editor-input"]'),
    ).not.toBeNull();
    const previewFrame = container.querySelector(
      "[data-slides-worker-preview] iframe",
    ) as HTMLIFrameElement | null;
    expect(previewFrame?.srcdoc).toContain("Saved slide");
    expect(container.textContent).toContain("Apply");
    expect(container.textContent).toContain("Regenerate");
    expect(container.textContent).toContain("Continue in chat");

    const applyLink = Array.from(container.querySelectorAll("a")).find(
      (link) => link.getAttribute("href") === "/deck/deck%2F1?slide=2",
    );
    expect(applyLink).toBeDefined();
    await act(async () => applyLink?.click());
    expect(
      container.querySelector("[data-testid='current-path']")?.textContent,
    ).toBe("/deck/deck%2F1?slide=2");

    const regenerateButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "Regenerate");
    expect(regenerateButton).toBeDefined();
    await act(async () => regenerateButton?.click());
    expect(chatMocks.sendToAgentChat).toHaveBeenCalledWith({
      message: expect.stringContaining("Regenerate this slide"),
      context: JSON.stringify({
        appId: "slides-2",
        deckId: "deck/1",
        deckTitle: "Launch brief",
        slideId: "slide-2",
        slideNumber: 2,
      }),
      submit: true,
      openSidebar: true,
      chatTarget: "local",
    });
  });
});
