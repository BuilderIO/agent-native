// @vitest-environment happy-dom

import { ChatHistoryRail } from "@agent-native/toolkit/chat-history/ChatHistoryRail";
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  lifecycle: vi.fn(),
  history: vi.fn(),
  navigate: vi.fn(),
  pin: vi.fn(),
  rename: vi.fn(),
  archive: vi.fn(),
  switchThread: vi.fn(),
  rail: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  useChatThreads: state.lifecycle,
  navigateWithAgentChatViewTransition: (_navigate: unknown, path: string) =>
    state.navigate(path),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, args?: { title?: string }) =>
    args?.title ? `${key}: ${args.title}` : key,
}));
vi.mock("@agent-native/toolkit/app/chat/ownership-history", () => ({
  useOwnershipChatHistory: state.history,
  ownDraftRows: () => [],
  OwnershipChatHistoryRail: ({
    railLabels,
    listProps,
    ...props
  }: ComponentProps<typeof ChatHistoryRail> & { listProps: object }) => {
    state.rail(props);
    return createElement(ChatHistoryRail, {
      ...listProps,
      ...props,
      railLabels: {
        ...railLabels,
        sections: {
          showAll: "Show all",
          showLess: "Show less",
          loadMore: "Load more",
          loadingMore: "Loading",
          retry: "Retry",
        },
      },
    } as ComponentProps<typeof ChatHistoryRail>);
  },
}));
vi.mock("@agent-native/toolkit/app/shared", () => ({
  AppSidebar: ({
    children,
    orgSwitcher,
  }: {
    children: ReactNode;
    orgSwitcher: ReactNode;
  }) => createElement("aside", null, children, orgSwitcher),
  AppSidebarNavItem: ({ label }: { label: string }) =>
    createElement("span", null, label),
  openCommandMenu: vi.fn(),
}));
vi.mock("@agent-native/toolkit/app/org", () => ({
  OrgSwitcher: () => createElement("div", { "data-org-switcher": true }),
}));
vi.mock("@agent-native/toolkit/app/feedback", () => ({
  FeedbackButton: () => null,
}));
vi.mock("@agent-native/toolkit/app/db-admin", () => ({
  DevDatabaseLink: () => null,
}));

import { Sidebar } from "./Sidebar";

const sharedItems = Array.from({ length: 7 }, (_, i) => ({
  id: `shared-${i}`,
  title: `Shared ${i}`,
  titleText: `Shared ${i}`,
  ownerLabel: "Owned by owner@example.test",
  accessLabel: i === 0 ? "Shared directly" : "Organization access",
  accessBasis: i === 0 ? "direct" : "organization",
  hideActions: true,
  pinned: false,
}));

describe("Brain ownership history adoption", () => {
  let root: Root;
  let container: HTMLDivElement;
  const render = (path = "/home/shared-0") =>
    act(() =>
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(Sidebar),
        ),
      ),
    );

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    state.archive.mockResolvedValue(true);
    state.delete.mockResolvedValue(true);
    state.lifecycle.mockReturnValue({
      threads: [],
      isNewThread: () => false,
      switchThread: state.switchThread,
      pinThread: state.pin,
      renameThread: state.rename,
      archiveThread: state.archive,
    });
    state.history.mockReturnValue({
      sections: [
        {
          id: "mine",
          label: "My chats",
          items: [
            {
              id: "mine",
              title: "Mine",
              titleText: "Mine",
              accessBasis: "owner",
            },
          ],
          previewCount: 5,
        },
        {
          id: "shared",
          label: "Shared with you",
          items: sharedItems,
          previewCount: 5,
        },
      ],
      listProps: {
        onTogglePin: vi.fn(),
        onRename: vi.fn(),
        onDelete: state.delete,
      },
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders attributed Shared rows without owner menus, with five-row disclosure", () => {
    render();
    expect(container.textContent).toContain("My chats");
    expect(container.textContent).toContain("Shared with you");
    expect(container.textContent).toContain("Owned by owner@example.test");
    expect(container.textContent).toContain("Shared directly");
    expect(container.textContent).toContain("Organization access");
    expect(container.querySelectorAll(".an-chat-history-row")).toHaveLength(6);
    expect(
      container.querySelectorAll(".an-chat-history-row__menu-trigger"),
    ).toHaveLength(1);
    const showAll = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Show all"),
    );
    expect(showAll).toBeDefined();
    act(() => showAll!.click());
    expect(container.querySelectorAll(".an-chat-history-row")).toHaveLength(8);
    expect(
      container.querySelectorAll(".an-chat-history-row__menu-trigger"),
    ).toHaveLength(1);
  });

  it("keeps adapter loading and recoverable errors visible", () => {
    const retry = vi.fn();
    state.history.mockReturnValue({
      sections: [
        {
          id: "mine",
          label: "My chats",
          items: [],
          loading: true,
          previewCount: 5,
        },
        {
          id: "shared",
          label: "Shared with you",
          items: [],
          error: "Could not load shared chats",
          onRetry: retry,
          previewCount: 5,
        },
      ],
      listProps: {},
    });
    render();
    expect(
      container.querySelector('[data-testid="chat-history-section-skeleton"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Could not load shared chats");
    const button = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    expect(button).toBeDefined();
    act(() => button!.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it("keeps lifecycle mutations and URL navigation while the adapter owns display", async () => {
    render();
    expect(state.lifecycle).toHaveBeenCalledWith(
      undefined,
      "brain",
      undefined,
      { ownership: "mine", autoCreate: false, restoreActiveThread: false },
    );
    const options =
      state.history.mock.calls[state.history.mock.calls.length - 1]![0];
    expect(options.activeId).toBe("shared-0");
    expect(options.mutations.pin).toBe(state.pin);
    expect(options.mutations.rename).toBe(state.rename);
    await options.mutations.pin("mine", true);
    await options.mutations.rename("mine", "Updated");
    expect(state.pin).toHaveBeenCalledWith("mine", true);
    expect(state.rename).toHaveBeenCalledWith("mine", "Updated");
    const shared = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Shared 0"),
    );
    expect(shared).toBeDefined();
    act(() => shared!.click());
    expect(state.switchThread).toHaveBeenCalledWith("shared-0");
    expect(state.navigate).toHaveBeenCalledWith("/home/shared-0");
    state.history.mockReturnValue({
      ...state.history.mock.results[state.history.mock.results.length - 1]!
        .value,
    });
    render();
    expect(
      state.history.mock.calls[state.history.mock.calls.length - 1]![0]
        .activeId,
    ).toBe("shared-0");
    expect(options.mutations.archive).toBe(state.archive);
    expect(
      container.querySelector(".an-chat-history-row--active")?.textContent,
    ).toContain("Shared 0");
  });

  it("opens New chat after an active archive succeeds, and stays put after a rejection", async () => {
    render("/home/mine");
    const onDelete =
      state.rail.mock.calls[state.rail.mock.calls.length - 1]![0].onDelete;
    state.delete.mockResolvedValueOnce(false);
    await act(async () => onDelete("mine"));
    expect(state.navigate).not.toHaveBeenCalled();
    await act(async () => onDelete("mine"));
    expect(state.delete).toHaveBeenLastCalledWith("mine");
    expect(state.navigate).toHaveBeenLastCalledWith("/home");
  });
});
