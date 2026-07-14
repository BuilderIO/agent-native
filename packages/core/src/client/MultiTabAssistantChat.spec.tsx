// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelAgentChatSubmit,
  requestAgentChatThreadOpen,
  requestAgentTaskOpen,
  sendToAgentChat,
  _resetAgentChatSubmitBufferForTests,
} from "./agent-chat.js";
import {
  MultiTabAssistantChat,
  type MultiTabAssistantChatHeaderProps,
} from "./MultiTabAssistantChat.js";
import type { ChatThreadSummary } from "./use-chat-threads.js";

const chatHandleMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  prefillMessage: vi.fn(),
  setComposerContextItem: vi.fn(),
  removeComposerContextItem: vi.fn(),
  clearComposerContextItems: vi.fn(),
  sendRecoveryMessage: vi.fn(),
  queueMessage: vi.fn(),
  focusComposer: vi.fn(),
  exportThreadSnapshot: vi.fn(() => null),
}));

const threadMocks = vi.hoisted(() => ({
  activeThreadId: "thread-1",
  threads: [
    {
      id: "thread-1",
      title: "Main thread",
      preview: "",
      messageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scope: null,
    },
  ],
  createThread: vi.fn(
    async (requestedId?: string) => requestedId ?? "thread-2",
  ),
  switchThread: vi.fn(),
  detachThread: vi.fn(),
  forkThread: vi.fn(),
  saveThreadData: vi.fn(),
  generateTitle: vi.fn(async () => null),
  searchThreads: vi.fn(async () => []),
  refreshThreads: vi.fn(async () => undefined),
  isNewThread: vi.fn(() => false),
  pinThread: vi.fn(async () => true),
  renameThread: vi.fn(async () => true),
}));

const chatThreadHookMocks = vi.hoisted(() => ({
  useChatThreads: vi.fn(),
}));

vi.mock("./frame.js", () => ({
  isTrustedFrameMessage: () => true,
  getFramePostMessageTargetOrigin: () => null,
}));

vi.mock("./builder-frame.js", () => ({
  isInBuilderFrame: () => false,
  isTrustedBuilderMessage: () => false,
  sendToBuilderChat: vi.fn(),
}));

vi.mock("./embed-auth.js", () => ({
  isEmbedAuthActive: () => false,
  isEmbedMcpChatBridgeActive: () => false,
  markEmbedMcpChatBridgeActive: vi.fn(),
  readEmbedMcpChatBridgeFlagFromUrl: () => false,
}));

vi.mock("./mcp-app-host.js", () => ({
  sendMcpAppHostMessage: () => null,
}));

vi.mock("./api-path.js", () => ({
  agentNativePath: (path: string) => path,
}));

vi.mock("./RunStuckBanner.js", () => ({
  RunStuckBanner: () => null,
}));

vi.mock("./components/ui/tooltip.js", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("./components/ui/popover.js", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("./use-chat-threads.js", () => ({
  useChatThreads: chatThreadHookMocks.useChatThreads,
}));

chatThreadHookMocks.useChatThreads.mockImplementation(() => threadMocks);

vi.mock("./AssistantChat.js", async () => {
  const React = await import("react");
  return {
    AssistantChat: React.forwardRef(function AssistantChatMock(
      _props: unknown,
      ref,
    ) {
      const props = _props as {
        composerSlot?: React.ReactNode;
        emptyStateAddon?: React.ReactNode;
        selectedEffort?: string;
      };
      React.useImperativeHandle(ref, () => ({
        sendMessage: chatHandleMocks.sendMessage,
        prefillMessage: chatHandleMocks.prefillMessage,
        setComposerContextItem: chatHandleMocks.setComposerContextItem,
        removeComposerContextItem: chatHandleMocks.removeComposerContextItem,
        clearComposerContextItems: chatHandleMocks.clearComposerContextItems,
        sendRecoveryMessage: chatHandleMocks.sendRecoveryMessage,
        queueMessage: chatHandleMocks.queueMessage,
        isRunning: () => false,
        focusComposer: chatHandleMocks.focusComposer,
        exportThreadSnapshot: chatHandleMocks.exportThreadSnapshot,
      }));
      return (
        <div
          data-testid="assistant-chat"
          data-reasoning-effort={props.selectedEffort}
        >
          {props.emptyStateAddon}
          {props.composerSlot}
        </div>
      );
    }),
  };
});

function resetThreadMocks() {
  threadMocks.activeThreadId = "thread-1";
  threadMocks.threads = [
    {
      id: "thread-1",
      title: "Main thread",
      preview: "",
      messageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scope: null,
    },
  ];
  threadMocks.createThread.mockReset();
  threadMocks.createThread.mockImplementation(
    async (requestedId?: string) => requestedId ?? "thread-2",
  );
  threadMocks.pinThread.mockReset();
  threadMocks.pinThread.mockImplementation(async () => true);
  threadMocks.renameThread.mockReset();
  threadMocks.renameThread.mockImplementation(async () => true);
  chatThreadHookMocks.useChatThreads.mockReset();
  chatThreadHookMocks.useChatThreads.mockImplementation(() => threadMocks);
}

function dispatchSubmitChat(data: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "agentNative.submitChat",
        data,
      },
      origin: window.location.origin,
    }),
  );
}

describe("MultiTabAssistantChat postMessage bridge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetThreadMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ value: null })),
    );
    window.localStorage.clear();
    window.localStorage.setItem(
      "agent-chat-open-tabs:bridge-test",
      JSON.stringify(["thread-1"]),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="bridge-test" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("prefills the active composer without submitting when submit is false", () => {
    act(() => {
      dispatchSubmitChat({
        message: "Review this before sending",
        context: "Selected rows: a, b",
        submit: false,
        openSidebar: true,
      });
    });

    expect(chatHandleMocks.prefillMessage).toHaveBeenCalledWith(
      "Review this before sending\n\n<context>\nSelected rows: a, b\n</context>",
    );
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
  });

  it("defaults reasoning to medium", () => {
    expect(
      container
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-reasoning-effort"),
    ).toBe("medium");
  });

  it("migrates persisted legacy auto reasoning to medium", async () => {
    window.localStorage.setItem(
      "agent-native:chat-models:selection:legacy-medium-test",
      JSON.stringify({ model: "claude-sonnet-5", effort: "auto" }),
    );

    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="legacy-medium-test" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container
        .querySelector("[data-testid='assistant-chat']")
        ?.getAttribute("data-reasoning-effort"),
    ).toBe("medium");
  });

  it("continues to submit when submit is omitted", () => {
    act(() => {
      dispatchSubmitChat({
        message: "Send this now",
      });
    });

    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "Send this now",
      undefined,
    );
    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
  });

  it("preserves plan mode on submitted bridge messages", () => {
    act(() => {
      root.render(
        <MultiTabAssistantChat storageKey="bridge-test" execMode="plan" />,
      );
    });

    act(() => {
      dispatchSubmitChat({
        message: "Plan this first",
      });
    });

    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "Plan this first",
      undefined,
      { requestMode: "plan" },
    );
  });

  it("starts background new-tab sends without focusing the new tab", async () => {
    act(() => {
      dispatchSubmitChat({
        message: "Run quietly",
        submit: true,
        newTab: true,
        background: true,
        tabId: "thread-bg",
      });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(threadMocks.createThread).toHaveBeenCalledWith("thread-bg");
    expect(threadMocks.switchThread).toHaveBeenCalledWith("thread-1");
    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "Run quietly",
      undefined,
      { trackInRunsTray: true },
    );
  });

  it("adds keyed context to the active composer without prefill or submit", () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.setChatContext",
            data: {
              key: "selected-element",
              title: "Selected Element",
              context: "<button>Buy</button>",
            },
          },
          origin: window.location.origin,
        }),
      );
    });

    expect(
      dispatchEventSpy.mock.calls.some(
        ([event]) => event.type === "agent-panel:open",
      ),
    ).toBe(true);
    expect(chatHandleMocks.setComposerContextItem).toHaveBeenCalledWith(
      {
        key: "selected-element",
        title: "Selected Element",
        context: "<button>Buy</button>",
      },
      { focus: true },
    );
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
    dispatchEventSpy.mockRestore();
  });

  it("stages keyed context quietly when openSidebar is false", () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.setChatContext",
            data: {
              key: "selected-element",
              title: "Selected Element",
              context: "<button>Buy</button>",
              openSidebar: false,
            },
          },
          origin: window.location.origin,
        }),
      );
    });

    expect(
      dispatchEventSpy.mock.calls.some(
        ([event]) => event.type === "agent-panel:open",
      ),
    ).toBe(false);
    // openSidebar:false keeps the sidebar closed, but focus is independent —
    // by default staging still focuses the composer (unchanged behavior).
    expect(chatHandleMocks.setComposerContextItem).toHaveBeenCalledWith(
      {
        key: "selected-element",
        title: "Selected Element",
        context: "<button>Buy</button>",
      },
      { focus: true },
    );
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
    dispatchEventSpy.mockRestore();
  });

  it("stages keyed context without focus when focus is false", () => {
    // Passive context mirroring (e.g. a canvas element selection) must stage
    // the chip without stealing focus, so an in-progress inline text editor in
    // the design canvas iframe is not blurred and torn down.
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.setChatContext",
            data: {
              key: "selected-element",
              title: "Selected Element",
              context: "<button>Buy</button>",
              openSidebar: false,
              focus: false,
            },
          },
          origin: window.location.origin,
        }),
      );
    });

    expect(chatHandleMocks.setComposerContextItem).toHaveBeenCalledWith(
      {
        key: "selected-element",
        title: "Selected Element",
        context: "<button>Buy</button>",
      },
      { focus: false },
    );
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
  });

  it("removes keyed context from the active composer", () => {
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.removeChatContext",
            data: {
              key: "selected-element",
            },
          },
          origin: window.location.origin,
        }),
      );
    });

    expect(chatHandleMocks.removeComposerContextItem).toHaveBeenCalledWith(
      "selected-element",
    );
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
  });

  it("clears context from the active composer", () => {
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.clearChatContext",
            data: {},
          },
          origin: window.location.origin,
        }),
      );
    });

    expect(chatHandleMocks.clearComposerContextItems).toHaveBeenCalled();
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
    expect(chatHandleMocks.prefillMessage).not.toHaveBeenCalled();
  });

  it("opens a replacement tab and closes the current tab when clearing chat", async () => {
    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    threadMocks.createThread.mockImplementationOnce(async () => {
      const id = "thread-clear";
      threadMocks.activeThreadId = id;
      threadMocks.threads = [
        {
          id,
          title: "",
          preview: "",
          messageCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          scope: null,
        },
        ...threadMocks.threads,
      ];
      return id;
    });

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual(["thread-1"]);

    await act(async () => {
      headerProps?.clearActiveTab();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(headerProps?.tabs.map((tab) => tab.id)).toEqual(["thread-clear"]);
  });

  it("keeps a chat mounted when scoped navigation has no saved open tabs", async () => {
    let tabs: Array<{ id: string }> = [];
    const renderHeader = (props: { tabs: Array<{ id: string }> }) => {
      tabs = props.tabs;
      return null;
    };

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="scope-reset-test"
          renderHeader={renderHeader}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tabs.map((tab) => tab.id)).toEqual(["thread-1"]);

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="scope-reset-test"
          scope={{ type: "design", id: "design-1", label: "QA Smoke" }}
          renderHeader={renderHeader}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tabs.map((tab) => tab.id)).toEqual(["thread-1"]);
    expect(
      container.querySelectorAll("[data-testid='assistant-chat']"),
    ).toHaveLength(1);
  });

  it("renders scoped context as a composer tab", async () => {
    threadMocks.threads = [
      {
        ...threadMocks.threads[0],
        scope: { type: "form", id: "form-1" },
      },
    ];

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          scope={{ type: "form", id: "form-1" }}
          composerSlot={<div data-testid="host-composer-slot">Host slot</div>}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const badges = container.querySelectorAll(".agent-scope-badge-wrapper");
    const hostSlot = container.querySelector(
      "[data-testid='host-composer-slot']",
    );
    const composerChildren = Array.from(
      container.querySelector("[data-testid='assistant-chat']")?.children ?? [],
    );
    const badgeButton = badges[0]?.querySelector("button");
    expect(badges).toHaveLength(1);
    expect(badges[0]?.textContent).toContain("Using this form");
    expect(badgeButton?.className).not.toContain("shadow");
    expect(composerChildren).toEqual([hostSlot, badges[0]]);
  });

  it("can hide the scoped context composer tab", async () => {
    threadMocks.threads = [
      {
        ...threadMocks.threads[0],
        scope: { type: "design", id: "design-1" },
      },
    ];

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          scope={{ type: "design", id: "design-1" }}
          showScopeBadge={false}
          composerSlot={<div data-testid="host-composer-slot">Host slot</div>}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelectorAll(".agent-scope-badge-wrapper"),
    ).toHaveLength(0);
    expect(
      container.querySelector("[data-testid='host-composer-slot']"),
    ).not.toBeNull();
  });

  it("keeps previous scoped chats out of the empty chat state", async () => {
    const now = Date.now();
    threadMocks.threads = [
      {
        ...threadMocks.threads[0],
        scope: { type: "form", id: "form-1" },
        messageCount: 0,
        updatedAt: now,
      },
      {
        id: "thread-2",
        title: "Older form chat",
        preview: "",
        messageCount: 1,
        createdAt: now - 1000,
        updatedAt: now - 1000,
        scope: { type: "form", id: "form-1" },
      },
    ];

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          scope={{ type: "form", id: "form-1" }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Using this form");
    expect(container.textContent).toContain("Older form chat");
    expect(container.textContent).not.toContain("Previous chats for this form");
  });

  it("syncs selected and new chat states to the URL when enabled", async () => {
    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    threadMocks.threads = [
      ...threadMocks.threads,
      {
        id: "thread-2",
        title: "Second thread",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];
    threadMocks.createThread.mockImplementationOnce(async () => "thread-new");
    window.history.replaceState(null, "", "/?thread=thread-1");

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          threadUrlSync
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      headerProps?.setActiveTabId("thread-2");
    });
    expect(window.location.search).toBe("?thread=thread-2");

    await act(async () => {
      await headerProps?.addTab();
      await Promise.resolve();
    });
    expect(window.location.search).toBe("");
  });

  it("reacts when client-side navigation clears the thread query param", async () => {
    window.history.replaceState(null, "", "/?thread=thread-1");

    await act(async () => {
      root.render(
        <MultiTabAssistantChat storageKey="bridge-test" threadUrlSync />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(chatThreadHookMocks.useChatThreads).toHaveBeenLastCalledWith(
      expect.any(String),
      "bridge-test",
      null,
      expect.objectContaining({ routeThreadId: "thread-1" }),
    );

    act(() => {
      window.history.pushState(null, "", "/");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(chatThreadHookMocks.useChatThreads).toHaveBeenLastCalledWith(
      expect.any(String),
      "bridge-test",
      null,
      expect.objectContaining({ routeThreadId: null }),
    );
  });

  it("accepts a route-owned thread id for path-based chat routes", async () => {
    let headerProps: MultiTabAssistantChatHeaderProps | null = null;
    const navigate = vi.fn();
    threadMocks.threads = [
      ...threadMocks.threads,
      {
        id: "thread-2",
        title: "Second thread",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];
    window.history.replaceState(null, "", "/chat/thread-1");

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          threadUrlSync={{
            routeThreadId: "thread-1",
            getPath: (threadId) =>
              threadId ? `/chat/${encodeURIComponent(threadId)}` : "/",
            navigate,
          }}
          renderHeader={(props) => {
            headerProps = props;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(chatThreadHookMocks.useChatThreads).toHaveBeenLastCalledWith(
      expect.any(String),
      "bridge-test",
      null,
      expect.objectContaining({ routeThreadId: "thread-1" }),
    );

    act(() => {
      headerProps?.setActiveTabId("thread-2");
    });

    expect(navigate).toHaveBeenCalledWith("/chat/thread-2", {
      replace: false,
    });

    window.history.pushState(null, "", "/");
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="bridge-test"
          threadUrlSync={{
            routeThreadId: null,
            getPath: (threadId) =>
              threadId ? `/chat/${encodeURIComponent(threadId)}` : "/",
            navigate,
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(chatThreadHookMocks.useChatThreads).toHaveBeenLastCalledWith(
      expect.any(String),
      "bridge-test",
      null,
      expect.objectContaining({ routeThreadId: null }),
    );
  });
});

describe("MultiTabAssistantChat cold-start first message", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ value: null })),
    );
    window.localStorage.clear();
    // A tab is restored, but no thread is active yet — the exact cold-start
    // window where the bootstrap createThread() has not resolved.
    window.localStorage.setItem(
      "agent-chat-open-tabs:cold-start",
      JSON.stringify(["thread-1"]),
    );
    threadMocks.activeThreadId = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    threadMocks.activeThreadId = "thread-1";
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("buffers the first message and delivers it once a thread exists", async () => {
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="cold-start" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Message arrives before any thread is active → must be buffered, not sent.
    act(() => {
      dispatchSubmitChat({ message: "First message" });
    });
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();

    // The first thread becomes active (bootstrap or restore). The buffered send
    // should now flush exactly once, without creating a second thread.
    threadMocks.activeThreadId = "thread-1";
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="cold-start" />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(chatHandleMocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "First message",
      undefined,
    );
    expect(threadMocks.createThread).not.toHaveBeenCalled();
  });
});

describe("MultiTabAssistantChat cold-start delivery (Mode B)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ value: null })),
    );
    window.localStorage.clear();
    window.localStorage.setItem(
      "agent-chat-open-tabs:mode-b",
      JSON.stringify(["thread-1"]),
    );
    _resetAgentChatSubmitBufferForTests();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    _resetAgentChatSubmitBufferForTests();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("delivers a message sent before the lazy panel mounted its listener", async () => {
    // Send while nothing is mounted — the live post has no listener to receive
    // it, so only the buffered replay can deliver it.
    act(() => {
      sendToAgentChat({ message: "Sent before mount", submit: true });
    });
    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(chatHandleMocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "Sent before mount",
      undefined,
      { submitMessageId: expect.any(String) },
    );
  });

  it("ignores a duplicate submit with the same submitMessageId", async () => {
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      dispatchSubmitChat({ message: "Once only", submitMessageId: "dup-1" });
    });
    act(() => {
      dispatchSubmitChat({ message: "Once only", submitMessageId: "dup-1" });
    });

    expect(chatHandleMocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(chatHandleMocks.sendMessage).toHaveBeenCalledWith(
      "Once only",
      undefined,
      { submitMessageId: "dup-1" },
    );
  });

  it("drops a pending delivery after its confirmation times out", async () => {
    threadMocks.activeThreadId = "";
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
    });

    act(() => {
      dispatchSubmitChat({
        message: "Never deliver late",
        submitMessageId: "cancelled-submit",
      });
    });
    cancelAgentChatSubmit("cancelled-submit");

    threadMocks.activeThreadId = "thread-1";
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(chatHandleMocks.sendMessage).not.toHaveBeenCalled();
  });

  it("replays an open-thread request sent before the lazy panel mounted", async () => {
    threadMocks.threads = [
      ...threadMocks.threads,
      {
        id: "thread-2",
        title: "Run thread",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];

    act(() => {
      requestAgentChatThreadOpen({ threadId: "thread-2" });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(threadMocks.switchThread).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(threadMocks.switchThread).toHaveBeenCalledWith("thread-2");
  });

  it("does not restore a transient thread after the user selected another one", async () => {
    threadMocks.activeThreadId = "thread-2";
    threadMocks.threads = [
      ...threadMocks.threads,
      {
        id: "thread-2",
        title: "Other thread",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="bridge-test" />);
    });

    act(() => {
      requestAgentChatThreadOpen({
        threadId: "thread-1",
        onlyIfActiveThreadId: "thread-1",
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(threadMocks.switchThread).not.toHaveBeenCalled();
  });

  it("restores a transient thread while its captured thread is still active", async () => {
    threadMocks.activeThreadId = "thread-1";
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="mode-b" />);
    });

    act(() => {
      requestAgentChatThreadOpen({
        threadId: "thread-1",
        onlyIfActiveThreadId: "thread-1",
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(threadMocks.switchThread).toHaveBeenCalledWith("thread-1");
  });

  it("replays an agent-task open request sent before the lazy panel mounted", async () => {
    let tabs: Array<{
      id: string;
      parentThreadId?: string;
      subAgentName?: string;
    }> = [];
    threadMocks.threads = [
      ...threadMocks.threads,
      {
        id: "thread-child",
        title: "Research child",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];

    act(() => {
      requestAgentTaskOpen({
        threadId: "thread-child",
        parentThreadId: "thread-1",
        name: "Research",
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(threadMocks.switchThread).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="mode-b"
          renderHeader={(props) => {
            tabs = props.tabs;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(threadMocks.switchThread).toHaveBeenCalledWith("thread-child");
    expect(tabs).toContainEqual(
      expect.objectContaining({
        id: "thread-child",
        parentThreadId: "thread-1",
        subAgentName: "Research",
      }),
    );
  });
});

describe("MultiTabAssistantChat agent-team tabs", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetThreadMocks();
    threadMocks.threads = [
      {
        id: "thread-1",
        title: "Main thread",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
      {
        id: "thread-child",
        title: "Research child",
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: null,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs/list?goalId=agent-team")) {
          return Response.json({
            runs: [
              {
                title: "Research child",
                status: "running",
                sourceRecord: {
                  type: "agent-team-task",
                  threadId: "thread-child",
                  parentThreadId: "thread-1",
                  name: "Research",
                },
                metadata: {},
              },
            ],
          });
        }
        return Response.json({ value: null });
      }),
    );
    window.localStorage.clear();
    window.localStorage.setItem(
      "agent-chat-open-tabs:agent-team-test",
      JSON.stringify(["thread-1"]),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("hydrates running sub-agent tasks into child tabs", async () => {
    let tabs: Array<{
      id: string;
      parentThreadId?: string;
      status: string;
      subAgentName?: string;
    }> = [];

    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="agent-team-test"
          renderHeader={(props) => {
            tabs = props.tabs;
            return null;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tabs).toContainEqual(
      expect.objectContaining({
        id: "thread-child",
        parentThreadId: "thread-1",
        status: "running",
        subAgentName: "Research",
      }),
    );
  });
});

describe("MultiTabAssistantChat page overlay", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetThreadMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ value: null })),
    );
    window.localStorage.clear();
    window.localStorage.setItem(
      "agent-chat-open-tabs:page-overlay-test",
      JSON.stringify(["thread-1"]),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("marks the page overlay only after the thread scrolls", async () => {
    await act(async () => {
      root.render(
        <MultiTabAssistantChat
          storageKey="page-overlay-test"
          renderOverlay={() => (
            <div className="agent-chat-scroll" data-testid="chat-scroll" />
          )}
        />,
      );
    });

    const scrollTarget = container.querySelector<HTMLElement>(
      '[data-testid="chat-scroll"]',
    );
    expect(scrollTarget).not.toBeNull();
    expect(
      container.querySelector("[data-agent-page-chat-scrolled]"),
    ).toBeNull();

    await act(async () => {
      if (!scrollTarget) return;
      scrollTarget.scrollTop = 24;
      scrollTarget.dispatchEvent(new Event("scroll"));
    });

    expect(
      container.querySelector("[data-agent-page-chat-scrolled]"),
    ).not.toBeNull();
  });
});

describe("MultiTabAssistantChat history popover", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    resetThreadMocks();
    const now = Date.now();
    threadMocks.activeThreadId = "thread-1";
    const historyThreads: ChatThreadSummary[] = [
      {
        id: "thread-1",
        title: "Active chat",
        preview: "",
        messageCount: 1,
        createdAt: now,
        updatedAt: now,
        scope: null,
      },
      {
        id: "thread-2",
        title: "Pinned chat",
        preview: "",
        messageCount: 2,
        createdAt: now,
        updatedAt: now,
        scope: null,
        pinnedAt: now,
      },
      {
        id: "thread-3",
        title: "Other chat",
        preview: "",
        messageCount: 3,
        createdAt: now,
        updatedAt: now,
        scope: null,
      },
    ];
    threadMocks.threads = historyThreads;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ value: null })),
    );
    window.localStorage.clear();
    window.localStorage.setItem(
      "agent-chat-open-tabs:history-test",
      JSON.stringify(["thread-1"]),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function openHistory() {
    await act(async () => {
      root.render(<MultiTabAssistantChat storageKey="history-test" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const historyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="All chats"]',
    );
    expect(historyButton).not.toBeNull();
    act(() => {
      historyButton!.click();
    });
  }

  it("groups pinned threads into a dedicated section, sorted ahead of the rest", async () => {
    await openHistory();

    const labels = Array.from(
      container.querySelectorAll(".an-chat-history__section-label"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["Pinned"]);

    const titles = Array.from(
      container.querySelectorAll(".an-chat-history-row__title"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Pinned chat", "Active chat", "Other chat"]);
  });

  it("pins an unpinned thread via the row action menu", async () => {
    await openHistory();

    const rows = container.querySelectorAll(".an-chat-history-row");
    // Row order: Pinned chat (pinned section), Active chat, Other chat.
    const otherRow = rows[2];
    const trigger = otherRow.querySelector<HTMLButtonElement>(
      ".an-chat-history-row__menu-trigger",
    );
    act(() => {
      trigger!.click();
    });
    const pinItem = Array.from(
      otherRow.querySelectorAll(".an-chat-history-row__menu-item"),
    ).find((el) => el.textContent?.includes("Pin to top"));
    expect(pinItem).toBeDefined();
    act(() => {
      (pinItem as HTMLButtonElement).click();
    });

    expect(threadMocks.pinThread).toHaveBeenCalledWith("thread-3", true);
  });

  it("unpins an already-pinned thread via the row action menu", async () => {
    await openHistory();

    const pinnedRow = container.querySelector(".an-chat-history-row");
    const trigger = pinnedRow!.querySelector<HTMLButtonElement>(
      ".an-chat-history-row__menu-trigger",
    );
    act(() => {
      trigger!.click();
    });
    const unpinItem = Array.from(
      pinnedRow!.querySelectorAll(".an-chat-history-row__menu-item"),
    ).find((el) => el.textContent?.includes("Unpin from top"));
    expect(unpinItem).toBeDefined();
    act(() => {
      (unpinItem as HTMLButtonElement).click();
    });

    expect(threadMocks.pinThread).toHaveBeenCalledWith("thread-2", false);
  });

  it("renames a thread via the row action menu", async () => {
    await openHistory();

    const rows = container.querySelectorAll(".an-chat-history-row");
    const activeRow = rows[1]; // "Active chat"
    const trigger = activeRow.querySelector<HTMLButtonElement>(
      ".an-chat-history-row__menu-trigger",
    );
    act(() => {
      trigger!.click();
    });
    const renameItem = Array.from(
      activeRow.querySelectorAll(".an-chat-history-row__menu-item"),
    ).find((el) => el.textContent?.includes("Rename"));
    act(() => {
      (renameItem as HTMLButtonElement).click();
    });

    const input = activeRow.querySelector<HTMLInputElement>(
      ".an-chat-history-row__rename-input",
    );
    expect(input).not.toBeNull();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Renamed chat");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(threadMocks.renameThread).toHaveBeenCalledWith(
      "thread-1",
      "Renamed chat",
    );
  });

  it("does not render a delete row action (no confirm UX wired yet)", async () => {
    await openHistory();

    const trigger = container.querySelector<HTMLButtonElement>(
      ".an-chat-history-row__menu-trigger",
    );
    act(() => {
      trigger!.click();
    });

    const menuItems = Array.from(
      container.querySelectorAll(".an-chat-history-row__menu-item"),
    ).map((el) => el.textContent);
    expect(menuItems.length).toBeGreaterThan(0);
    expect(menuItems.some((text) => text?.includes("Delete"))).toBe(false);
  });
});
