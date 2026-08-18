// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  contextItems: [] as Array<{ key: string; title: string; context: string }>,
  callAction: vi.fn(async () => ({ cleared: true })),
  remove: vi.fn(),
  readClientAppState: vi.fn(async () => null as Record<string, unknown> | null),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  AgentChatSurface: () => <div data-testid="chat" />,
  useAgentChatContext: () => ({
    items: clientMocks.contextItems,
    remove: clientMocks.remove,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
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

  beforeEach(() => {
    vi.clearAllMocks();
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
        root.render(<AskPage />);
      });

      expect(clientMocks.remove).toHaveBeenCalledWith(key);
    },
  );

  it("preserves unrelated composer context", async () => {
    clientMocks.contextItems = [
      { key: "other-context", title: "Other", context: "Keep this" },
    ];

    await act(async () => {
      root.render(<AskPage />);
    });

    expect(clientMocks.remove).not.toHaveBeenCalled();
  });

  it("requests atomic dashboard selection cleanup on Ask entry", async () => {
    await act(async () => {
      root.render(<AskPage />);
    });

    expect(clientMocks.callAction).toHaveBeenCalledWith(
      "clear-selected-dashboard-object",
      {
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
      root.render(<AskPage />);
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
