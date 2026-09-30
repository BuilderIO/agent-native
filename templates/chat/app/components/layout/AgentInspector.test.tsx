// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sidebar, navigateChat, focusChat } = vi.hoisted(() => ({
  sidebar: vi.fn(),
  navigateChat: vi.fn(),
  focusChat: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  navigateWithAgentChatViewTransition: navigateChat,
}));
vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentSidebar: (props: Record<string, unknown>) => {
    sidebar(props);
    return null;
  },
  focusAgentChat: focusChat,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/lib/tab-id", () => ({ TAB_ID: "chat-test" }));

import { AgentInspector } from "./AgentInspector";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

describe("global chat inspector fullscreen", () => {
  it.each([
    ["existing-thread", "/chat/existing-thread"],
    ["thread/with space", "/chat/thread%2Fwith%20space"],
    [undefined, "/home"],
  ])(
    "preserves thread %s, falling back to home only without a current thread",
    (threadId, path) => {
      act(() =>
        root.render(
          <MemoryRouter initialEntries={["/settings/agent"]}>
            <AgentInspector
              chatHomeHandoffActive={false}
              chatHomeHandoffPending={false}
            >
              Content
            </AgentInspector>
          </MemoryRouter>,
        ),
      );
      const props = sidebar.mock.lastCall![0];
      expect(props).toMatchObject({
        storageKey: "chat",
        browserTabId: "chat-test",
      });
      act(() => props.onFullscreenRequest(threadId));
      expect(focusChat).toHaveBeenCalledOnce();
      expect(navigateChat).toHaveBeenCalledWith(expect.any(Function), path);
    },
  );
});
