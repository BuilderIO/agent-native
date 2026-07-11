// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatHistoryList,
  type ChatHistoryItem,
  type ChatHistorySection,
} from "./ChatHistoryList.js";

function item(
  overrides: Partial<ChatHistoryItem> & { id: string },
): ChatHistoryItem {
  return {
    title: overrides.id,
    ...overrides,
  };
}

/** React tracks the DOM input's value via a wrapped setter to decide whether
 * to fire its synthetic change handler, so setting `.value` directly is not
 * observed. Go through the native prototype setter instead, matching the
 * pattern used by CommandMenu.spec.tsx. */
function typeIntoInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("ChatHistoryList", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders a flat item list and calls onSelect when a row is clicked", () => {
    const onSelect = vi.fn();
    const items: ChatHistoryItem[] = [
      item({ id: "thread-1", title: "First chat", timestamp: "Yesterday" }),
      item({ id: "thread-2", title: "Second chat", timestamp: "2 min ago" }),
    ];

    act(() => {
      root.render(<ChatHistoryList items={items} onSelect={onSelect} />);
    });

    const titles = Array.from(
      container.querySelectorAll(".an-chat-history-row__title"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["First chat", "Second chat"]);
    expect(container.textContent).toContain("Yesterday");
    expect(container.textContent).toContain("2 min ago");

    const buttons = container.querySelectorAll(".an-chat-history-row__button");
    act(() => {
      (buttons[1] as HTMLButtonElement).click();
    });
    expect(onSelect).toHaveBeenCalledWith("thread-2");
  });

  it("highlights the active item", () => {
    const items: ChatHistoryItem[] = [
      item({ id: "thread-1" }),
      item({ id: "thread-2" }),
    ];

    act(() => {
      root.render(
        <ChatHistoryList
          items={items}
          activeId="thread-2"
          onSelect={() => {}}
        />,
      );
    });

    const rows = container.querySelectorAll(".an-chat-history-row");
    expect(rows[0].className).not.toContain("an-chat-history-row--active");
    expect(rows[1].className).toContain("an-chat-history-row--active");
  });

  it("renders grouped sections with labels", () => {
    const sections: ChatHistorySection[] = [
      {
        id: "scoped",
        label: "This deck",
        items: [item({ id: "thread-1", title: "Deck chat" })],
      },
      {
        id: "other",
        label: "All chats",
        items: [item({ id: "thread-2", title: "Other chat" })],
      },
    ];

    act(() => {
      root.render(<ChatHistoryList sections={sections} onSelect={() => {}} />);
    });

    const labels = Array.from(
      container.querySelectorAll(".an-chat-history__section-label"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["This deck", "All chats"]);
  });

  it("shows the empty state, distinguishing plain-empty from no-search-results", () => {
    act(() => {
      root.render(<ChatHistoryList items={[]} onSelect={() => {}} />);
    });
    expect(container.textContent).toContain("No chats yet");

    act(() => {
      root.render(
        <ChatHistoryList
          items={[]}
          searchValue="foo"
          onSearchChange={() => {}}
          onSelect={() => {}}
        />,
      );
    });
    expect(container.textContent).toContain("No matching chats");
  });

  it("shows a loading state instead of the list", () => {
    const items: ChatHistoryItem[] = [item({ id: "thread-1" })];
    act(() => {
      root.render(
        <ChatHistoryList
          items={items}
          loading
          loadingLabel="Searching..."
          onSelect={() => {}}
        />,
      );
    });
    expect(container.textContent).toContain("Searching...");
    expect(container.querySelector(".an-chat-history-row")).toBeNull();
  });

  it("shows an error state that takes priority over loading and items", () => {
    const items: ChatHistoryItem[] = [item({ id: "thread-1" })];
    act(() => {
      root.render(
        <ChatHistoryList
          items={items}
          loading
          error="Could not load chats"
          onSelect={() => {}}
        />,
      );
    });
    expect(container.textContent).toContain("Could not load chats");
    expect(container.querySelector(".an-chat-history-row")).toBeNull();
  });

  it("renders a controlled search box only when onSearchChange is supplied", () => {
    const onSearchChange = vi.fn();
    act(() => {
      root.render(
        <ChatHistoryList
          items={[]}
          searchValue="abc"
          onSearchChange={onSearchChange}
          onSelect={() => {}}
        />,
      );
    });
    const input = container.querySelector<HTMLInputElement>(
      ".an-chat-history__search-input",
    );
    expect(input).not.toBeNull();
    expect(input!.value).toBe("abc");

    act(() => {
      typeIntoInput(input!, "abcd");
    });
    expect(onSearchChange).toHaveBeenCalledWith("abcd");

    act(() => {
      root.render(<ChatHistoryList items={[]} onSelect={() => {}} />);
    });
    expect(
      container.querySelector(".an-chat-history__search-input"),
    ).toBeNull();
  });

  it("does not render a row action menu when no menu callbacks are given", () => {
    const items: ChatHistoryItem[] = [item({ id: "thread-1" })];
    act(() => {
      root.render(<ChatHistoryList items={items} onSelect={() => {}} />);
    });
    expect(container.querySelector(".an-chat-history-row__menu")).toBeNull();
  });

  it("supports pin toggling via the row action menu", () => {
    const onTogglePin = vi.fn();
    const items: ChatHistoryItem[] = [
      item({ id: "thread-1", title: "First chat" }),
    ];
    act(() => {
      root.render(
        <ChatHistoryList
          items={items}
          onSelect={() => {}}
          onTogglePin={onTogglePin}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      ".an-chat-history-row__menu-trigger",
    );
    expect(trigger).not.toBeNull();
    act(() => {
      trigger!.click();
    });

    const pinItem = Array.from(
      container.querySelectorAll(".an-chat-history-row__menu-item"),
    ).find((el) => el.textContent?.includes("Pin to top"));
    expect(pinItem).toBeDefined();
    act(() => {
      (pinItem as HTMLButtonElement).click();
    });
    expect(onTogglePin).toHaveBeenCalledWith("thread-1");
  });

  it("supports inline rename via the row action menu", () => {
    const onRename = vi.fn();
    const items: ChatHistoryItem[] = [
      item({ id: "thread-1", title: "Old title", titleText: "Old title" }),
    ];
    act(() => {
      root.render(
        <ChatHistoryList
          items={items}
          onSelect={() => {}}
          onRename={onRename}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      ".an-chat-history-row__menu-trigger",
    );
    act(() => {
      trigger!.click();
    });
    const renameItem = Array.from(
      container.querySelectorAll(".an-chat-history-row__menu-item"),
    ).find((el) => el.textContent?.includes("Rename"));
    act(() => {
      (renameItem as HTMLButtonElement).click();
    });

    const input = container.querySelector<HTMLInputElement>(
      ".an-chat-history-row__rename-input",
    );
    expect(input).not.toBeNull();
    expect(input!.value).toBe("Old title");

    act(() => {
      typeIntoInput(input!, "New title");
    });
    act(() => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onRename).toHaveBeenCalledWith("thread-1", "New title");
  });

  it("renders the footer inside the scroll region regardless of list state", () => {
    act(() => {
      root.render(
        <ChatHistoryList
          items={[]}
          onSelect={() => {}}
          footer={<div data-testid="footer">Load older chats</div>}
        />,
      );
    });
    expect(container.textContent).toContain("Load older chats");
  });
});
