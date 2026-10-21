// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatHistoryItem } from "./ChatHistoryList.js";
import {
  ChatHistoryRail,
  DefaultChatHistoryRailView,
  type ChatHistoryRailSection,
} from "./ChatHistoryRail.js";

const railLabels = {
  newChat: "New chat",
  showMore: "Show more chats",
  showLess: "Show fewer chats",
  sections: {
    showAll: "Show all shared",
    showLess: "Show fewer shared",
    loadMore: "Load more shared",
    loadingMore: "Loading shared",
    retry: "Retry shared",
  },
};

function makeItems(prefix: string, count: number): ChatHistoryItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    title: `${prefix} ${index + 1}`,
    titleText: `${prefix} ${index + 1}`,
  }));
}

describe("ChatHistoryRail sections", () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderRail(
    sections: ChatHistoryRailSection[],
    extra: Record<string, unknown> = {},
  ) {
    act(() => {
      root.render(
        <ChatHistoryRail
          sections={sections}
          onSelect={() => {}}
          onNewChat={() => {}}
          railLabels={railLabels}
          {...extra}
        />,
      );
    });
  }
  const section = (id: string) =>
    container.querySelector<HTMLElement>(`[data-section-id="${id}"]`)!;
  const rows = (id: string) =>
    section(id).querySelectorAll(".an-chat-history-row");
  const buttonByText = (scope: ParentNode, text: string) =>
    Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes(text),
    );

  it("previews five shared rows, shows all of them, then collapses again", () => {
    renderRail([
      { id: "mine", label: "My chats", items: makeItems("mine", 3) },
      {
        id: "shared",
        label: "Shared with you",
        items: makeItems("shared", 22),
      },
    ]);

    expect(rows("mine")).toHaveLength(3);
    expect(rows("shared")).toHaveLength(5);
    expect(buttonByText(section("mine"), "Show all shared")).toBeUndefined();

    const toggle = buttonByText(section("shared"), "Show all shared")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle.click());
    expect(rows("shared")).toHaveLength(22);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe("Show fewer shared");
    expect(rows("mine")).toHaveLength(3);

    act(() => toggle.click());
    expect(rows("shared")).toHaveLength(5);
  });

  it("expands one section without touching another long section", () => {
    renderRail([
      { id: "mine", items: makeItems("mine", 9) },
      { id: "shared", items: makeItems("shared", 9) },
    ]);
    act(() => buttonByText(section("shared"), "Show all shared")?.click());
    expect(rows("shared")).toHaveLength(9);
    expect(rows("mine")).toHaveLength(5);
  });

  it("pages the server: load-more appears once disclosed and is not capped at fifteen", () => {
    const onLoadMore = vi.fn();
    const render = (count: number, hasMore: boolean) =>
      renderRail([
        {
          id: "shared",
          items: makeItems("shared", count),
          hasMore,
          onLoadMore,
        },
      ]);
    render(20, true);

    expect(buttonByText(section("shared"), "Load more shared")).toBeUndefined();
    act(() => buttonByText(section("shared"), "Show all shared")?.click());
    expect(rows("shared")).toHaveLength(20);

    act(() => buttonByText(section("shared"), "Load more shared")?.click());
    expect(onLoadMore).toHaveBeenCalledOnce();

    render(40, true);
    expect(rows("shared")).toHaveLength(40);

    render(40, false);
    expect(buttonByText(section("shared"), "Load more shared")).toBeUndefined();
    expect(rows("shared")).toHaveLength(40);
  });

  it("offers Show all for a short first page when the server has more", () => {
    const onLoadMore = vi.fn();
    renderRail([
      {
        id: "shared",
        items: makeItems("shared", 2),
        hasMore: true,
        onLoadMore,
      },
    ]);
    act(() => buttonByText(section("shared"), "Show all shared")?.click());
    act(() => buttonByText(section("shared"), "Load more shared")?.click());
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("shows a pending load-more that cannot be fired twice", () => {
    const onLoadMore = vi.fn();
    renderRail([
      {
        id: "shared",
        items: makeItems("shared", 8),
        hasMore: true,
        loadingMore: true,
        onLoadMore,
      },
    ]);
    act(() => buttonByText(section("shared"), "Show all shared")?.click());
    const pending = buttonByText(section("shared"), "Loading shared")!;
    expect(pending.disabled).toBe(true);
    act(() => pending.click());
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("lets one section load, fail, or sit empty without touching the others", () => {
    const onRetry = vi.fn();
    renderRail([
      { id: "mine", items: makeItems("mine", 2) },
      { id: "shared", items: [], loading: true },
      { id: "org", items: [], error: "Load failed", onRetry },
      { id: "empty", items: [], emptyLabel: "Nothing here" },
    ]);

    expect(rows("mine")).toHaveLength(2);
    expect(
      section("shared").querySelector('[aria-busy="true"]'),
    ).not.toBeNull();
    expect(section("shared").textContent).not.toContain("Nothing");
    expect(section("org").textContent).toContain("Load failed");
    expect(section("empty").textContent).toBe("Nothing here");

    act(() => buttonByText(section("org"), "Retry shared")?.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps already-loaded rows visible when a later load fails", () => {
    renderRail([
      {
        id: "shared",
        items: makeItems("shared", 3),
        error: "Load more failed",
      },
    ]);
    expect(rows("shared")).toHaveLength(3);
    expect(
      section("shared").querySelector('[role="alert"]')?.textContent,
    ).toContain("Load more failed");
  });

  it("does not show the global empty state while a section has a state of its own", () => {
    renderRail([{ id: "shared", items: [], loading: true }], {
      emptyLabel: "No chats yet",
    });
    expect(container.textContent).not.toContain("No chats yet");
  });

  it("shows the global empty state when every section is empty and has no state", () => {
    renderRail(
      [
        { id: "mine", label: "My chats", items: [] },
        { id: "shared", label: "Shared with you", items: [] },
      ],
      { emptyLabel: "No chats yet" },
    );

    expect(
      container.querySelector(".an-chat-history__state")?.textContent,
    ).toBe("No chats yet");
    expect(
      container.querySelectorAll(".an-chat-history__section-label"),
    ).toHaveLength(0);
  });

  it("shows a section empty message instead of the global empty state", () => {
    renderRail(
      [
        {
          id: "shared",
          label: "Shared",
          items: [],
          emptyLabel: "No shared chats",
        },
      ],
      {
        emptyLabel: "No chats yet",
      },
    );

    expect(container.textContent).toContain("No shared chats");
    expect(container.textContent).not.toContain("No chats yet");
  });

  it("keeps zero-row server paging controls reachable", () => {
    const onLoadMore = vi.fn();
    renderRail([
      {
        id: "mine",
        label: "My chats",
        items: [],
        hasMore: true,
        onLoadMore,
      },
    ]);

    const mineSection = section("mine");
    const showAll = buttonByText(mineSection, "Show all shared")!;
    expect(showAll).toBeDefined();
    act(() => showAll.click());

    const loadMore = buttonByText(mineSection, "Load more shared")!;
    expect(loadMore).toBeDefined();
    act(() => loadMore.click());
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("renders owner and access basis on a shared row", () => {
    renderRail([
      {
        id: "shared",
        items: [
          {
            id: "s1",
            title: "Roadmap",
            ownerLabel: "Pat Lee",
            accessLabel: "Shared with your organization",
            accessBasis: "organization",
          },
        ],
      },
    ]);
    const access = container.querySelector(".an-chat-history-row__access");
    expect(access?.getAttribute("data-access-basis")).toBe("organization");
    expect(access?.textContent).toBe("Pat LeeShared with your organization");
  });

  it("selecting a section row and New chat work as in the flat rail", () => {
    const onSelect = vi.fn();
    const onNewChat = vi.fn();
    const onRename = vi.fn();
    renderRail([{ id: "mine", items: makeItems("mine", 2) }], {
      onSelect,
      onNewChat,
      onRename,
    });

    act(() =>
      container
        .querySelectorAll<HTMLButtonElement>(".an-chat-history-row__button")[1]
        ?.click(),
    );
    expect(onSelect).toHaveBeenCalledWith("mine-2");

    act(() =>
      container
        .querySelector<HTMLButtonElement>(".an-chat-history-rail__new-chat")
        ?.click(),
    );
    expect(onNewChat).toHaveBeenCalledOnce();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("renders sections and disclosures without a New chat button when showNewChat is false", () => {
    const onNewChat = vi.fn();
    act(() => {
      root.render(
        <ChatHistoryRail
          sections={[
            { id: "mine", label: "My chats", items: makeItems("mine", 2) },
            { id: "shared", label: "Shared", items: makeItems("shared", 8) },
          ]}
          onSelect={() => {}}
          onNewChat={onNewChat}
          showNewChat={false}
          railLabels={railLabels}
          renderRail={({ controller, ...context }) => (
            <>
              <button
                type="button"
                data-custom-new-chat
                onClick={() => controller.onNewChat()}
              />
              <DefaultChatHistoryRailView
                controller={controller}
                {...context}
              />
            </>
          )}
        />,
      );
    });

    expect(rows("mine")).toHaveLength(2);
    expect(rows("shared")).toHaveLength(5);
    expect(
      container.querySelector(".an-chat-history-rail__new-chat"),
    ).toBeNull();
    expect(container.querySelector(".an-chat-history-rail__footer")).toBeNull();
    act(() => buttonByText(section("shared"), "Show all shared")?.click());
    expect(rows("shared")).toHaveLength(8);

    act(() =>
      container
        .querySelector<HTMLButtonElement>("[data-custom-new-chat]")
        ?.click(),
    );
    expect(onNewChat).toHaveBeenCalledOnce();
  });

  it("shows the New chat button on a sectioned rail by default", () => {
    renderRail([{ id: "mine", items: makeItems("mine", 2) }]);
    expect(
      container.querySelector(".an-chat-history-rail__new-chat"),
    ).not.toBeNull();
  });

  it("keeps the flat items rail on its own five/fifteen cap", () => {
    act(() => {
      root.render(
        <ChatHistoryRail
          items={makeItems("flat", 30)}
          onSelect={() => {}}
          onNewChat={() => {}}
          railLabels={{
            newChat: "New chat",
            showMore: "Show more chats",
            showLess: "Show fewer chats",
          }}
        />,
      );
    });
    expect(container.querySelectorAll(".an-chat-history-row")).toHaveLength(5);
    act(() =>
      container
        .querySelector<HTMLButtonElement>(".an-chat-history-rail__disclosure")
        ?.click(),
    );
    expect(container.querySelectorAll(".an-chat-history-row")).toHaveLength(15);
  });

  it("hands custom renderers the section controllers", () => {
    renderRail([{ id: "shared", items: makeItems("shared", 9) }], {
      renderRail: ({
        sections,
      }: {
        sections: { controller: { visibleItems: unknown[] } }[];
      }) => <output>{sections[0]?.controller.visibleItems.length}</output>,
    });
    expect(container.querySelector("output")?.textContent).toBe("5");
  });
});
