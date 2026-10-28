// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  creativeContextEnabled: false,
  contextItems: [] as Array<{ key: string; title: string; context: string }>,
  callAction: vi.fn(async () => ({ cleared: true })),
  remove: vi.fn(),
  readClientAppState: vi.fn(async () => null as Record<string, unknown> | null),
  threadUrlSync: null as null | {
    routeThreadId: string | null;
    getPath: (threadId: string | null) => string;
  },
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  useAgentChatContext: () => ({
    items: clientMocks.contextItems,
    remove: clientMocks.remove,
  }),
}));

vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatHome: ({
    composerSlot,
    homeIntroSlot,
    threadUrlSync,
  }: {
    composerSlot?: React.ReactNode;
    homeIntroSlot?: React.ReactNode;
    threadUrlSync?: typeof clientMocks.threadUrlSync;
  }) => {
    clientMocks.threadUrlSync = threadUrlSync ?? null;
    return (
      <div data-testid="chat">
        {composerSlot}
        {homeIntroSlot}
      </div>
    );
  },
}));

vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextComposerChip: () => (
    <div data-testid="creative-context-chip" />
  ),
  useCreativeContextLab: () => clientMocks.creativeContextEnabled,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: clientMocks.callAction,
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  readClientAppState: clientMocks.readClientAppState,
}));

vi.mock("@/lib/chat-handoff", () => ({
  ANALYTICS_CHAT_STORAGE_KEY: "analytics-chat",
}));

vi.mock("@/lib/tab-id", () => ({ TAB_ID: "test-tab" }));

import AskPage from "./Ask";

describe("AskPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  function renderAskPage(threadId: string | null = null) {
    root.render(
      <MemoryRouter>
        <AskPage threadId={threadId} />
      </MemoryRouter>,
    );
  }

  it("binds the blank /ask page to no route thread, so it never restores the last chat", async () => {
    await act(async () => {
      renderAskPage();
    });

    expect(clientMocks.threadUrlSync?.routeThreadId).toBeNull();
    expect(clientMocks.threadUrlSync?.getPath(null)).toBe("/ask");
    expect(clientMocks.threadUrlSync?.getPath("thread-1")).toBe(
      "/ask/thread-1",
    );
  });

  it("binds a saved thread page to its own route thread", async () => {
    await act(async () => {
      renderAskPage("thread-1");
    });

    expect(clientMocks.threadUrlSync?.routeThreadId).toBe("thread-1");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.creativeContextEnabled = false;
    clientMocks.contextItems = [];
    clientMocks.readClientAppState.mockResolvedValue({
      type: "dashboard",
      id: "dash-1",
      __agentNativeSelectedObjectSource: "test-tab",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each([
    "analytics-selected-dashboard",
    "analytics-selected-dashboard-panel",
  ])(
    "removes stale %s context from the standalone Ask composer",
    async (key) => {
      clientMocks.contextItems = [
        { key, title: "Stale context", context: "Old" },
      ];

      await act(async () => {
        renderAskPage();
      });

      expect(clientMocks.remove).toHaveBeenCalledWith(key);
    },
  );

  it("preserves unrelated composer context", async () => {
    clientMocks.contextItems = [
      { key: "other-context", title: "Other", context: "Keep this" },
    ];

    await act(async () => {
      renderAskPage();
    });

    expect(clientMocks.remove).not.toHaveBeenCalled();
  });

  it("keeps the empty Ask intro to its title", async () => {
    await act(async () => {
      renderAskPage();
    });

    expect(container.textContent).toContain("common.askIntroTitle");
    expect(container.textContent).not.toContain("common.askIntroBody");
    expect(container.querySelector(".analytics-chat-intro p")).toBeNull();
  });

  it("hides the Creative Context composer chip until its Lab is enabled", async () => {
    await act(async () => {
      renderAskPage();
    });

    expect(
      container.querySelector('[data-testid="creative-context-chip"]'),
    ).toBeNull();
  });

  it("shows the Creative Context composer chip when its Lab is enabled", async () => {
    clientMocks.creativeContextEnabled = true;

    await act(async () => {
      renderAskPage();
    });

    expect(
      container.querySelector('[data-testid="creative-context-chip"]'),
    ).not.toBeNull();
  });

  it("requests atomic dashboard selection cleanup on Ask entry", async () => {
    await act(async () => {
      renderAskPage();
    });

    expect(clientMocks.callAction).toHaveBeenCalledWith(
      "clear-selected-dashboard-object",
      {
        browserTabId: "test-tab",
        expectedSelection: expect.objectContaining({
          type: "dashboard",
          id: "dash-1",
        }),
        source: "test-tab",
      },
    );
  });

  it("does not clear after Ask has navigated away while reading selection", async () => {
    let resolveSelection: (value: Record<string, unknown>) => void = () => {};
    clientMocks.readClientAppState.mockReturnValue(
      new Promise((resolve) => {
        resolveSelection = resolve;
      }),
    );

    await act(async () => {
      renderAskPage();
    });
    window.history.pushState({}, "", "/dashboards/dash-2");

    await act(async () => {
      resolveSelection({
        type: "dashboard",
        id: "dash-1",
        __agentNativeSelectedObjectSource: "test-tab",
      });
      await Promise.resolve();
    });

    expect(clientMocks.callAction).not.toHaveBeenCalled();
    window.history.replaceState({}, "", "/");
  });
});
