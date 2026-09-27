// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { layerRowIndentCount, LayersPanel } from "./LayersPanel";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

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

  it("caps the screens section and exposes a keyboard-resizable divider", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <LayersPanel
          screens={Array.from({ length: 8 }, (_, index) => ({
            id: `screen-${index}`,
            name: `Screen ${index}`,
            type: "file" as const,
          }))}
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

    const screenSection = host.querySelector<HTMLElement>(
      "[data-screen-section]",
    );
    const resizer = host.querySelector<HTMLElement>(
      "[data-screen-section-resizer]",
    );
    expect(screenSection?.style.maxHeight).toBe("30%");
    expect(resizer?.getAttribute("role")).toBe("separator");
    expect(resizer?.getAttribute("aria-label")).toBe(
      "layersPanel.resizeScreens",
    );
    expect(resizer?.getAttribute("aria-orientation")).toBe("horizontal");
    expect(resizer?.hasAttribute("aria-valuemin")).toBe(true);
    expect(resizer?.hasAttribute("aria-valuemax")).toBe(true);
    expect(resizer?.hasAttribute("aria-valuenow")).toBe(true);
    expect(resizer?.tabIndex).toBe(0);

    root.unmount();
    host.remove();
  });

  it("resizes the screens section with ArrowDown, Home, and End", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <LayersPanel
          screens={Array.from({ length: 8 }, (_, index) => ({
            id: `screen-${index}`,
            name: `Screen ${index}`,
            type: "file" as const,
          }))}
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

    const panel = host.querySelector<HTMLElement>("[data-layers-panel]")!;
    const screenSection = host.querySelector<HTMLElement>(
      "[data-screen-section]",
    )!;
    const resizer = host.querySelector<HTMLElement>(
      "[data-screen-section-resizer]",
    )!;
    Object.defineProperty(panel, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ height: 1000 }) as DOMRect,
    });
    Object.defineProperty(screenSection, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ height: 200 }) as DOMRect,
    });

    await act(async () => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    expect(screenSection.style.height).toBe("224px");

    await act(async () => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Home" }),
      );
    });
    expect(screenSection.style.height).toBe("96px");

    await act(async () => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "End" }),
      );
    });
    expect(screenSection.style.height).toBe("300px");

    root.unmount();
    host.remove();
  });

  it("scrolls the active screen row into view", async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(
          <LayersPanel
            screens={Array.from({ length: 8 }, (_, index) => ({
              id: `screen-${index}`,
              name: `Screen ${index}`,
              type: "file" as const,
            }))}
            activeScreenId="screen-7"
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

      await vi.waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
      });
    } finally {
      root.unmount();
      host.remove();
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    }
  });
});

describe("LayersPanel collapse layers", () => {
  it.each([
    { selectedIds: ["group"], expected: ["frame"] },
    { selectedIds: [], expected: [] },
  ])(
    "keeps only ancestors of $selectedIds expanded",
    async ({ selectedIds, expected }) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      const onExpandedIdsChange = vi.fn();
      try {
        await act(async () => {
          root.render(
            <LayersPanel
              layers={[
                {
                  id: "other",
                  name: "Other",
                  type: "frame",
                  children: [
                    { id: "other-child", name: "Other child", type: "element" },
                  ],
                },
                {
                  id: "frame",
                  name: "Frame",
                  type: "frame",
                  children: [
                    {
                      id: "group",
                      name: "Group",
                      type: "group",
                      children: [{ id: "text", name: "Text", type: "element" }],
                    },
                  ],
                },
              ]}
              selectedIds={selectedIds}
              expandedIds={["other", "frame", "group"]}
              searchQuery=""
              onSearchQueryChange={() => {}}
              onExpandedIdsChange={onExpandedIdsChange}
              onSelectionChange={() => {}}
            />,
          );
        });
        onExpandedIdsChange.mockClear();
        const button = host.querySelector<HTMLButtonElement>(
          'button[aria-label="layersPanel.collapse"]',
        );
        expect(button?.disabled).toBe(false);
        await act(async () => button!.click());
        expect(onExpandedIdsChange.mock.calls).toEqual([[expected]]);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );
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
    expect(panel?.className).toContain("[--design-icon-size:12px]");
    expect(panel?.className).toContain("[--design-row-height:24px]");
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
