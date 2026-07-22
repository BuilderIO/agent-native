// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ChatHistoryRailController,
  type UseChatHistoryRailControllerOptions,
  useChatHistoryRailController,
} from "./useChatHistoryRailController.js";

interface Item {
  id: string;
}

const labels = {
  newChat: "New chat",
  showMore: "Show more chats",
  showLess: "Show fewer chats",
};

function makeItems(count: number): Item[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `thread-${index + 1}`,
  }));
}

describe("useChatHistoryRailController", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: ChatHistoryRailController<Item>;

  function Harness(props: UseChatHistoryRailControllerOptions<Item>) {
    controller = useChatHistoryRailController(props);
    return null;
  }

  function render(options: Partial<UseChatHistoryRailControllerOptions<Item>>) {
    const props: UseChatHistoryRailControllerOptions<Item> = {
      items: makeItems(20),
      labels,
      onNewChat: () => {},
      ...options,
    };
    act(() => root.render(<Harness {...props} />));
  }

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

  it("progressively discloses the default five and fifteen item limits", () => {
    const items = makeItems(20);
    render({ items });

    expect(controller.expanded).toBe(false);
    expect(controller.collapsedLimit).toBe(5);
    expect(controller.expandedLimit).toBe(15);
    expect(controller.visibleItems).toEqual(items.slice(0, 5));
    expect(controller.canExpand).toBe(true);
    expect(controller.disclosureLabel).toBe("Show more chats");

    act(() => controller.toggleExpanded());

    expect(controller.expanded).toBe(true);
    expect(controller.visibleItems).toEqual(items.slice(0, 15));
    expect(controller.disclosureLabel).toBe("Show fewer chats");
  });

  it("clamps finite limits and hides a disclosure that cannot reveal items", () => {
    render({ previewCount: -2.5, expandedCount: 1.9 });

    expect(controller.collapsedLimit).toBe(1);
    expect(controller.expandedLimit).toBe(1);
    expect(controller.visibleItems).toHaveLength(1);
    expect(controller.canExpand).toBe(false);

    act(() => controller.toggleExpanded());
    expect(controller.expanded).toBe(false);
  });

  it("uses defaults for non-finite limits and never puts expanded below preview", () => {
    render({
      previewCount: Number.NaN,
      expandedCount: Number.POSITIVE_INFINITY,
    });
    expect(controller.collapsedLimit).toBe(5);
    expect(controller.expandedLimit).toBe(15);

    render({ previewCount: 8, expandedCount: 3 });
    expect(controller.collapsedLimit).toBe(8);
    expect(controller.expandedLimit).toBe(8);
  });

  it("resets disclosure explicitly and when the collection becomes too short", () => {
    render({});
    act(() => controller.toggleExpanded());
    expect(controller.expanded).toBe(true);

    act(() => controller.resetExpanded());
    expect(controller.expanded).toBe(false);

    act(() => controller.toggleExpanded());
    expect(controller.expanded).toBe(true);

    render({ items: makeItems(3) });
    expect(controller.expanded).toBe(false);
    expect(controller.canExpand).toBe(false);
    expect(controller.visibleItems).toHaveLength(3);
  });

  it("exposes view labels and the host new-chat action without UI assumptions", () => {
    const onNewChat = vi.fn();
    render({ onNewChat });

    expect(controller.newChatLabel).toBe("New chat");
    act(() => controller.onNewChat());
    expect(onNewChat).toHaveBeenCalledOnce();
  });
});
