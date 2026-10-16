// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatFirstChatHistory } from "./chat-history.js";

describe("ChatFirstChatHistory", () => {
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
  });

  it("keeps an empty rail section available to consume remaining height", () => {
    act(() => {
      root.render(
        <ChatFirstChatHistory
          items={[]}
          loading
          loadingLabel={<span>Loading chats</span>}
          emptyLabel="No chats yet."
        />,
      );
    });

    const section = container.querySelector<HTMLElement>(
      "[data-chat-first-chat-history]",
    );
    expect(section).not.toBeNull();
    expect(section?.className).toContain("flex-1");
    expect(container.textContent).toBe("");
  });

  it("renders contextual actions beside the Chats label", () => {
    act(() => {
      root.render(
        <ChatFirstChatHistory
          items={[{ id: "chat-1", title: "First chat" }]}
          onSelect={() => {}}
          headerAction={
            <button type="button" aria-label="Chat list options">
              Options
            </button>
          }
        />,
      );
    });

    expect(
      container.querySelector("[data-chat-first-chat-history-header]"),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Chat list options"]'),
    ).not.toBe(null);
    expect(container.textContent).toContain("Chats");
  });

  it("lets the Chats heading return focus to the current conversation", () => {
    const onOpenChats = vi.fn();
    act(() => {
      root.render(
        <ChatFirstChatHistory
          items={[{ id: "chat-1", title: "First chat" }]}
          onSelect={() => {}}
          label={
            <button type="button" onClick={onOpenChats}>
              Chats
            </button>
          }
        />,
      );
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          "[data-chat-first-chat-history-header] button",
        )
        ?.click();
    });

    expect(onOpenChats).toHaveBeenCalledOnce();
  });

  it("uses the section rail with independent disclosure and no New chat footer", () => {
    const onSelect = vi.fn();
    const onNewChat = vi.fn();
    act(() => {
      root.render(
        <ChatFirstChatHistory
          sections={[
            {
              id: "shared",
              label: "Shared with you",
              previewCount: 5,
              items: Array.from({ length: 6 }, (_, index) => ({
                id: `shared-${index}`,
                title: `Shared ${index}`,
                hideActions: true,
                ownerLabel: "Owned by Pat",
                accessLabel: "Shared directly",
              })),
            },
          ]}
          onSelect={onSelect}
          onNewChat={onNewChat}
          showNewChat={false}
          railLabels={{ newChat: "Start a chat" }}
        />,
      );
    });
    expect(container.querySelectorAll(".an-chat-history-row")).toHaveLength(5);
    expect(container.querySelector(".an-chat-history-rail__footer")).toBeNull();
    expect(
      container.querySelector(".an-chat-history-row__menu-trigger"),
    ).toBeNull();
    expect(container.textContent).toContain("Owned by Pat");
    expect(container.textContent).toContain("Shared directly");
    const toggle = container.querySelector<HTMLButtonElement>(
      ".an-chat-history-rail__section-toggle",
    )!;
    expect(toggle.textContent).toBe("Show all");
    act(() => toggle.click());
    expect(container.querySelectorAll(".an-chat-history-row")).toHaveLength(6);
    expect(toggle.textContent).toBe("Show less");
    act(() => {
      container
        .querySelector<HTMLButtonElement>(".an-chat-history-row__button")!
        .click();
    });
    expect(onSelect).toHaveBeenCalledWith("shared-0");
    expect(onNewChat).not.toHaveBeenCalled();
  });

  it("keeps the required New chat action on the common section footer", () => {
    const onNewChat = vi.fn();
    act(() => {
      root.render(
        <ChatFirstChatHistory
          sections={[{ id: "mine", items: [], emptyLabel: "No owned chats" }]}
          onSelect={() => {}}
          onNewChat={onNewChat}
          railLabels={{ newChat: "Start a chat" }}
        />,
      );
    });
    expect(container.textContent).toContain("No owned chats");
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".an-chat-history-rail__new-chat",
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("Start a chat");
    act(() => buttons[0].click());
    expect(onNewChat).toHaveBeenCalledOnce();
  });
});
