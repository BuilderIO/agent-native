// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SlidesLayersPanel } from "./SlidesLayersPanel";

describe("SlidesLayersPanel", () => {
  afterEach(cleanup);

  it("matches the Design layer order and uses the row as the drag target", () => {
    const { container } = render(
      <SlidesLayersPanel
        layers={[
          {
            id: "back",
            label: "Back",
            kind: "shape",
          },
          {
            id: "front",
            label: "Front",
            kind: "container",
            children: [
              { id: "child-back", label: "Child back", kind: "text" },
              { id: "child-front", label: "Child front", kind: "image" },
            ],
          },
        ]}
        selectedIds={[]}
        onSelectLayer={vi.fn()}
        onMoveLayer={vi.fn()}
        onClose={vi.fn()}
        labels={{
          title: "Layers",
          close: "Close layers panel",
          expand: "Expand layer",
          collapse: "Collapse layer",
        }}
      />,
    );

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-layer-row-content]"),
    );
    expect(
      rows.map(
        (row) =>
          row.closest<HTMLElement>("[role=treeitem]")?.dataset.layerNodeId,
      ),
    ).toEqual(["front", "child-front", "child-back", "back"]);
    expect(rows.map((row) => row.dataset.layerDepth)).toEqual([
      "0",
      "1",
      "1",
      "0",
    ]);
    expect(container.innerHTML).not.toContain("grip-vertical");
    expect(
      rows.every(
        (row) =>
          row.closest("[role=treeitem]")?.getAttribute("draggable") === "true",
      ),
    ).toBe(true);
    expect(
      rows.every(
        (row) =>
          row.querySelector<HTMLElement>("[data-layer-row-button]")?.draggable,
      ),
    ).toBe(false);
  });

  it("opens the shared element menu for the exact row that was right-clicked", () => {
    const onContextMenuLayer = vi.fn();
    const { container } = render(
      <SlidesLayersPanel
        layers={[
          {
            id: "parent",
            label: "Parent",
            kind: "container",
            children: [{ id: "child", label: "Child", kind: "text" }],
          },
        ]}
        selectedIds={[]}
        contextMenuContent={<span data-testid="shared-menu">Menu</span>}
        onContextMenuLayer={onContextMenuLayer}
        onSelectLayer={vi.fn()}
        onMoveLayer={vi.fn()}
        onClose={vi.fn()}
        labels={{
          title: "Layers",
          close: "Close layers panel",
          expand: "Expand layer",
          collapse: "Collapse layer",
        }}
      />,
    );

    const childRow = container.querySelector<HTMLElement>(
      '[data-layer-node-id="child"] [data-layer-row-content]',
    );
    expect(childRow).not.toBeNull();
    fireEvent.contextMenu(childRow!);

    expect(onContextMenuLayer).toHaveBeenCalledTimes(1);
    expect(onContextMenuLayer).toHaveBeenCalledWith("child");
  });

  it("keeps a nested drag source from being replaced by its parent", () => {
    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
    };
    const { container } = render(
      <SlidesLayersPanel
        layers={[
          {
            id: "parent",
            label: "Parent",
            kind: "container",
            children: [{ id: "child", label: "Child", kind: "text" }],
          },
        ]}
        selectedIds={[]}
        onSelectLayer={vi.fn()}
        onMoveLayer={vi.fn()}
        onClose={vi.fn()}
        labels={{
          title: "Layers",
          close: "Close layers panel",
          expand: "Expand layer",
          collapse: "Collapse layer",
        }}
      />,
    );

    const childTreeItem = container.querySelector<HTMLElement>(
      '[data-layer-node-id="child"]',
    );
    expect(childTreeItem).not.toBeNull();
    fireEvent.dragStart(childTreeItem!, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledTimes(1);
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "child");
  });
});
