import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconChevronDown,
  IconDots,
  IconFrame,
  IconHash,
  IconLetterT,
  IconDiamonds,
} from "@tabler/icons-react";
import { useState } from "react";
import { expect, fireEvent, within } from "storybook/test";

import { IconButton } from "../../../src/ui/base-ui/button.js";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
} from "../../../src/ui/base-ui/collapsible.js";
import {
  LayerTree,
  type LayerAction,
  type LayerRecord,
  type LayerRowCommands,
} from "../../../src/ui/base-ui/layer-tree.js";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
} from "../../../src/ui/base-ui/menu.js";
import { LargeDocumentPanel } from "./layer-tree-document.js";
import guide from "./layer-tree.docs.md?raw";

interface DesignLayer extends LayerRecord {
  kind: "screen" | "frame" | "text" | "instance";
}
const icons = {
  screen: IconFrame,
  frame: IconHash,
  text: IconLetterT,
  instance: IconDiamonds,
};
const names: Record<LayerAction, string> = {
  expand: "Expand",
  collapse: "Collapse",
  hide: "Hide",
  show: "Show",
  lock: "Lock",
  unlock: "Unlock",
  rename: "Rename",
};
const sample: DesignLayer[] = [
  {
    id: "home",
    parentId: null,
    name: "Home",
    kind: "screen",
    container: true,
    fixed: true,
  },
  { id: "nav", parentId: "home", name: "Nav", kind: "frame", container: true },
  { id: "logo", parentId: "nav", name: "Logo", kind: "frame" },
  {
    id: "links",
    parentId: "nav",
    name: "Links",
    kind: "frame",
    container: true,
  },
  { id: "product", parentId: "links", name: "Product", kind: "text" },
  { id: "pricing", parentId: "links", name: "Pricing", kind: "text" },
  { id: "docs", parentId: "links", name: "Docs", kind: "text" },
  {
    id: "hero",
    parentId: "home",
    name: "Hero",
    kind: "frame",
    container: true,
  },
  { id: "eyebrow", parentId: "hero", name: "Eyebrow", kind: "frame" },
  {
    id: "title",
    parentId: "hero",
    name: "The app framework your agent can actually use.",
    kind: "text",
  },
  {
    id: "sub",
    parentId: "hero",
    name: "Agent-Native turns every app you build into…",
    kind: "text",
  },
  { id: "cta", parentId: "hero", name: "Cta", kind: "frame", container: true },
  {
    id: "primary",
    parentId: "cta",
    name: "Start building free",
    kind: "instance",
  },
  { id: "secondary", parentId: "cta", name: "Read the docs", kind: "instance" },
  {
    id: "features",
    parentId: "home",
    name: "Feature grid",
    kind: "frame",
    container: true,
  },
  { id: "scaffold", parentId: "features", name: "Scaffold", kind: "frame" },
];
const destinations = {
  up: "Move up",
  down: "Move down",
  in: "Indent",
  out: "Outdent",
} as const;
function Arrange({
  item,
  commands,
}: {
  item: DesignLayer;
  commands: LayerRowCommands;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <IconButton type="button" size="sm" color="gray" variant="ghost" />
        }
        tabIndex={commands.tabIndex}
        aria-label={"Arrange " + item.name}
      >
        <IconDots aria-hidden />
      </MenuTrigger>
      {open && (
        <MenuPopup>
          {(["up", "down", "in", "out"] as const).map((direction) => (
            <MenuItem
              key={direction}
              disabled={!commands.canMove(direction)}
              onClick={() => commands.move(direction)}
            >
              {destinations[direction]}
            </MenuItem>
          ))}
        </MenuPopup>
      )}
    </Menu>
  );
}

function Panel({ arrange = false }: { arrange?: boolean }) {
  const [items, setItems] = useState(sample);
  return (
    <div className="max-w-80 overflow-hidden rounded-card border border-line bg-surface-raised py-1">
      <Collapsible defaultOpen>
        <h2 className="type-label">
          <CollapsibleTrigger className="flex min-h-10 w-full items-center gap-2 px-3 text-start">
            <IconChevronDown
              size={12}
              className="disclosure-chevron"
              aria-hidden
            />
            Layers
          </CollapsibleTrigger>
        </h2>
        <CollapsiblePanel>
          <LayerTree
            aria-label="Layers"
            items={items}
            onItemsChange={setItems}
            defaultExpanded={["home", "nav", "hero"]}
            defaultSelection={["title"]}
            renderIcon={(item) => {
              const Icon = icons[item.kind];
              return <Icon />;
            }}
            renderActions={
              arrange
                ? (item, commands) =>
                    item.fixed ? null : (
                      <Arrange item={item} commands={commands} />
                    )
                : undefined
            }
            getActionLabel={(action, item) => names[action] + " " + item.name}
          />
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
const meta = {
  title: "Patterns/Layer Tree",
  component: LayerTree,
  render: () => <Panel />,
  parameters: {
    docs: { description: { component: guide } },
  },
} satisfies Meta;
export default meta;
export const DesignPanel: StoryObj = {};
export const KeyboardEditing: StoryObj = {
  play: async ({ canvas, userEvent }) => {
    const tree = canvas.getByRole("tree");
    const row = (name: string) => within(tree).getByRole("treeitem", { name });
    row("Nav").focus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(row("Nav")).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    await expect(row("Logo")).toHaveFocus();
    await userEvent.keyboard("{Enter}{F2}");
    const input = within(tree).getByRole("textbox", { name: "Rename Logo" });
    await userEvent.clear(input);
    await userEvent.type(input, "Wordmark{Enter}");
    await expect(row("Wordmark")).toHaveFocus();
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await expect(row("Wordmark")).toHaveAttribute("aria-posinset", "2");
    await expect(row("Wordmark")).toHaveFocus();
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
    await expect(row("Links")).toHaveAttribute("aria-selected", "true");
    await expect(row("Wordmark")).toHaveAttribute("aria-selected", "true");
  },
};
export const RepeatedNames: StoryObj = {
  render: function RepeatedNames() {
    const [items, setItems] = useState<LayerRecord[]>([
      { id: "front", parentId: null, name: "Front", container: true },
      { id: "front-title", parentId: "front", name: "Title" },
      { id: "back", parentId: null, name: "Back", container: true },
      { id: "back-title", parentId: "back", name: "Title" },
    ]);
    const byId = new Map(items.map((item) => [item.id, item]));
    function label(item: LayerRecord) {
      const parent =
        item.parentId === null ? undefined : byId.get(item.parentId);
      return parent ? item.name + " in " + parent.name : item.name;
    }
    return (
      <LayerTree
        aria-label="Card layers"
        className="max-w-80"
        items={items}
        onItemsChange={setItems}
        defaultExpanded={["front", "back"]}
        getItemLabel={label}
        getActionLabel={(action, item) => names[action] + " " + label(item)}
      />
    );
  },
  play: async ({ canvas, userEvent }) => {
    canvas.getByRole("treeitem", { name: "Front" }).focus();
    const front = canvas.getByRole("treeitem", { name: "Title in Front" });
    const back = canvas.getByRole("treeitem", { name: "Title in Back" });
    await userEvent.keyboard("t");
    await expect(front).toHaveFocus();
    await userEvent.keyboard("t{Enter}");
    await expect(back).toHaveFocus();
    await expect(back).toHaveAttribute("aria-selected", "true");
    await userEvent.tab();
    await expect(
      canvas.getByRole("button", { name: "Hide Title in Back" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(back).toHaveAttribute("data-hidden");
    await expect(front).not.toHaveAttribute("data-hidden");
    await userEvent.tab({ shift: true });
    await userEvent.keyboard("{F2}");
    const editor = canvas.getByRole("textbox", {
      name: "Rename Title in Back",
    });
    await userEvent.clear(editor);
    await userEvent.type(editor, "Credit{Enter}");
    await expect(
      canvas.getByRole("treeitem", { name: "Credit in Back" }),
    ).toHaveFocus();
    await expect(front).toHaveTextContent("Title");
    await userEvent.keyboard("{Home}");
    await userEvent.click(canvas.getByRole("button", { name: "Lock Front" }));
    await expect(
      within(front).getByRole("button", { name: "Unlock Title in Front" }),
    ).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Unlock Front" }));
    await userEvent.click(front);
    await expect(
      within(front).getByRole("button", { name: "Lock Title in Front" }),
    ).toBeEnabled();
  },
};
export const RightToLeft: StoryObj = {
  render: () => (
    <div dir="rtl">
      <Panel />
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const row = (name: string) => canvas.getByRole("treeitem", { name });
    const section = canvas.getByRole("button", { name: "Layers" });
    section.focus();
    await userEvent.keyboard("{Enter}");
    await expect(section).toHaveAttribute("aria-expanded", "false");
    const chevron = section.querySelector("svg");
    if (!chevron) throw new Error("Missing section disclosure");
    const direction = new DOMMatrix(getComputedStyle(chevron).transform);
    await expect(direction.c).toBeCloseTo(-1);
    await userEvent.keyboard(" ");
    await expect(section).toHaveAttribute("aria-expanded", "true");
    row("Nav").focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(row("Nav")).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    await expect(row("Logo")).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(row("Nav")).toHaveFocus();

    row("Hero").focus();
    await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    await expect(row("Hero")).toHaveAttribute("aria-level", "3");
    await expect(row("Hero")).toHaveFocus();
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await expect(row("Hero")).toHaveAttribute("aria-level", "2");
    await expect(row("Hero")).toHaveFocus();
    await userEvent.keyboard("{F2}");
    const name = canvas.getByRole("textbox", { name: "Rename Hero" });
    await expect(getComputedStyle(name).direction).toBe("ltr");
    await expect(getComputedStyle(name).textAlign).toBe("right");
    await userEvent.clear(name);
    await userEvent.type(name, "واجهة 2!");
    await expect(getComputedStyle(name).direction).toBe("rtl");
    await userEvent.keyboard("{Enter}");
    await expect(row("واجهة 2!")).toHaveFocus();
    await userEvent.keyboard("{F2}");
    const renamed = canvas.getByRole("textbox", { name: "Rename واجهة 2!" });
    await userEvent.clear(renamed);
    await userEvent.type(renamed, "Hero 2!");
    await userEvent.keyboard("{Enter}");
    const layer = row("Hero 2!");
    await expect(
      getComputedStyle(within(layer).getByText("Hero 2!")).direction,
    ).toBe("ltr");
    await expect(getComputedStyle(layer).direction).toBe("rtl");
  },
};

export const Typeahead: StoryObj = {
  play: async ({ canvas, userEvent }) => {
    const row = (name: string) => canvas.getByRole("treeitem", { name });
    row("Home").focus();
    await userEvent.keyboard("{Shift>}L{/Shift}");
    await expect(row("Logo")).toHaveFocus();
    await expect(row("Logo")).toHaveAttribute("aria-selected", "false");
    await userEvent.keyboard("l");
    await expect(row("Links")).toHaveFocus();
    await userEvent.keyboard("o");
    await expect(row("Logo")).toHaveFocus();
    await expect(row("Logo")).toHaveAttribute("aria-selected", "false");
    await userEvent.keyboard("{Home}n");
    await expect(row("Nav")).toHaveFocus();
    await userEvent.keyboard("{F2}");
    const name = canvas.getByRole("textbox");
    await userEvent.clear(name);
    await userEvent.type(name, "E\u0301tudes{Enter}");
    await userEvent.keyboard("{Home}é");
    await expect(row("E\u0301tudes")).toHaveFocus();
  },
};
export const RowActions: StoryObj = {
  play: async ({ canvas, userEvent }) => {
    const row = canvas.getByRole("treeitem", { name: "Eyebrow" });
    await userEvent.click(row);
    await userEvent.click(
      within(row).getByRole("button", { name: "Hide Eyebrow" }),
    );
    await expect(
      within(row).getByRole("button", { name: "Show Eyebrow" }),
    ).toBeVisible();
    await userEvent.click(
      within(row).getByRole("button", { name: "Lock Eyebrow" }),
    );
    row.focus();
    await userEvent.keyboard("{F2}");
    await expect(canvas.queryByRole("textbox")).toBeNull();
    await userEvent.click(
      within(row).getByRole("button", { name: "Unlock Eyebrow" }),
    );
    await userEvent.dblClick(within(row).getByText("Eyebrow"));
    await userEvent.keyboard("Discard{Escape}");
    await expect(row).toHaveFocus();
  },
};

/** A caller-supplied, single-pointer alternative to dragging uses the same move operations. */
export const ArrangeMenu: StoryObj = {
  render: () => <Panel arrange />,
  play: async ({ canvas, userEvent }) => {
    const logo = canvas.getByRole("treeitem", { name: "Logo" });
    await userEvent.click(logo);
    await userEvent.click(
      within(logo).getByRole("button", { name: "Arrange Logo" }),
    );
    await userEvent.click(
      await within(document.body).findByRole("menuitem", { name: "Move down" }),
    );
    await expect(logo).toHaveAttribute("aria-posinset", "2");
  },
};

export const LargeDocument: StoryObj = { render: () => <LargeDocumentPanel /> };
export const ReorderExpandedSection: StoryObj = {
  ...LargeDocument,
  play: async ({ canvas, userEvent }) => {
    const tree = canvas.getByRole("tree", { name: "Document layers" });
    const section = within(tree).getByRole("treeitem", { name: "Section 1" });
    await userEvent.click(section);
    for (const [key, position] of [
      ["ArrowDown", "2"],
      ["ArrowUp", "1"],
    ]) {
      await userEvent.keyboard(`{Alt>}{${key}}{/Alt}`);
      await expect(section).toHaveAttribute("aria-posinset", position);
      await expect(section).toHaveFocus();
      const bounds = tree.getBoundingClientRect();
      const row = section.getBoundingClientRect();
      await expect(row.top).toBeGreaterThanOrEqual(bounds.top);
      await expect(row.bottom).toBeLessThanOrEqual(bounds.bottom);
    }
  },
};
export const DeepHierarchy: StoryObj = {
  render: () => <LargeDocumentPanel nested />,
  play: async ({ canvas, userEvent }) => {
    const tree = within(canvas.getByRole("tree", { name: "Document layers" }));
    tree.getByRole("treeitem", { name: "Group 1" }).focus();
    await userEvent.keyboard("{End}");
    const leaf = tree.getByRole("treeitem", { name: "Group 10000" });
    await expect(leaf).toHaveFocus();
    await expect(leaf).toHaveAttribute("aria-level", "10000");
    await userEvent.keyboard("{Enter}{Alt>}{ArrowLeft}{/Alt}");
    await expect(leaf).toHaveAttribute("aria-level", "9999");
    await expect(leaf).toHaveFocus();
    await expect(leaf).toHaveAttribute("aria-selected", "true");
    await expect(tree.getAllByRole("treeitem").length).toBeLessThan(30);
  },
};
export const NavigateLargeDocument: StoryObj = {
  render: () => <LargeDocumentPanel />,
  play: async ({ canvas, userEvent }) => {
    const tree = canvas.getByRole("tree", { name: "Document layers" });
    const view = within(tree);
    const group = view.getByRole("treeitem", { name: /^Section 1$/ });
    await userEvent.click(group);
    const pageRows = Math.floor(tree.clientHeight / group.offsetHeight);
    await userEvent.keyboard("{Shift>}{PageDown}{/Shift}");
    const pageEnd = view.getByRole("treeitem", { name: `Layer ${pageRows}` });
    await expect(pageEnd).toHaveFocus();
    await expect(pageEnd).toHaveAttribute("aria-selected", "true");
    await expect(tree.scrollTop).toBeGreaterThan(0);
    await userEvent.keyboard("{PageUp}");
    const restored = view.getByRole("treeitem", { name: "Section 1" });
    await expect(restored).toHaveFocus();
    await expect(tree.scrollTop).toBe(0);
    await userEvent.click(restored);
    const firstChild = view.getByRole("treeitem", { name: "Layer 1" });
    await expect(firstChild).toHaveAttribute("data-in-selection");
    await expect(firstChild).toHaveAttribute("aria-selected", "false");
    await userEvent.keyboard("{Shift>}{End}{/Shift}");
    const last = view.getAllByRole("treeitem", { name: "Layer 99" }).at(-1);
    await expect(last).toHaveFocus();
    await expect(last).toHaveAttribute("data-in-selection");
    await expect(last).toHaveAttribute("aria-selected", "true");
    await expect(last).toHaveAttribute("aria-setsize", "99");

    await expect(view.getAllByRole("treeitem").length).toBeLessThan(24);
    await userEvent.keyboard("{Enter}");
    await expect(last).not.toHaveAttribute("data-in-selection");
    await userEvent.keyboard("z{F2}");
    const editor = view.getByRole("textbox", { name: "Rename Layer 99" });
    await userEvent.clear(editor);
    await userEvent.type(editor, "Footer{Enter}");
    await userEvent.keyboard("{Home}f");
    const footer = view.getByRole("treeitem", { name: "Footer" });
    await expect(footer).toHaveFocus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    await expect(footer).toHaveAttribute("aria-posinset", "98");
    await userEvent.keyboard("{Home}{Shift>}F{/Shift}");
    const found = view.getByRole("treeitem", { name: "Footer" });
    await expect(found).toHaveFocus();
    await expect(found).toHaveAttribute("aria-selected", "true");
    await expect(view.getAllByRole("treeitem", { selected: true })).toEqual([
      found,
    ]);
    const bounds = tree.getBoundingClientRect();
    const focused = found.getBoundingClientRect();
    await expect(focused.top).toBeGreaterThanOrEqual(bounds.top);
    await expect(focused.bottom).toBeLessThanOrEqual(bounds.bottom);
    await userEvent.keyboard("{F2}");
    const rename = view.getByRole("textbox", { name: "Rename Footer" });
    await userEvent.clear(rename);
    await userEvent.type(rename, "@Footer{Enter}");
    await userEvent.keyboard("{Home}");
    const home = view.getByRole("treeitem", { name: "Section 1" });
    await expect(home).toHaveFocus();
    await fireEvent.keyDown(home, {
      key: "@",
      ctrlKey: true,
      altKey: true,
      modifierAltGraph: true,
    });
    await expect(view.getByRole("treeitem", { name: "@Footer" })).toHaveFocus();
    await expect(view.getAllByRole("treeitem").length).toBeLessThan(24);
    await userEvent.keyboard("{Home}");
    await userEvent.keyboard("{Control>}a{/Control}{End}");
    const selectedRows = view.getAllByRole("treeitem", { selected: true });
    await expect(selectedRows).toHaveLength(
      view.getAllByRole("treeitem").length,
    );
    await expect(selectedRows.length).toBeLessThan(24);
    await expect(selectedRows.at(-1)).toHaveFocus();
  },
};

/** A range starts at the focused group when its previous anchor is collapsed. */
export const RangeAfterCollapse: StoryObj = {
  render: () => <LargeDocumentPanel />,
  play: async ({ canvas, userEvent }) => {
    const tree = within(canvas.getByRole("tree", { name: "Document layers" }));
    await userEvent.click(tree.getByRole("treeitem", { name: "Layer 1" }));
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    const group = tree.getByRole("treeitem", { name: "Section 1" });
    await expect(group).toHaveFocus();
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await expect(group).toHaveAttribute("aria-selected", "true");
    await expect(
      tree.getByRole("treeitem", { name: "Section 2" }),
    ).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Shift>}{End}{Home}{/Shift}");
    const first = tree.getByRole("treeitem", { name: "Section 1" });
    await expect(first).toHaveFocus();
    await expect(tree.getAllByRole("treeitem", { selected: true })).toEqual([
      first,
    ]);
  },
};
