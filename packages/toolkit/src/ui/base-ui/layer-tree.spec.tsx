// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createRef } from "react";
import { createPortal } from "react-dom";
import { afterEach, expect, it, vi } from "vitest";

import { LayerTree } from "./layer-tree.js";

afterEach(cleanup);

const items = [
  { id: "page", parentId: null, name: "Page", container: true },
  { id: "card", parentId: "page", name: "Card", container: true },
  { id: "title", parentId: "card", name: "Title" },
  { id: "footer", parentId: null, name: "Footer" },
];
const props = {
  items,
  onItemsChange: vi.fn(),
  getActionLabel: (action: string) => action,
};

it("exposes the tree element and releases replaced host refs", () => {
  const ref = createRef<HTMLDivElement>();
  const cleanupRef = vi.fn();
  const attach = vi.fn(() => cleanupRef);
  const view = render(<LayerTree {...props} ref={ref} />);
  const tree = screen.getByRole("tree");
  expect(ref.current).toBe(tree);
  view.rerender(<LayerTree {...props} ref={attach} />);
  expect(ref.current).toBeNull();
  expect(attach).toHaveBeenCalledWith(tree);
  view.unmount();
  expect(cleanupRef).toHaveBeenCalledOnce();
});

it("keeps keyboard focus on the visible ancestor after a controlled collapse", () => {
  const view = render(<LayerTree {...props} expanded={["page", "card"]} />);
  screen.getByRole("treeitem", { name: "Title" }).focus();
  view.rerender(<LayerTree {...props} expanded={["page"]} />);
  expect(document.activeElement).toBe(
    screen.getByRole("treeitem", { name: "Card" }),
  );
});

it("preserves external focus when filtering removes the old active row", () => {
  const tree = (visible: typeof items) => (
    <>
      <button>Filter</button>
      <LayerTree {...props} items={visible} expanded={["page", "card"]} />
    </>
  );
  const view = render(tree(items));
  screen.getByRole("treeitem", { name: "Title" }).focus();
  const filter = screen.getByRole("button", { name: "Filter" });
  filter.focus();
  view.rerender(tree([items[3]]));
  expect(document.activeElement).toBe(filter);
});

it("retains a keyboard entry point through deletion and repopulation", () => {
  const view = render(<LayerTree {...props} expanded={["page", "card"]} />);
  screen.getByRole("treeitem", { name: "Title" }).focus();
  view.rerender(
    <LayerTree
      {...props}
      items={items.filter((item) => item.id !== "title")}
      expanded={["page", "card"]}
    />,
  );
  expect(document.activeElement).toBe(
    screen.getByRole("treeitem", { name: "Footer" }),
  );
  view.rerender(<LayerTree {...props} items={[]} />);
  expect(document.activeElement).toBe(screen.getByRole("tree"));
  view.rerender(<LayerTree {...props} items={[items[0]]} />);
  expect(document.activeElement).toBe(
    screen.getByRole("treeitem", { name: "Page" }),
  );
});

it("cycles through names beginning with a supplementary Unicode character", () => {
  const layers = ["Page", "🟢 Ready", "🟢 Approved"].map((name) => ({
    id: name,
    parentId: null,
    name,
  }));
  render(<LayerTree {...props} items={layers} />);
  const [page, ready, approved] = screen.getAllByRole("treeitem");
  page.focus();
  fireEvent.keyDown(page, { key: "🟢" });
  expect(document.activeElement).toBe(ready);
  fireEvent.keyDown(ready, { key: "🟢" });
  expect(document.activeElement).toBe(approved);
});

it("cycles through canonically equivalent layer names without changing selection", () => {
  const layers = ["Page", "E\u0301tudes", "Écran"].map((name) => ({
    id: name,
    parentId: null,
    name,
  }));
  render(<LayerTree {...props} items={layers} defaultSelection={["Page"]} />);
  const [page, first, second] = screen.getAllByRole("treeitem");
  page.focus();
  fireEvent.keyDown(page, { key: "é" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "e\u0301" });
  expect(document.activeElement).toBe(second);
  expect(page.getAttribute("aria-selected")).toBe("true");
});

it.each([{ ctrlKey: true }, { metaKey: true }])(
  "selects the expanded rows in document order with %o+A",
  (modifier) => {
    const change = vi.fn();
    const layers = items.map((item) => ({
      ...item,
      locked: item.id === "footer",
    }));
    render(
      <LayerTree
        {...props}
        items={layers}
        defaultExpanded={["page"]}
        onSelectionChange={change}
      />,
    );
    const card = screen.getByRole("treeitem", { name: "Card" });
    act(() => card.focus());
    expect(fireEvent.keyDown(card, { key: "a", ...modifier })).toBe(false);
    expect(change).toHaveBeenCalledWith(["page", "card", "footer"]);
    expect(document.activeElement).toBe(card);
    fireEvent.keyDown(card, { key: "A", ...modifier });
    expect(change).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { key: "F2" });
    expect(
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "a", ...modifier }),
    ).toBe(true);
    expect(change).toHaveBeenCalledTimes(1);
  },
);

it("accepts AltGraph characters without capturing application shortcuts", () => {
  const layers = ["Page", "@mentions", "@notifications"].map((name) => ({
    id: name,
    parentId: null,
    name,
  }));
  render(<LayerTree {...props} items={layers} defaultSelection={["Page"]} />);
  const [page, mentions, notifications] = screen.getAllByRole("treeitem");
  const chord = { key: "@", ctrlKey: true, altKey: true };
  act(() => page.focus());
  expect(fireEvent.keyDown(page, chord)).toBe(true);
  expect(document.activeElement).toBe(page);
  const character = { ...chord, modifierAltGraph: true };
  expect(fireEvent.keyDown(page, character)).toBe(false);
  expect(document.activeElement).toBe(mentions);
  fireEvent.keyDown(mentions, character);
  expect(document.activeElement).toBe(notifications);
  expect(page.getAttribute("aria-selected")).toBe("true");
});

it("leaves modified reorder shortcuts and canceled key events to the host", () => {
  const onItemsChange = vi.fn();
  const { rerender } = render(
    <LayerTree
      {...props}
      expanded={["page", "card"]}
      onItemsChange={onItemsChange}
    />,
  );
  const title = screen.getByRole("treeitem", { name: "Title" });
  title.focus();
  for (const modifier of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
  ]) {
    expect(
      fireEvent.keyDown(title, { key: "ArrowLeft", altKey: true, ...modifier }),
    ).toBe(true);
  }
  expect(onItemsChange).not.toHaveBeenCalled();
  rerender(
    <div onKeyDownCapture={(e) => e.preventDefault()}>
      <LayerTree
        {...props}
        expanded={["page", "card"]}
        onItemsChange={onItemsChange}
      />
    </div>,
  );
  fireEvent.keyDown(screen.getByRole("treeitem", { name: "Title" }), {
    key: "ArrowLeft",
    altKey: true,
  });
  expect(onItemsChange).not.toHaveBeenCalled();
});

it("respects a host-canceled rename key and consumes Escape when canceling the draft", () => {
  const onItemsChange = vi.fn();
  const hostShortcut = vi.fn();
  render(
    <div
      onKeyDownCapture={(event) => {
        if (event.key === "Enter") event.preventDefault();
      }}
      onKeyDown={hostShortcut}
    >
      <LayerTree
        {...props}
        expanded={["page", "card"]}
        onItemsChange={onItemsChange}
      />
    </div>,
  );
  const title = screen.getByRole("treeitem", { name: "Title" });
  fireEvent.keyDown(title, { key: "F2" });
  const input = screen.getByRole<HTMLInputElement>("textbox");
  fireEvent.change(input, { target: { value: "Draft" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("Draft");
  hostShortcut.mockClear();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(document.activeElement).toBe(title);
  expect(hostShortcut).not.toHaveBeenCalled();
  expect(onItemsChange).not.toHaveBeenCalled();
});

it.each(["document", "shadow"] as const)(
  "returns focus to the row and discards a draft when its parent becomes locked in a %s root",
  (mode) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root =
      mode === "shadow" ? host.attachShadow({ mode: "open" }) : document;
    const container = document.createElement("div");
    (mode === "shadow" ? root : host).append(container);
    const controls = within(container);
    const onItemsChange = vi.fn();
    const tree = (locked: boolean) => (
      <LayerTree
        {...props}
        items={items.map((item) =>
          item.id === "card" ? { ...item, locked } : item,
        )}
        expanded={["page", "card"]}
        onItemsChange={onItemsChange}
      />
    );
    const view = render(tree(false), { container });
    const title = controls.getByRole("treeitem", { name: "Title" });
    title.focus();
    fireEvent.keyDown(title, { key: "F2" });
    const editor = controls.getByRole("textbox");
    expect(root.activeElement).toBe(editor);
    fireEvent.change(editor, { target: { value: "Draft" } });
    view.rerender(tree(true));
    expect(controls.queryByRole("textbox")).toBeNull();
    expect(onItemsChange).not.toHaveBeenCalled();
    expect(root.activeElement).toBe(title);
    view.unmount();
    host.remove();
  },
);

it.each([false, true])(
  "preserves a host rename while editing (local draft: %s)",
  (hasDraft) => {
    const onItemsChange = vi.fn();
    const tree = (name: string) => (
      <LayerTree
        {...props}
        items={[{ id: "title", parentId: null, name }]}
        onItemsChange={onItemsChange}
      />
    );
    const view = render(tree("Title"));
    fireEvent.keyDown(screen.getByRole("treeitem"), { key: "F2" });
    const editor = screen.getByRole<HTMLInputElement>("textbox");
    if (hasDraft) fireEvent.change(editor, { target: { value: "My title" } });
    view.rerender(tree("Updated title"));
    expect(editor.value).toBe(hasDraft ? "My title" : "Updated title");
    if (hasDraft) fireEvent.keyDown(editor, { key: "Enter" });
    else fireEvent.blur(editor);
    expect(onItemsChange.mock.calls).toEqual(
      hasDraft ? [[[{ id: "title", parentId: null, name: "My title" }]]] : [],
    );
  },
);

it("withdraws a drop target when the host locks the dragged layer", () => {
  const onItemsChange = vi.fn();
  const tree = (locked: boolean) => (
    <LayerTree
      {...props}
      items={items.map((item) =>
        item.id === "page" ? { ...item, locked } : item,
      )}
      onItemsChange={onItemsChange}
    />
  );
  const view = render(tree(false));
  const source = screen.getByRole("treeitem", { name: "Page" });
  const target = screen.getByRole("treeitem", { name: "Footer" });
  const dataTransfer = { setData: vi.fn() };
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  expect(target.hasAttribute("data-drop")).toBe(true);
  view.rerender(tree(true));
  expect(target.hasAttribute("data-drop")).toBe(false);
  expect(fireEvent.dragOver(target, { dataTransfer })).toBe(true);
  fireEvent.drop(target, { dataTransfer });
  expect(onItemsChange).not.toHaveBeenCalled();
});

it("ignores external drops after a controlled collapse removes the drag source", () => {
  const onItemsChange = vi.fn();
  const tree = (expanded: string[]) => (
    <LayerTree {...props} expanded={expanded} onItemsChange={onItemsChange} />
  );
  const view = render(tree(["page", "card"]));
  const source = screen.getByRole("treeitem", { name: "Title" });
  const target = screen.getByRole("treeitem", { name: "Footer" });
  const dataTransfer = { setData: vi.fn() };
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  expect(target.hasAttribute("data-drop")).toBe(true);
  view.rerender(tree([]));
  expect(source.isConnected).toBe(false);
  view.rerender(tree(["page", "card"]));
  expect(target.hasAttribute("data-drop")).toBe(false);
  expect(fireEvent.drop(target, { dataTransfer: {} })).toBe(true);
  expect(onItemsChange).not.toHaveBeenCalled();
});

it("keeps pointer events on custom controls and portal content out of row selection and rename", () => {
  const change = vi.fn();
  render(
    <LayerTree
      {...props}
      onSelectionChange={change}
      renderLabel={(item) =>
        item.id === "page" ? (
          <>
            <select aria-label="Layer style">
              <option>Default</option>
            </select>
            <span
              onClick={(event) => event.preventDefault()}
              onDoubleClick={(event) => event.preventDefault()}
            >
              Custom target
            </span>
            {createPortal(<span>Popup detail</span>, document.body)}
          </>
        ) : (
          item.name
        )
      }
    />,
  );
  for (const target of [
    screen.getByRole("combobox"),
    screen.getByText("Custom target"),
    screen.getByText("Popup detail"),
  ]) {
    fireEvent.click(target);
    fireEvent.doubleClick(target);
    expect(change).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  }
  fireEvent.click(screen.getByText("Footer"));
  expect(change).toHaveBeenCalledWith(["footer"]);
});

it("leaves a custom row action's drag data and drop behavior to its owner", () => {
  const onItemsChange = vi.fn();
  const onSelectionChange = vi.fn();
  render(
    <LayerTree
      {...props}
      onItemsChange={onItemsChange}
      onSelectionChange={onSelectionChange}
      renderActions={(item) => <a href={`#${item.id}`}>{item.name} details</a>}
    />,
  );
  const action = screen.getByRole("link", { name: "Page details" });
  const target = screen.getByRole("treeitem", { name: "Footer" });
  const dataTransfer = { setData: vi.fn() };
  fireEvent.dragStart(action, { dataTransfer });
  expect(dataTransfer.setData).not.toHaveBeenCalled();
  expect(onSelectionChange).not.toHaveBeenCalled();
  expect(fireEvent.dragOver(target, { dataTransfer })).toBe(true);
  fireEvent.drop(target, { dataTransfer });
  expect(onItemsChange).not.toHaveBeenCalled();
});

it("delivers fine scroll events without rendering the same row labels again", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  try {
    const layers = Array.from({ length: 1_000 }, (_, i) => ({
      id: String(i),
      name: "Layer " + i,
      parentId: null,
    }));
    const renderLabel = vi.fn((item: (typeof layers)[number]) => item.name);
    const onScroll = vi.fn();
    render(
      <LayerTree
        {...props}
        items={layers}
        viewportHeight={320}
        renderLabel={renderLabel}
        onScroll={onScroll}
      />,
    );
    const tree = screen.getByRole("tree");
    tree.scrollTop = 6400;
    fireEvent.scroll(tree);
    expect(screen.getByRole("treeitem", { name: "Layer 200" })).toBeTruthy();
    renderLabel.mockClear();
    onScroll.mockClear();
    for (let delta = 1; delta < 128; delta++) {
      tree.scrollTop = 6400 + delta;
      fireEvent.scroll(tree);
    }
    expect(renderLabel).not.toHaveBeenCalled();
    expect(onScroll).toHaveBeenCalledTimes(127);
    expect(screen.getByRole("treeitem", { name: "Layer 213" })).toBeTruthy();
    tree.scrollTop = 12800;
    fireEvent.scroll(tree);
    expect(screen.getByRole("treeitem", { name: "Layer 400" })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: "Layer 200" })).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});
