// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MultiTabAssistantChat,
  type MultiTabAssistantChatHeaderProps,
} from "./MultiTabAssistantChat.js";
import {
  sendToAgentChat,
  _resetAgentChatSubmitBufferForTests,
} from "./agent-chat.js";

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
}));

vi.mock("./use-chat-threads.js", () => ({
  useChatThreads: () => threadMocks,
}));

vi.mock("./AssistantChat.js", async () => {
  const React = await import("react");
  return {
    AssistantChat: React.forwardRef(function AssistantChatMock(
      _props: unknown,
      ref,
    ) {
      const props = _props as { composerSlot?: React.ReactNode };
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
      return <div data-testid="assistant-chat">{props.composerSlot}</div>;
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

    expect(chatHandleMocks.setComposerContextItem).toHaveBeenCalledWith({
      key: "selected-element",
      title: "Selected Element",
      context: "<button>Buy</button>",
    });
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
    expect(badges).toHaveLength(1);
    expect(badges[0]?.textContent).toContain("Using this form");
    expect(composerChildren).toEqual([hostSlot, badges[0]]);
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
