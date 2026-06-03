// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MultiTabAssistantChat } from "./MultiTabAssistantChat.js";

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
      return <div data-testid="assistant-chat" />;
    }),
  };
});

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
});

describe("MultiTabAssistantChat agent-team tabs", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    threadMocks.activeThreadId = "thread-1";
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
