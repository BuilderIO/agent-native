// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatHistoryItem } from "./ChatHistoryList.js";
import { ChatHistoryRail } from "./ChatHistoryRail.js";

const railLabels = {
  newChat: "New chat",
  showMore: "Show more chats",
  showLess: "Show fewer chats",
};

function makeItems(count: number): ChatHistoryItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `thread-${index + 1}`,
    title: `Chat ${index + 1}`,
  }));
}

describe("ChatHistoryRail", () => {
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

  it("shows five recent chats before progressively disclosing up to fifteen", () => {
    act(() => {
      root.render(
        <ChatHistoryRail
          items={makeItems(20)}
          onSelect={() => {}}
          onNewChat={() => {}}
          railLabels={railLabels}
        />,
      );
    });

    expect(container.querySelectorAll(".an-chat-history-row")).toHaveLength(5);
    const disclosure = container.querySelector<HTMLButtonElement>(
      ".an-chat-history-rail__disclosure",
    );
    expect(disclosure?.getAttribute("aria-label")).toBe("Show more chats");

    act(() => disclosure?.click());
    expect(container.querySelectorAll(".an-chat-history-row")).toHaveLength(15);
    expect(disclosure?.getAttribute("aria-label")).toBe("Show fewer chats");

    act(() => disclosure?.click());
    expect(container.querySelectorAll(".an-chat-history-row")).toHaveLength(5);
  });

  it("keeps the disclosure to the right of new chat and calls its handler", () => {
    const onNewChat = vi.fn();
    act(() => {
      root.render(
        <ChatHistoryRail
          items={makeItems(6)}
          onSelect={() => {}}
          onNewChat={onNewChat}
          railLabels={railLabels}
        />,
      );
    });

    const disclosure = container.querySelector<HTMLButtonElement>(
      ".an-chat-history-rail__disclosure",
    );
    const newChat = container.querySelector<HTMLButtonElement>(
      ".an-chat-history-rail__new-chat",
    );
    expect(newChat?.textContent).toBe("New chat");
    expect(newChat?.nextElementSibling).toBe(disclosure);
    expect(newChat?.parentElement?.lastElementChild).toBe(disclosure);

    act(() => newChat?.click());
    expect(onNewChat).toHaveBeenCalledOnce();
  });

  it("lets new chat fill the footer when there are no more chats", () => {
    act(() => {
      root.render(
        <ChatHistoryRail
          items={makeItems(3)}
          onSelect={() => {}}
          onNewChat={() => {}}
          railLabels={railLabels}
        />,
      );
    });

    expect(
      container.querySelector(".an-chat-history-rail__disclosure"),
    ).toBeNull();
    expect(
      container.querySelector(".an-chat-history-rail__new-chat"),
    ).not.toBeNull();
  });

  it("preserves list actions for progressively disclosed rows", () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(
        <ChatHistoryRail
          items={makeItems(6)}
          onSelect={onSelect}
          onNewChat={() => {}}
          railLabels={railLabels}
        />,
      );
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(".an-chat-history-rail__disclosure")
        ?.click();
    });
    const rows = container.querySelectorAll<HTMLButtonElement>(
      ".an-chat-history-row__button",
    );
    act(() => rows[5]?.click());
    expect(onSelect).toHaveBeenCalledWith("thread-6");
  });
});
