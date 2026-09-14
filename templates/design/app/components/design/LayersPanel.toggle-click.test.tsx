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
    // A real pointer click fires mousedown before click — the toggle now
    // lives on mousedown (see LayersPanel.tsx) so a click-drag onto a
    // DIFFERENT row's icon, which never fires "click" on this one at all
    // (mouseup lands elsewhere), still toggles it exactly once. click's own
    // handler is a keyboard-only (detail===0) fallback, so it must stay
    // silent here or this would count two invocations for one real click.
    await act(async () => {
      button.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, detail: 1 }),
      );
      button.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, detail: 1 }),
      );
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

  // Keyboard activation (Enter/Space on a focused button) fires "click"
  // with no preceding mousedown — the icon's own toggle must still work
  // through that path, not just through the mousedown a pointer click adds.
  it("invokes onToggleHidden exactly once for a keyboard (detail 0) activation", async () => {
    const panel = renderPanel();
    await panel.mount();
    const button = Array.from(panel.host.querySelectorAll("button")).find(
      (candidate) =>
        candidate.getAttribute("aria-label") === "layersPanel.hide",
    )!;
    await act(async () => {
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 0 }),
      );
    });
    expect(panel.onToggleHidden.mock.calls).toEqual([["n1", true]]);
    panel.root.unmount();
  });

  // The click-drag-across-a-run gesture (see beginIconToggleDrag in
  // LayersPanel.tsx) only self-clears on mouseup: if the pointer leaves the
  // browser window before release, mouseup never fires on this window, so a
  // later unrelated hover must not still apply the armed toggle.
  it("clears the click-drag toggle gesture on window blur instead of applying it to a later hover", async () => {
    const onToggleHidden = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LayersPanel
          layers={[
            { id: "n1", name: "Box", type: "element" },
            { id: "n2", name: "Circle", type: "element" },
          ]}
          selectedIds={[]}
          expandedIds={[]}
          searchQuery=""
          onSearchQueryChange={() => {}}
          onExpandedIdsChange={() => {}}
          onSelectionChange={() => {}}
          onToggleHidden={onToggleHidden}
        />,
      );
    });
    const hideButtons = Array.from(host.querySelectorAll("button")).filter(
      (candidate) =>
        candidate.getAttribute("aria-label") === "layersPanel.hide",
    );
    expect(hideButtons).toHaveLength(2);

    await act(async () => {
      hideButtons[0]!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, detail: 1 }),
      );
    });
    expect(onToggleHidden.mock.calls).toHaveLength(1);
    const [toggledId] = onToggleHidden.mock.calls[0]!;

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });

    await act(async () => {
      hideButtons[1]!.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true }),
      );
    });
    // Only the first button's own mousedown toggle — the blur ended the
    // gesture, so hovering the other row's icon never re-applied a stale
    // "hidden: true" to it.
    expect(onToggleHidden.mock.calls).toEqual([[toggledId, true]]);
    root.unmount();
    host.remove();
  });
});

describe("LayersPanel search affordance", () => {
  it("places the layer search button beside the Layers heading", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <LayersPanel
          screens={[{ id: "screen-1", name: "Home", type: "file" }]}
          layers={[{ id: "layer-1", name: "Hero", type: "element" }]}
          selectedIds={[]}
          expandedIds={[]}
          searchQuery=""
          onSearchQueryChange={() => {}}
          onExpandedIdsChange={() => {}}
          onSelectionChange={() => {}}
        />,
      );
    });

    const searchButton = Array.from(host.querySelectorAll("button")).find(
      (button) =>
        button.getAttribute("aria-label") === "layersPanel.searchPlaceholder",
    );
    expect(searchButton).toBeDefined();
    let header: Element | null = searchButton ?? null;
    while (header && !header.querySelector("h2")) {
      header = header.parentElement;
    }
    expect(header?.querySelector("h2")?.textContent).toBe("layersPanel.title");
    expect(
      Array.from(host.querySelectorAll("h2"))
        .find((heading) => heading.textContent === "layersPanel.screens")
        ?.parentElement?.querySelector(
          'button[aria-label="layersPanel.searchPlaceholder"]',
        ),
    ).toBeNull();

    root.unmount();
    host.remove();
  });
});

describe("LayersPanel row hierarchy", () => {
  it("renders compact Figma-like density with one flex indent per level", async () => {
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

    const panel = host.querySelector<HTMLElement>("[data-layers-panel]");
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain("[--design-row-height:24px]");
    expect(panel?.className).toContain("[--design-icon-size:12px]");
    expect(panel?.className).toContain("text-[11px]");

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
    expect(rows.every((row) => row.classList.contains("text-[11px]"))).toBe(
      true,
    );
    expect(
      rows.every((row) => {
        const icon = row.querySelector<HTMLElement>(
          "[data-layer-row-button] > span",
        );
        return icon?.classList.contains("size-[var(--design-icon-size)]");
      }),
    ).toBe(true);
    expect(rows.map((row) => row.dataset.layerSelection)).toEqual([
      "primary",
      "descendant",
      "descendant",
    ]);
    expect(rows[0]?.classList.contains("rounded-t-[4px]")).toBe(true);
    expect(rows[1]?.classList.contains("rounded-t-[4px]")).toBe(false);
    expect(rows[1]?.classList.contains("rounded-b-[4px]")).toBe(false);
    expect(rows[2]?.classList.contains("rounded-b-[4px]")).toBe(true);

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
