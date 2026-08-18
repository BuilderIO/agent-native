// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  contextItems: [] as Array<{ key: string; title: string; context: string }>,
  deleteClientAppState: vi.fn(async () => {}),
  readClientAppState: vi.fn(async (): Promise<unknown> => null),
  remove: vi.fn(),
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
  deleteClientAppState: clientMocks.deleteClientAppState,
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
    clientMocks.readClientAppState.mockResolvedValue(null);
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

  it.each([
    {
      type: "dashboard",
      id: "dash-1",
    },
    {
      type: "dashboard-panel",
      dashboardId: "dash-1",
      panelId: "panel-1",
    },
  ])("clears an owned dashboard selection on Ask entry", async (selection) => {
    clientMocks.readClientAppState.mockResolvedValueOnce({
      ...selection,
      __agentNativeSelectedObjectSource: "test-tab",
    });

    await act(async () => {
      root.render(<AskPage />);
    });

    expect(clientMocks.deleteClientAppState).toHaveBeenCalledWith(
      "selected-object",
      expect.objectContaining({ requestSource: "test-tab" }),
    );
  });

  it("does not clear a dashboard selection owned by another tab", async () => {
    clientMocks.readClientAppState.mockResolvedValueOnce({
      type: "dashboard",
      id: "dash-1",
      __agentNativeSelectedObjectSource: "other-tab",
    });

    await act(async () => {
      root.render(<AskPage />);
    });

    expect(clientMocks.deleteClientAppState).not.toHaveBeenCalled();
  });
});
