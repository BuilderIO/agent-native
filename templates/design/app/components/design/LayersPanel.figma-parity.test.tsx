// @vitest-environment happy-dom

import { act, createRef, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LayersPanel,
  type LayersPanelHandle,
  type LayersPanelNode,
} from "./LayersPanel";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

type PanelProps = ComponentProps<typeof LayersPanel>;

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

async function renderPanel(props: Partial<PanelProps> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const ref = createRef<LayersPanelHandle>();
  let current: PanelProps = {
    layers: [{ id: "n1", name: "Box", type: "element" }],
    selectedIds: [],
    expandedIds: [],
    searchQuery: "",
    onSearchQueryChange: () => {},
    onExpandedIdsChange: () => {},
    onSelectionChange: () => {},
    ...props,
  };
  const render = async (next: Partial<PanelProps> = {}) => {
    current = { ...current, ...next };
    await act(async () => {
      root.render(<LayersPanel ref={ref} {...current} />);
    });
  };
  await render();
  cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return { host, ref, render };
}

function rowButton(host: HTMLElement, id: string) {
  const button = host.querySelector<HTMLElement>(
    `[data-layer-row-button][data-layer-node-id="${id}"]`,
  );
  if (!button) throw new Error(`no row for ${id}`);
  return button;
}

function rowIcon(host: HTMLElement, id: string) {
  const icon = rowButton(host, id).querySelector<HTMLElement>(
    "[data-layer-row-icon]",
  );
  if (!icon) throw new Error(`no icon for ${id}`);
  return icon;
}

function iconName(host: HTMLElement, id: string) {
  const svg = rowIcon(host, id).querySelector("svg");
  return Array.from(svg?.classList ?? []).find(
    (name) => name.startsWith("tabler-icon-") && name !== "tabler-icon",
  );
}

async function pressKey(
  target: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
  });
}

describe("LayersPanel row context menu", () => {
  it("selects an unselected row, then opens the shared canvas menu at the pointer", async () => {
    const onSelectionChange = vi.fn();
    const onOpenContextMenu = vi.fn();
    const { host } = await renderPanel({
      layers: [
        { id: "first", name: "First", type: "element" },
        { id: "second", name: "Second", type: "element" },
      ],
      selectedIds: ["first"],
      onSelectionChange,
      onOpenContextMenu,
    });

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 120,
    });
    await act(async () => {
      rowButton(host, "second").dispatchEvent(event);
    });

    expect(onSelectionChange).toHaveBeenCalledWith(
      ["second"],
      expect.objectContaining({ id: "second" }),
    );
    expect(onOpenContextMenu).toHaveBeenCalledWith({
      clientX: 40,
      clientY: 120,
    });
    expect(onSelectionChange.mock.invocationCallOrder[0]).toBeLessThan(
      onOpenContextMenu.mock.invocationCallOrder[0]!,
    );
    expect(event.defaultPrevented).toBe(true);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("keeps a multi-selection when the right-clicked row is part of it", async () => {
    const onSelectionChange = vi.fn();
    const onOpenContextMenu = vi.fn();
    const { host } = await renderPanel({
      layers: [
        { id: "first", name: "First", type: "element" },
        { id: "second", name: "Second", type: "element" },
      ],
      selectedIds: ["first", "second"],
      onSelectionChange,
      onOpenContextMenu,
    });

    await act(async () => {
      rowButton(host, "second").dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 1,
          clientY: 2,
        }),
      );
    });

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onOpenContextMenu).toHaveBeenCalledTimes(1);
  });
});

describe("LayersPanel rename with Tab", () => {
  it("commits and moves the rename to the next layer, and Shift+Tab goes back", async () => {
    const onRename = vi.fn();
    const { host, ref } = await renderPanel({
      layers: [
        { id: "a", name: "Alpha", type: "element" },
        { id: "b", name: "Bravo", type: "element" },
        { id: "c", name: "Charlie", type: "element" },
      ],
      onRename,
    });
    const order = Array.from(
      host.querySelectorAll<HTMLElement>("[data-layer-row-button]"),
    ).map((button) => button.dataset.layerNodeId);
    expect(order).toHaveLength(3);
    const [first, second] = order as [string, string, string];

    await act(async () => {
      expect(ref.current?.beginRename(first)).toBe(true);
    });
    const firstInput = host.querySelector<HTMLInputElement>(
      "input[data-layer-row-name]",
    )!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setValue.call(firstInput, "Renamed");
      firstInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await pressKey(firstInput, "Tab");

    expect(onRename).toHaveBeenCalledWith(first, "Renamed");
    const secondInput = rowButton(host, second).querySelector<HTMLInputElement>(
      "input[data-layer-row-name]",
    );
    expect(secondInput).not.toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(secondInput));

    await pressKey(secondInput!, "Tab", { shiftKey: true });

    expect(
      rowButton(host, first).querySelector("input[data-layer-row-name]"),
    ).not.toBeNull();
    expect(
      rowButton(host, second).querySelector("input[data-layer-row-name]"),
    ).toBeNull();
  });
});

describe("LayersPanel double-click editing", () => {
  it("edits text content for text layers and renames other layers", async () => {
    const onRename = vi.fn();
    const onStartTextEdit = vi.fn((id: string) =>
      id === "text" ? "Canvas text" : null,
    );
    const onTextEdit = vi.fn();
    const { host } = await renderPanel({
      layers: [
        { id: "text", name: "Text layer", type: "text" },
        { id: "box", name: "Box", type: "element" },
      ],
      onRename,
      onStartTextEdit,
      onTextEdit,
    });

    await act(async () =>
      rowButton(host, "text").dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true }),
      ),
    );
    expect(onStartTextEdit).toHaveBeenCalledWith("text");
    const textInput = host.querySelector<HTMLInputElement>(
      "input[data-layer-row-name]",
    );
    expect(textInput?.value).toBe("Canvas text");
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!textInput || !setValue) throw new Error("Text input unavailable");
    await act(async () => {
      setValue.call(textInput, "Changed text");
      textInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await pressKey(textInput, "Enter");
    expect(onTextEdit).toHaveBeenCalledWith(
      "text",
      "Changed text",
      "Canvas text",
    );
    expect(onRename).not.toHaveBeenCalled();

    await act(async () =>
      rowButton(host, "box").dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true }),
      ),
    );
    const renameInput = host.querySelector<HTMLInputElement>(
      "input[data-layer-row-name]",
    );
    expect(renameInput?.value).toBe("Box");
    if (!renameInput) throw new Error("Rename input unavailable");
    await act(async () => {
      setValue.call(renameInput, "Renamed box");
      renameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await pressKey(renameInput, "Enter");
    expect(onRename).toHaveBeenCalledWith("box", "Renamed box");
    expect(onTextEdit).toHaveBeenCalledTimes(1);
  });
});

describe("LayersPanel disappearing text rows", () => {
  it.each(["removed", "filtered", "collapsed"] as const)(
    "allows editing another row when the draft row is %s",
    async (reason) => {
      const onTextEdit = vi.fn(() => false);
      const child = { id: "text", name: "Text", type: "text" as const };
      const group = {
        id: "group",
        name: "Group",
        type: "frame" as const,
        children: [child],
      };
      const other = { id: "other", name: "Other", type: "element" as const };
      const panel = await renderPanel({
        layers: [group, other],
        expandedIds: ["group"],
        onRename: () => {},
        onStartTextEdit: (id) => (id === "text" ? "Before" : "Other text"),
        onTextEdit,
      });
      await act(async () =>
        rowButton(panel.host, "text").dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true }),
        ),
      );
      const input = panel.host.querySelector<HTMLInputElement>(
        "input[data-layer-row-name]",
      );
      if (!input) throw new Error("Text input missing");
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("Input setter missing");
      await act(async () => {
        setter.call(input, "Unsaved draft");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      if (reason !== "removed") {
        await pressKey(input, "Enter");
        expect(onTextEdit).toHaveBeenCalledWith(
          "text",
          "Unsaved draft",
          "Before",
        );
      }
      if (reason === "removed") await panel.render({ layers: [other] });
      else if (reason === "filtered")
        await panel.render({ searchQuery: "Other" });
      else await panel.render({ expandedIds: [] });
      await act(async () =>
        rowButton(panel.host, "other").dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true }),
        ),
      );
      const otherInput = rowButton(
        panel.host,
        "other",
      ).querySelector<HTMLInputElement>("input[data-layer-row-name]");
      expect(otherInput?.value).toBe("Other text");
      if (!otherInput) throw new Error("Other text editor missing");
      await pressKey(otherInput, "Escape");
      await panel.render({
        layers: [group, other],
        expandedIds: ["group"],
        searchQuery: "",
      });
      await act(async () =>
        rowButton(panel.host, "text").dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true }),
        ),
      );
      const restored = panel.host.querySelector<HTMLInputElement>(
        "input[data-layer-row-name]",
      );
      expect(restored?.value).toBe("Unsaved draft");
      if (!restored) throw new Error("Draft was not restored");
      await pressKey(restored, "Enter");
      expect(onTextEdit).toHaveBeenCalledTimes(reason === "removed" ? 0 : 1);
      expect(restored.value).toBe("Unsaved draft");
    },
  );
});

describe("LayersPanel text edit rejection", () => {
  it("retains a refused draft so it can be copied or corrected", async () => {
    const onTextEdit = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const { host } = await renderPanel({
      layers: [
        { id: "text", name: "Text", type: "text" },
        { id: "other", name: "Other", type: "element" },
      ],
      onRename: () => {},
      onStartTextEdit: () => "Before",
      onTextEdit,
    });
    await act(async () =>
      rowButton(host, "text").dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true }),
      ),
    );
    const input = host.querySelector<HTMLInputElement>(
      "input[data-layer-row-name]",
    );
    if (!input) throw new Error("Text input missing");
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setValue) throw new Error("Input setter unavailable");
    await act(async () => {
      setValue.call(input, "Unsaved draft");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await pressKey(input, "Enter");
    expect(onTextEdit).toHaveBeenCalledWith("text", "Unsaved draft", "Before");
    expect(
      host.querySelector<HTMLInputElement>("input[data-layer-row-name]")?.value,
    ).toBe("Unsaved draft");
    await act(async () =>
      rowButton(host, "other").dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true }),
      ),
    );
    expect(
      host.querySelector<HTMLInputElement>("input[data-layer-row-name]")?.value,
    ).toBe("Unsaved draft");
    await act(async () => {
      setValue.call(input, "Corrected");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await pressKey(input, "Enter");
    expect(onTextEdit).toHaveBeenLastCalledWith("text", "Corrected", "Before");
    expect(host.querySelector("input[data-layer-row-name]")).toBeNull();
  });
});

describe("LayersPanel text editing with Tab", () => {
  it.each([false, true])(
    "commits text without opening a layer rename on Shift=$shift",
    async (shift) => {
      const onRename = vi.fn();
      const onTextEdit = vi.fn();
      const { host } = await renderPanel({
        layers: [
          { id: "a", name: "Alpha", type: "text" },
          { id: "b", name: "Bravo", type: "text" },
        ],
        onRename,
        onStartTextEdit: () => "Canvas text",
        onTextEdit,
      });
      const first = host.querySelector<HTMLElement>("[data-layer-row-button]");
      if (!first) throw new Error("Missing layer row");
      const id = first.dataset.layerNodeId;
      await act(async () =>
        first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
      );
      const input = host.querySelector<HTMLInputElement>(
        "input[data-layer-row-name]",
      );
      if (!input) throw new Error("Missing text input");
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setValue) throw new Error("Input setter unavailable");
      await act(async () => {
        setValue.call(input, "Changed");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
        shiftKey: shift,
      });
      await act(async () => input.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
      await act(async () =>
        input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
      );
      expect(onTextEdit).toHaveBeenCalledWith(id, "Changed", "Canvas text");
      expect(onRename).not.toHaveBeenCalled();
      expect(host.querySelector("input[data-layer-row-name]")).toBeNull();
    },
  );
});

describe("LayersPanel search", () => {
  function searchInput(host: HTMLElement) {
    return host.querySelector<HTMLInputElement>(
      'input[placeholder="layersPanel.searchPlaceholder"]',
    );
  }

  it("clears on the first Escape and closes on the second", async () => {
    const onSearchQueryChange = vi.fn();
    const panel = await renderPanel({
      searchQuery: "box",
      onSearchQueryChange,
    });
    const input = searchInput(panel.host)!;
    expect(input).not.toBeNull();

    await pressKey(input, "Escape");
    expect(onSearchQueryChange).toHaveBeenCalledWith("");
    await panel.render({ searchQuery: "" });
    expect(searchInput(panel.host)).not.toBeNull();

    await pressKey(searchInput(panel.host)!, "Escape");
    expect(searchInput(panel.host)).toBeNull();
  });

  it("offers a clear button that empties and closes the search", async () => {
    const onSearchQueryChange = vi.fn();
    const panel = await renderPanel({
      searchQuery: "box",
      onSearchQueryChange,
    });
    const clear = panel.host.querySelector<HTMLButtonElement>(
      'button[aria-label="layersPanel.clearSearch"]',
    );
    expect(clear).not.toBeNull();

    await act(async () => clear!.click());
    expect(onSearchQueryChange).toHaveBeenCalledWith("");
    await panel.render({ searchQuery: "" });
    expect(searchInput(panel.host)).toBeNull();
  });

  it("highlights the matched part of a layer name", async () => {
    const { host } = await renderPanel({
      layers: [{ id: "n1", name: "Hero Box", type: "element" }],
      searchQuery: "box",
    });
    const mark = rowButton(host, "n1").querySelector("mark");
    expect(mark?.textContent).toBe("Box");
    expect(rowButton(host, "n1").textContent).toContain("Hero Box");
  });
});

describe("LayersPanel scroll into view", () => {
  it("leaves room for the whole row around the icon it scrolls to", async () => {
    const { host } = await renderPanel();
    expect(rowIcon(host, "n1").className).toContain("scroll-my-3");
  });
});

describe("LayersPanel layer icons", () => {
  it("draws an implicit-direction flex container as a horizontal auto layout", async () => {
    const { host } = await renderPanel({
      layers: [
        {
          id: "row",
          name: "Row",
          type: "frame",
          layout: { display: "flex", isFlexContainer: true },
        },
        {
          id: "stack",
          name: "Stack",
          type: "frame",
          layout: {
            display: "flex",
            flexDirection: "column",
            isFlexContainer: true,
          },
        },
      ],
    });
    expect(iconName(host, "row")).toBe("tabler-icon-layout-columns");
    expect(iconName(host, "stack")).toBe("tabler-icon-layout-rows");
  });

  it("gives frames, groups and real components their own glyphs", async () => {
    const layers: LayersPanelNode[] = [
      { id: "frame", name: "Card", type: "frame" },
      { id: "group", name: "Group", type: "group" },
      { id: "component", name: "Button", type: "component" },
      {
        id: "button",
        name: "Action",
        type: "frame",
        tagName: "button",
        isComponent: true,
      },
    ];
    const { host } = await renderPanel({ layers });

    expect(iconName(host, "frame")).toBe("tabler-icon-frame");
    expect(iconName(host, "group")).toBe("tabler-icon-square-dashed");
    expect(iconName(host, "component")).toBe("tabler-icon-components");
    expect(iconName(host, "button")).toBe("tabler-icon-frame");
    const componentColor = "text-[var(--design-editor-component-color)]";
    expect(rowIcon(host, "component").className).toContain(componentColor);
    expect(rowIcon(host, "button").className).not.toContain(componentColor);
    expect(
      rowIcon(host, "button").querySelector("svg")?.getAttribute("class"),
    ).not.toContain(componentColor);
  });
});

describe("LayersPanel collapse all", () => {
  it("is labelled for every layer and collapses the selection path when nothing else is open", async () => {
    const onExpandedIdsChange = vi.fn();
    const { host } = await renderPanel({
      layers: [
        {
          id: "screen",
          name: "Home",
          type: "frame",
          children: [{ id: "leaf", name: "Leaf", type: "element" }],
        },
      ],
      selectedIds: ["leaf"],
      expandedIds: ["screen"],
      onExpandedIdsChange,
    });
    onExpandedIdsChange.mockClear();

    const button = host.querySelector<HTMLButtonElement>(
      '[data-layers-panel-action="collapse"]',
    );
    expect(button?.getAttribute("aria-label")).toBe("layersPanel.collapseAll");
    expect(button?.disabled).toBe(false);

    await act(async () => button!.click());
    expect(onExpandedIdsChange).toHaveBeenCalledWith([]);
  });

  it("is disabled when nothing is expanded", async () => {
    const { host } = await renderPanel({
      layers: [
        {
          id: "screen",
          name: "Home",
          type: "frame",
          children: [{ id: "leaf", name: "Leaf", type: "element" }],
        },
      ],
      expandedIds: [],
    });
    expect(
      host.querySelector<HTMLButtonElement>(
        '[data-layers-panel-action="collapse"]',
      )?.disabled,
    ).toBe(true);
  });
});
