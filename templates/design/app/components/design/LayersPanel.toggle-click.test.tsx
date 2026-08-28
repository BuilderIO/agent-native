// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { layerRowIndentCount, LayersPanel } from "./LayersPanel";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

// A row carries the lock/hide icon button AND the row context menu's
// Lock/Hide item, and the row itself sits inside a ContextMenuTrigger. Each
// pointer path has to stay wired to exactly one invocation: the toggles take
// an absolute next state, so a second invocation off the same click is
// silently destructive rather than merely redundant once anything downstream
// (source write, undo entry, agent handoff) is no longer idempotent.
function renderPanel() {
  const onToggleLocked = vi.fn();
  const onToggleHidden = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const mount = async () => {
    await act(async () => {
      root.render(
        <LayersPanel
          layers={[{ id: "n1", name: "Box", type: "element" }]}
          selectedIds={[]}
          expandedIds={[]}
          searchQuery=""
          onSearchQueryChange={() => {}}
          onExpandedIdsChange={() => {}}
          onSelectionChange={() => {}}
          onToggleLocked={onToggleLocked}
          onToggleHidden={onToggleHidden}
        />,
      );
    });
  };
  const click = async (label: string) => {
    const button = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.getAttribute("aria-label") === label,
    );
    if (!button) throw new Error(`no button labelled ${label}`);
    await act(async () => {
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1 }),
      );
    });
  };
  return { onToggleLocked, onToggleHidden, host, root, mount, click };
}

describe("LayersPanel lock/hide toggles", () => {
  it("invokes onToggleLocked exactly once per click", async () => {
    const panel = renderPanel();
    await panel.mount();
    await panel.click("layersPanel.lock");
    expect(panel.onToggleLocked.mock.calls).toEqual([["n1", true]]);
    expect(panel.onToggleHidden).not.toHaveBeenCalled();
    panel.root.unmount();
  });

  it("invokes onToggleHidden exactly once per click", async () => {
    const panel = renderPanel();
    await panel.mount();
    await panel.click("layersPanel.hide");
    expect(panel.onToggleHidden.mock.calls).toEqual([["n1", true]]);
    expect(panel.onToggleLocked).not.toHaveBeenCalled();
    panel.root.unmount();
  });
});

describe("LayersPanel row hierarchy", () => {
  it("renders one explicit 16px flex indent per hierarchy level", async () => {
    expect([0, 1, 2, 7].map(layerRowIndentCount)).toEqual([1, 2, 3, 8]);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <LayersPanel
          layers={[
            {
              id: "root",
              name: "Root",
              type: "frame",
              children: [
                {
                  id: "child",
                  name: "Child",
                  type: "group",
                  children: [{ id: "leaf", name: "Leaf", type: "element" }],
                },
              ],
            },
          ]}
          selectedIds={["root"]}
          expandedIds={["root", "child"]}
          searchQuery=""
          onSearchQueryChange={() => {}}
          onExpandedIdsChange={() => {}}
          onSelectionChange={() => {}}
        />,
      );
    });

    const rows = Array.from(
      host.querySelectorAll<HTMLElement>("[data-layer-row-content]"),
    );
    expect(rows).toHaveLength(3);
    expect(
      rows.map(
        (row) =>
          row.querySelectorAll(
            ":scope > [data-layer-row-indents] > [data-layer-row-indent]",
          ).length,
      ),
    ).toEqual([1, 2, 3]);
    expect(
      rows.every((row) =>
        row.classList.contains("h-[var(--design-row-height)]"),
      ),
    ).toBe(true);
    expect(rows.map((row) => row.dataset.layerSelection)).toEqual([
      "primary",
      "descendant",
      "descendant",
    ]);
    expect(rows[0]?.classList.contains("rounded-t-[5px]")).toBe(true);
    expect(rows[1]?.classList.contains("rounded-t-[5px]")).toBe(false);
    expect(rows[1]?.classList.contains("rounded-b-[5px]")).toBe(false);
    expect(rows[2]?.classList.contains("rounded-b-[5px]")).toBe(true);

    const nestedIndents = rows[2].querySelectorAll<HTMLElement>(
      ":scope > [data-layer-row-indents] > [data-layer-row-indent]",
    );
    expect(
      nestedIndents[0]?.classList.contains("mr-[var(--design-baseline-unit)]"),
    ).toBe(false);
    expect(
      nestedIndents[1]?.classList.contains("mr-[var(--design-baseline-unit)]"),
    ).toBe(true);
    expect(
      nestedIndents[2]?.classList.contains("mr-[var(--design-baseline-unit)]"),
    ).toBe(true);

    expect(
      Array.from(
        host.querySelectorAll<SVGElement>("[data-layer-row-button] svg"),
      ).every((icon) => icon.classList.contains("tabler-icon")),
    ).toBe(true);

    root.unmount();
    host.remove();
  });
});
