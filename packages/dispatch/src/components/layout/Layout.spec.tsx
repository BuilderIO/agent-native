// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip";
import { formatThreadAge, NavContent } from "./Layout";

const clientState = vi.hoisted(() => ({
  createThread: vi.fn<() => Promise<string | null>>(),
  switchThread: vi.fn(),
  threads: [] as Array<Record<string, unknown>>,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  AgentSidebar: ({ children }: { children: React.ReactNode }) => children,
  focusAgentChat: vi.fn(),
  navigateWithAgentChatViewTransition: (
    navigate: (path: string) => void,
    path: string,
  ) => navigate(path),
  useAgentChatHomeHandoff: () => false,
  useAgentChatHomeHandoffLinks: vi.fn(),
  useChatThreads: () => ({
    threads: clientState.threads,
    activeThreadId: "active-thread",
    isLoading: false,
    createThread: clientState.createThread,
    switchThread: clientState.switchThread,
    renameThread: vi.fn(),
    refreshThreads: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "",
  appPath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: undefined }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  LanguagePicker: () => <div>Language</div>,
  useT: () => (key: string, values?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      "dispatch.nav.chat": "Chat",
      "dispatch.nav.overview": "Overview",
      "dispatch.nav.apps": "Apps",
      "dispatch.nav.operate": "Operate",
      "dispatch.nav.advanced": "Advanced",
      "dispatch.sidebar.newChat": "New chat",
      "dispatch.sidebar.newDispatchChat": "New Dispatch chat",
      "dispatch.sidebar.renameChat": "Rename chat",
      "dispatch.sidebar.chatOptions": `Options for ${values?.title ?? ""}`,
      "dispatch.sidebar.renameThread": `Rename ${values?.title ?? ""}`,
      "sidebar.collapseSidebar": "Collapse sidebar",
      "sidebar.expandSidebar": "Expand sidebar",
    };
    return messages[key] ?? String(values?.defaultValue ?? key);
  },
}));

vi.mock("@agent-native/core/client/navigation", () => ({
  openCommandMenu: vi.fn(),
}));

vi.mock("@agent-native/core/client/ui", () => ({
  FeedbackButton: () => <div>Feedback</div>,
}));

vi.mock("@agent-native/core/client/org", () => ({
  InvitationBanner: () => null,
  OrgSwitcher: () => <div>Organization</div>,
}));

describe("formatThreadAge", () => {
  const now = 2_000_000_000_000;

  it.each([
    [0, "now"],
    [2 * 60 * 60_000, "2h"],
    [7 * 24 * 60 * 60_000, "7d"],
    [21 * 24 * 60 * 60_000, "3w"],
    [365 * 24 * 60 * 60_000, "1y"],
  ])("formats %i milliseconds as %s", (elapsed, expected) => {
    expect(formatThreadAge(now - elapsed, now)).toBe(expected);
  });
});

describe("Dispatch NavContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    clientState.createThread.mockResolvedValue("new-thread");
    clientState.switchThread.mockReset();
    clientState.threads = [
      {
        id: "active-thread",
        title: "Current Dispatch work",
        messageCount: 2,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      },
      {
        id: "older-thread",
        title: "Earlier Dispatch work",
        messageCount: 1,
        updatedAt: Date.now() - 5 * 60_000,
        createdAt: Date.now() - 5 * 60_000,
      },
    ];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("puts Overview before Chat in the primary navigation", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <TooltipProvider>
            <NavContent />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const primaryLabels = [...container.querySelectorAll("nav a")].map((link) =>
      link.textContent?.trim(),
    );
    expect(primaryLabels.indexOf("Overview")).toBeLessThan(
      primaryLabels.indexOf("Chat"),
    );
  });

  it("keeps collapsed navigation compact and preserves section spacing", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <TooltipProvider>
            <NavContent collapsed />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const lists = [...container.querySelectorAll("nav > ul")];
    expect(lists).toHaveLength(4);
    expect(lists[0].className).toContain("gap-1");
    expect(lists[1].className).toContain("mt-5");
    expect(lists[1].className).toContain("gap-1");
    expect(lists[2].className).toContain("mt-3");
    expect(lists[2].className).toContain("gap-1");
    expect(lists[3].querySelector('a[href="/settings"]')).not.toBeNull();
    expect(lists[0].querySelector("a")?.className).toContain("h-8 w-8");
  });

  it("uses the shared chat history rail and retains thread actions", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/active-thread"]}>
          <TooltipProvider>
            <NavContent />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).not.toContain("Chats");
    expect(container.textContent).toContain("Current Dispatch work");
    expect(container.textContent).toContain("Earlier Dispatch work");
    expect(container.textContent).toContain("New chat");
    expect(container.textContent).toContain("5m");
    const age = [...container.querySelectorAll("span")].find(
      (element) => element.textContent === "5m",
    );
    expect(age?.className).toContain("an-chat-history-row__timestamp");
    const historyList = container.querySelector(
      '[data-agent-native="chat-history-list"]',
    );
    expect(historyList?.className).toContain("an-chat-history--rail");
    expect(
      container.querySelector('img[src="/agent-native-icon-light.svg"]')
        ?.parentElement?.className,
    ).not.toContain("border");
    expect(container.textContent).not.toContain("Workspace control plane");

    const threadButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Earlier Dispatch work"),
    );
    expect(threadButton).toBeDefined();
    await act(async () => {
      threadButton?.click();
    });
    expect(clientState.switchThread).toHaveBeenCalledWith("older-thread");

    const newChatButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("New chat"),
    );
    expect(newChatButton).toBeDefined();
    await act(async () => {
      newChatButton?.click();
    });
    expect(clientState.createThread).toHaveBeenCalledOnce();
    expect(clientState.switchThread).toHaveBeenCalledWith("new-thread");
  });
});
