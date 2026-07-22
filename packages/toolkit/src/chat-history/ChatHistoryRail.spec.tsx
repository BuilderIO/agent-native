// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionButton } from "../design-system/components.js";
import { defineDesignSystem } from "../design-system/definition.js";
import { ToolkitProvider } from "../provider.js";
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

  it("lets a design system replace the whole view without replacing its controller", () => {
    const onNewChat = vi.fn();
    const CustomActionButton = vi.fn(
      ({ children, onPress }: Parameters<typeof ActionButton>[0]) => (
        <button
          data-acme-action
          type="button"
          onClick={(event) => onPress?.(event)}
        >
          {children}
        </button>
      ),
    );
    const designSystem = defineDesignSystem({
      name: "Acme",
      components: { ActionButton: CustomActionButton },
    });

    act(() => {
      root.render(
        <ToolkitProvider designSystem={designSystem}>
          <ChatHistoryRail
            items={makeItems(20)}
            onSelect={() => {}}
            onNewChat={onNewChat}
            railLabels={railLabels}
            renderRail={({ controller }) => (
              <section data-acme-rail>
                <output>{controller.visibleItems.length}</output>
                <ActionButton onPress={controller.onNewChat}>
                  {controller.newChatLabel}
                </ActionButton>
                <ActionButton onPress={controller.toggleExpanded}>
                  {controller.disclosureLabel}
                </ActionButton>
              </section>
            )}
          />
        </ToolkitProvider>,
      );
    });

    const actions =
      container.querySelectorAll<HTMLButtonElement>("[data-acme-action]");
    expect(container.querySelector("[data-acme-rail]")).not.toBeNull();
    expect(container.querySelector("output")?.textContent).toBe("5");
    expect(actions[1]?.textContent).toBe("Show more chats");

    act(() => actions[1]?.click());
    expect(container.querySelector("output")?.textContent).toBe("15");
    expect(actions[1]?.textContent).toBe("Show fewer chats");

    act(() => actions[0]?.click());
    expect(onNewChat).toHaveBeenCalledOnce();
    expect(CustomActionButton).toHaveBeenCalled();
  });

  it("keeps native button semantics and focus in the default view", () => {
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

    const newChat = container.querySelector<HTMLButtonElement>(
      ".an-chat-history-rail__new-chat",
    );
    newChat?.focus();
    act(() => newChat?.click());

    expect(newChat?.type).toBe("button");
    expect(document.activeElement).toBe(newChat);
    expect(onNewChat).toHaveBeenCalledOnce();
  });

  it("falls back to the default rail when a product renderer fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => {
      root.render(
        <ChatHistoryRail
          items={makeItems(6)}
          onSelect={() => {}}
          onNewChat={() => {}}
          railLabels={railLabels}
          renderRail={() => {
            throw new Error("broken company rail");
          }}
        />,
      );
    });

    expect(
      container.querySelector(".an-chat-history-rail__new-chat"),
    ).not.toBeNull();
  });
});
