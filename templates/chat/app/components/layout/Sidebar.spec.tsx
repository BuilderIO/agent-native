// @vitest-environment happy-dom

import type { ChatThreadSummary } from "@agent-native/toolkit/app/chat/agentkit-chat/rail";
import type { UseOwnershipChatHistoryOptions } from "@agent-native/toolkit/app/chat/ownership-history";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  threads: [] as ChatThreadSummary[],
  workingThreadIds: new Set<string>(),
  observedThreadStarts: new Map<string, number>(),
  historyOptions: vi.fn<(options: UseOwnershipChatHistoryOptions) => void>(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/chat/agentkit-chat/rail", () => ({
  useChatThreads: () => ({
    threads: state.threads,
    isNewThread: () => true,
  }),
  useAgentChatRunningThreads: () => state,
}));
vi.mock(
  "@agent-native/toolkit/app/chat/ownership-history",
  async (original) => ({
    ...(await original<
      typeof import("@agent-native/toolkit/app/chat/ownership-history")
    >()),
    useOwnershipChatHistory: (options: UseOwnershipChatHistoryOptions) => {
      state.historyOptions(options);
      return { sections: [], listProps: {} };
    },
    OwnershipChatHistoryRail: () => null,
  }),
);
vi.mock("@agent-native/toolkit/app/org", () => ({ OrgSwitcher: () => null }));
vi.mock("@agent-native/toolkit/app/shared", () => ({
  openCommandMenu: vi.fn(),
}));
vi.mock("@agent-native/toolkit/app/shared/AgentNativeIcon", () => ({
  AgentNativeIcon: () => null,
}));
vi.mock("@/lib/app-config", () => ({ APP_TITLE: "Chat" }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: () => null,
}));
vi.mock("@/components/ui/hover-card", () => ({
  HoverCard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  HoverCardTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  HoverCardContent: ({ children }: { children: React.ReactNode }) => (
    <div data-hover-details="">{children}</div>
  ),
}));

import { Sidebar } from "./Sidebar";

describe("Sidebar ownership history decorator", () => {
  let container: HTMLDivElement;
  let root: Root;
  const startedAt = Date.UTC(2026, 9, 15, 12);

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.threads = [];
    state.workingThreadIds.clear();
    state.observedThreadStarts.clear();
    state.historyOptions.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function captureDecorator() {
    act(() =>
      root.render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>,
      ),
    );
    const options = state.historyOptions.mock.lastCall?.[0];
    if (!options?.decorateItem)
      throw new Error("Sidebar did not supply its decorator");
    return options;
  }

  function renderTitle(
    options: UseOwnershipChatHistoryOptions,
    row: Parameters<
      NonNullable<UseOwnershipChatHistoryOptions["decorateItem"]>
    >[1],
  ) {
    if (!options.decorateItem) throw new Error("Missing Sidebar decorator");
    const item = options.decorateItem(
      { id: row.id, title: "Previous item title", titleText: row.title },
      row,
      { section: "mine" },
    );
    act(() => root.render(<>{item.title}</>));
  }

  function localDraft(options: UseOwnershipChatHistoryOptions) {
    const row = options.localMineRows?.[0];
    if (!row) throw new Error("Sidebar did not produce a local draft");
    return row;
  }

  it("decorates a scope-free owned draft and updates its running status", () => {
    state.threads = [
      {
        id: "draft",
        title: "Draft title",
        preview: "Draft preview",
        messageCount: 2,
        createdAt: startedAt,
        updatedAt: startedAt + 1000,
        scope: { type: "account", id: "example", label: "Server-only scope" },
        source: { appId: "server-only-app" },
      },
    ];
    state.workingThreadIds.add("draft");
    const options = captureDecorator();
    const row = localDraft(options);
    expect(row).not.toHaveProperty("scope");
    expect(row).not.toHaveProperty("source");
    renderTitle(options, row);

    expect(
      container.querySelector(".chat-sidebar-thread-title__content")
        ?.textContent,
    ).toBe("Draft title");
    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toBe("agentChat.status.working");
    expect(
      container.querySelector("[data-hover-details]")?.textContent,
    ).toContain("Draft preview");
    expect(
      container.querySelector("[data-hover-details]")?.textContent,
    ).toContain("2");
    expect(container.querySelector("time")?.dateTime).toBe(
      new Date(row.updatedAt).toISOString(),
    );
    expect(container.textContent).not.toContain("Server-only scope");
    expect(container.textContent).not.toContain("server-only-app");

    state.workingThreadIds.clear();
    renderTitle(captureDecorator(), row);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(
      container.querySelector(".chat-sidebar-thread-title__content")
        ?.textContent,
    ).toBe("Draft title");
  });

  it("renders progress for an observed start before its lifecycle summary arrives", () => {
    state.observedThreadStarts.set("draft", startedAt);
    state.workingThreadIds.add("draft");
    const options = captureDecorator();
    renderTitle(options, localDraft(options));

    expect(
      container.querySelector(".chat-sidebar-thread-title__content")
        ?.textContent,
    ).toBe("chat.untitledChat");
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector("time")?.dateTime).toBe(
      new Date(startedAt).toISOString(),
    );
    expect(
      container.querySelector("[data-hover-details]")?.textContent,
    ).toContain("0");
    expect(container.querySelector("[data-hover-details] p")).toBeNull();
  });

  it("uses the effective optimistic draft title instead of the original item title", () => {
    state.observedThreadStarts.set("draft", startedAt);
    const options = captureDecorator();
    renderTitle(options, {
      ...localDraft(options),
      title: "Optimistic rename",
    });

    expect(
      container.querySelector(".chat-sidebar-thread-title__content")
        ?.textContent,
    ).toBe("Optimistic rename");
    expect(
      container.querySelector("[data-hover-details]")?.textContent,
    ).toContain("Optimistic rename");
    expect(container.textContent).not.toContain("Previous item title");
  });

  it("preserves hover context, preview, pin and timestamps from server metadata", () => {
    const options = captureDecorator();
    renderTitle(options, {
      id: "persisted",
      title: "Server title",
      preview: "Server preview",
      messageCount: 7,
      createdAt: startedAt,
      updatedAt: Number.NaN,
      pinnedAt: startedAt,
      scope: { type: "account", id: "example", label: "Example account" },
      source: { appId: "example-app", platform: "web" },
      accessBasis: "owner",
      ownerEmail: "owner@example.test",
      visibility: "private",
    });

    expect(
      container.querySelector("[data-hover-details]")?.textContent,
    ).toContain("Example account · account · example-app · web");
    expect(
      container.querySelector("[data-hover-details]")?.textContent,
    ).toContain("Server preview");
    expect(
      container.querySelector("[data-hover-details]")?.textContent,
    ).toContain("chat.pinned");
    expect(container.querySelector("time")?.dateTime).toBe(
      new Date(startedAt).toISOString(),
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
