// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childState = vi.hoisted(() => ({
  onThreadSnapshotPersisted: undefined as
    | ((threadId: string, messageCount: number) => void)
    | undefined,
  cleanup: vi.fn(),
  request: { started: false, aborted: false },
}));

const threadState = vi.hoisted(() => {
  const makeThread = (id: string) => ({
    id,
    title: id === "thread-new" ? "New chat" : "Existing chat",
    preview: "",
    messageCount: 0,
    createdAt: 1,
    updatedAt: 1,
    scope: null,
  });
  const state = {
    threads: [makeThread("thread-new")],
    activeThreadId: "thread-new" as string | null,
    isLoading: false,
    createThread: vi.fn(async () => "thread-new"),
    openThread: vi.fn(async () => "opened"),
    switchThread: vi.fn(),
    forkThread: vi.fn(),
    saveThreadData: vi.fn(async () => true),
    generateTitle: vi.fn(async () => null),
    refreshThreads: vi.fn(async () => undefined),
    restoredThreadIdOnListFailure: null,
    evictedThreadIds: [] as string[],
    newThreadIds: new Set(["thread-new"]),
    confirmedThreadIds: new Set<string>(),
    isNewThread: (id: string) => state.newThreadIds.has(id),
    isThreadPersisted: (id: string) => state.confirmedThreadIds.has(id),
    confirmThreadSnapshotPersisted: vi.fn((id: string) => {
      state.newThreadIds.delete(id);
      state.confirmedThreadIds.add(id);
    }),
    pinThread: vi.fn(async () => true),
    renameThread: vi.fn(async () => true),
  };
  return state;
});

const catalogState = vi.hoisted(() => ({
  catalog: {
    state: "unavailable" as const,
    groups: [],
    defaultModel: undefined,
    loadLiveGroups: async () => null,
  },
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/client/agent-chat")
    >();
  return {
    ...actual,
    useChatThreads: () => threadState,
    loadChatModelCatalog: async () => catalogState.catalog,
  };
});

vi.mock("@agent-native/core/client/host", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/host")>();
  return {
    ...actual,
    getFramePostMessageTargetOrigin: () => null,
    isInBuilderFrame: () => false,
    isTrustedBuilderMessage: () => false,
    isTrustedFrameMessage: () => false,
    sendToBuilderChat: vi.fn(),
  };
});

vi.mock("./AgentKitAssistantChat.js", async () => {
  const React = await import("react");
  return {
    AgentKitAssistantChat: React.forwardRef(function AgentKitAssistantChatProbe(
      props: unknown,
      _ref,
    ) {
      const chatProps = props as {
        onThreadSnapshotPersisted?: (
          threadId: string,
          messageCount: number,
        ) => void;
      };
      childState.onThreadSnapshotPersisted =
        chatProps.onThreadSnapshotPersisted;
      React.useEffect(
        () => () => {
          childState.cleanup();
          if (!childState.request.started) childState.request.aborted = true;
        },
        [],
      );
      return React.createElement("div", {
        "data-testid": "agent-chat-child",
      });
    }),
  };
});

import { MultiTabAssistantChat } from "./MultiTabAssistantChat.js";

let container: HTMLDivElement;
let root: Root;

function dispatchRunning(detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent("agentNative.chatRunning", { detail }));
}

function navigatePath(threadId: string | null) {
  return threadId ? `/thread/${encodeURIComponent(threadId)}` : "/home";
}

beforeEach(() => {
  childState.onThreadSnapshotPersisted = undefined;
  childState.cleanup.mockReset();
  childState.request = { started: false, aborted: false };
  threadState.threads = [
    {
      id: "thread-new",
      title: "New chat",
      preview: "",
      messageCount: 0,
      createdAt: 1,
      updatedAt: 1,
      scope: null,
    },
  ];
  threadState.activeThreadId = "thread-new";
  threadState.newThreadIds = new Set(["thread-new"]);
  threadState.confirmedThreadIds = new Set();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ value: null })),
  );
  window.history.replaceState(null, "", "/home");
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

async function mount(
  onNavigate: (path: string) => void,
  overrides: Record<string, unknown> = {},
) {
  await act(async () => {
    root.render(
      <MultiTabAssistantChat
        storageKey="route-handoff"
        showTabBar={false}
        renderHeader={() => null}
        threadUrlSync={{
          routeThreadId: null,
          getPath: navigatePath,
          navigate: onNavigate,
        }}
        {...(overrides as object)}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("new-thread URL handoff", () => {
  it("latches a hook-seeded new thread before persistence confirms it", async () => {
    const navigate = vi.fn();
    await mount(navigate);

    // The hook-seeded id is not in MultiTab's createThread set. The first
    // snapshot can be an empty metadata save and confirms the hook state.
    act(() => {
      childState.onThreadSnapshotPersisted?.("thread-new", 0);
    });
    expect(threadState.isNewThread("thread-new")).toBe(false);
    expect(navigate).not.toHaveBeenCalled();

    act(() => {
      childState.onThreadSnapshotPersisted?.("thread-new", 1);
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(childState.cleanup).not.toHaveBeenCalled();

    // Repeated saves after confirmation must not outrank the pending handoff.
    act(() => {
      childState.onThreadSnapshotPersisted?.("thread-new", 2);
      dispatchRunning({ isRunning: true, tabId: "thread-new" });
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(childState.cleanup).not.toHaveBeenCalled();

    childState.request.started = true;
    act(() => {
      dispatchRunning({
        isRunning: true,
        tabId: "thread-new",
        runId: "run-1",
        reason: "run.submitted",
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/thread/thread-new", {
      replace: false,
    });
    expect(childState.request.aborted).toBe(false);
  });

  it("keeps the handoff pending through queued/error saves and retries on a real run", async () => {
    const navigate = vi.fn();
    await mount(navigate);

    act(() => {
      childState.onThreadSnapshotPersisted?.("thread-new", 1);
      dispatchRunning({ isRunning: true, tabId: "thread-new" });
      dispatchRunning({
        isRunning: false,
        tabId: "thread-new",
        reason: "submission_queued",
      });
      dispatchRunning({
        isRunning: false,
        tabId: "thread-new",
        reason: "start_failed",
      });
      childState.onThreadSnapshotPersisted?.("thread-new", 1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(childState.cleanup).not.toHaveBeenCalled();

    act(() => {
      dispatchRunning({
        isRunning: true,
        tabId: "thread-new",
        runId: "run-retry",
        reason: "run.submitted",
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/thread/thread-new", {
      replace: false,
    });
  });

  it("navigates immediately when the run was accepted before the snapshot", async () => {
    const navigate = vi.fn();
    await mount(navigate);

    childState.request.started = true;
    act(() => {
      dispatchRunning({
        isRunning: true,
        tabId: "thread-new",
        runId: "run-first",
        reason: "run.submitted",
      });
      childState.onThreadSnapshotPersisted?.("thread-new", 1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/thread/thread-new", {
      replace: false,
    });
  });

  it("preserves immediate URL sync for restored existing threads", async () => {
    threadState.threads = [
      {
        id: "thread-existing",
        title: "Existing chat",
        preview: "",
        messageCount: 3,
        createdAt: 1,
        updatedAt: 1,
        scope: null,
      },
    ];
    threadState.activeThreadId = "thread-existing";
    threadState.newThreadIds = new Set();
    const navigate = vi.fn();
    await mount(navigate);

    act(() => {
      childState.onThreadSnapshotPersisted?.("thread-existing", 3);
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/thread/thread-existing", {
      replace: false,
    });
  });

  it("preserves the old runtime-only URL semantics when no run event is emitted", async () => {
    const navigate = vi.fn();
    await mount(navigate, { runtime: {} });

    act(() => {
      childState.onThreadSnapshotPersisted?.("thread-new", 1);
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/thread/thread-new", {
      replace: false,
    });
  });
});
