// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  contextItems: [] as Array<{ key: string; title: string; context: string }>,
  remove: vi.fn(),
}));

vi.mock("@agent-native/core/client", () => ({
  AgentChatSurface: () => <div data-testid="chat" />,
  useAgentChatContext: () => ({
    items: clientMocks.contextItems,
    remove: clientMocks.remove,
  }),
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/chat-handoff", () => ({
  ANALYTICS_CHAT_STORAGE_KEY: "analytics-chat",
  hasRecentAnalyticsChat: () => false,
}));

vi.mock("@/lib/tab-id", () => ({ TAB_ID: "test-tab" }));

import AskPage from "./Ask";

describe("AskPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.contextItems = [];
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
});
