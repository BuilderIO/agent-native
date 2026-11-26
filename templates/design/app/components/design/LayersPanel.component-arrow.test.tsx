// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LayersPanel, type LayersPanelNode } from "./LayersPanel";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

const layers: LayersPanelNode[] = [
  {
    id: "card",
    name: "Card",
    type: "component",
    children: [{ id: "title", name: "Title", type: "text" }],
  },
];

describe("component layer disclosure arrow", () => {
  it("expands a created component row when its arrow is clicked", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onExpandedIdsChange = vi.fn();
    await act(async () => {
      root.render(
        <LayersPanel
          layers={layers}
          selectedIds={[]}
          expandedIds={[]}
          searchQuery=""
          onSearchQueryChange={() => {}}
          onExpandedIdsChange={onExpandedIdsChange}
          onSelectionChange={() => {}}
        />,
      );
    });
    cleanup = async () => {
      await act(async () => root.unmount());
      host.remove();
    };
    const chevron = host.querySelector<HTMLElement>("[data-layer-row-chevron]");
    expect(chevron).not.toBeNull();
    await act(async () => chevron!.click());
    expect(onExpandedIdsChange).toHaveBeenCalledWith(["card"]);
  });
});

describe("components section", () => {
  it("lists created components and opens one on click", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onComponentSelect = vi.fn();
    const component = {
      name: "Card",
      instanceCount: 2,
      sampleFileId: "file-1",
      sampleNodeId: "node-1",
    };
    await act(async () => {
      root.render(
        <LayersPanel
          layers={layers}
          components={[component]}
          onComponentSelect={onComponentSelect}
          selectedIds={[]}
          expandedIds={[]}
          searchQuery=""
          onSearchQueryChange={() => {}}
          onExpandedIdsChange={() => {}}
          onSelectionChange={() => {}}
        />,
      );
    });
    cleanup = async () => {
      await act(async () => root.unmount());
      host.remove();
    };
    const row = host.querySelector<HTMLElement>('[data-component-row="Card"]');
    expect(row?.textContent).toContain("Card");
    await act(async () => row!.click());
    expect(onComponentSelect).toHaveBeenCalledWith(component);
  });
});
