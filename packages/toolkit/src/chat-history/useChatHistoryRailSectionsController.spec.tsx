// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ChatHistoryRailSectionController,
  type ChatHistoryRailSectionControllerLabels,
  type ChatHistoryRailSectionInput,
  useChatHistoryRailSectionsController,
} from "./useChatHistoryRailController.js";

interface Item {
  id: string;
}

const labels: ChatHistoryRailSectionControllerLabels = {
  showAll: "Show all",
  showLess: "Show less",
  loadMore: "Load more",
  loadingMore: "Loading more",
  retry: "Retry",
};

function items(count: number): Item[] {
  return Array.from({ length: count }, (_, index) => ({ id: `c${index}` }));
}

describe("useChatHistoryRailSectionsController", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controllers: ChatHistoryRailSectionController<Item>[];

  function Harness({
    sections,
  }: {
    sections: ChatHistoryRailSectionInput<Item>[];
  }) {
    controllers = useChatHistoryRailSectionsController(sections, labels);
    return null;
  }
  const render = (sections: ChatHistoryRailSectionInput<Item>[]) =>
    act(() => root.render(<Harness sections={sections} />));
  const byId = (id: string) => controllers.find((c) => c.id === id)!;

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
  });

  it("previews five rows by default and discloses every loaded row, not fifteen", () => {
    render([{ id: "shared", items: items(40) }]);
    expect(byId("shared").visibleItems).toHaveLength(5);
    expect(byId("shared").canExpand).toBe(true);

    act(() => byId("shared").toggleExpanded());
    expect(byId("shared").visibleItems).toHaveLength(40);

    act(() => byId("shared").toggleExpanded());
    expect(byId("shared").visibleItems).toHaveLength(5);
  });

  it("keeps each section's disclosure independent", () => {
    render([
      { id: "mine", items: items(8) },
      { id: "shared", items: items(8) },
    ]);
    act(() => byId("shared").toggleExpanded());
    expect(byId("shared").expanded).toBe(true);
    expect(byId("mine").expanded).toBe(false);
    expect(byId("mine").visibleItems).toHaveLength(5);
  });

  it("does not offer disclosure for a short section the server has nothing more for", () => {
    render([{ id: "shared", items: items(5) }]);
    expect(byId("shared").canExpand).toBe(false);
    act(() => byId("shared").toggleExpanded());
    expect(byId("shared").expanded).toBe(false);
  });

  it("offers disclosure and load-more for a short section with more on the server", () => {
    const onLoadMore = vi.fn();
    render([{ id: "shared", items: items(3), hasMore: true, onLoadMore }]);
    expect(byId("shared").canExpand).toBe(true);
    expect(byId("shared").loadMore).toBeNull();

    act(() => byId("shared").toggleExpanded());
    byId("shared").loadMore?.();
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("treats hasMore without a loader as nothing more to show", () => {
    render([{ id: "shared", items: items(3), hasMore: true }]);
    expect(byId("shared").hasMore).toBe(false);
    expect(byId("shared").canExpand).toBe(false);
  });

  it("keeps a section disclosed while its rows are replaced by a page load", () => {
    const onLoadMore = vi.fn();
    render([{ id: "shared", items: items(6), hasMore: true, onLoadMore }]);
    act(() => byId("shared").toggleExpanded());
    render([{ id: "shared", items: items(12), hasMore: true, onLoadMore }]);
    expect(byId("shared").expanded).toBe(true);
    expect(byId("shared").visibleItems).toHaveLength(12);
  });

  it("collapses when nothing is left to disclose", () => {
    render([{ id: "shared", items: items(8) }]);
    act(() => byId("shared").toggleExpanded());
    render([{ id: "shared", items: items(2) }]);
    expect(byId("shared").expanded).toBe(false);
    expect(byId("shared").visibleItems).toHaveLength(2);
  });

  it("lets a section override the rail-level labels", () => {
    render([
      { id: "a", items: items(1) },
      { id: "b", items: items(1), labels: { showAll: "Everything" } },
    ]);
    expect(byId("a").labels.showAll).toBe("Show all");
    expect(byId("b").labels.showAll).toBe("Everything");
    expect(byId("b").labels.loadMore).toBe("Load more");
  });
});
