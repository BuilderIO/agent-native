import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fireEvent, waitFor, within } from "storybook/test";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  DesignFilePageList,
  DesignFilePanel,
  type DesignFilePanelProps,
} from "../../../src/ui/base-ui/design-file-panel.js";
import {
  Tabs,
  TabsList,
  TabsTab,
  TabsPanel,
} from "../../../src/ui/base-ui/tabs.js";
import guide from "./design-file-panel.docs.md?raw";
import { prototypePages } from "./editor-workspace-fixture.js";
import { WorkspaceLayersPanel } from "./editor-workspace-layers.js";

import "./editor-workspace.css";

function Demo({
  tabVariant,
  height = "min(864px, 100dvh)",
}: Pick<DesignFilePanelProps, "tabVariant"> & {
  height?: React.CSSProperties["height"];
}) {
  const [items, setItems] = React.useState(prototypePages),
    [page, setPage] = React.useState("home"),
    [selected, setSelected] = React.useState<readonly string[]>(["nav"]),
    [open, setOpen] = React.useState(true);
  const collapseButton = React.useRef<HTMLButtonElement>(null);
  const [returnToPanel, setReturnToPanel] = React.useState(false);
  React.useLayoutEffect(() => {
    if (open && returnToPanel) {
      collapseButton.current?.focus();
      setReturnToPanel(false);
    }
  }, [open, returnToPanel]);
  const current = React.useMemo(() => {
    const ids = new Set([page]);
    return items.filter((layer) => {
      if (layer.parentId && ids.has(layer.parentId)) ids.add(layer.id);
      return ids.has(layer.id);
    });
  }, [items, page]);
  return (
    <div style={{ width: "min(320px, 100%)", height }}>
      {open ? (
        <WorkspaceLayersPanel
          tabVariant={tabVariant}
          layers={items}
          current={current}
          selected={selected}
          onSelection={setSelected}
          onChange={setItems}
          pageId={page}
          onPage={(id) => {
            setPage(id);
            setSelected([id]);
          }}
          collapseButtonRef={collapseButton}
          onCollapse={() => setOpen(false)}
        />
      ) : (
        <Button
          autoFocus
          onClick={() => {
            setReturnToPanel(true);
            setOpen(true);
          }}
        >
          Open file panel
        </Button>
      )}
    </div>
  );
}
export default {
  title: "Patterns/Design File Panel",
  component: DesignFilePanel,
  render: () => <Demo />,
  parameters: {
    docs: { description: { component: guide } },
    layout: "fullscreen",
    stage: "editor",
  },
} satisfies Meta<typeof DesignFilePanel>;
export const Design: StoryObj<typeof Demo> = {};
export const ShortPanel: StoryObj<typeof Demo> = {
  render: () => <Demo height={320} tabVariant="framed" />,
  play: async ({ canvas, userEvent }) => {
    const pages = canvas.getByRole("navigation", { name: "Pages" });
    within(pages).getByRole("button", { name: "Docs" }).focus();
    await userEvent.tab();
    await expect(
      within(pages).getByRole("button", { name: "Pricing" }),
    ).toHaveFocus();
    const tree = canvas.getByRole("tree", { name: "Layers" });
    const row = within(tree).getByRole("treeitem", { name: "Nav" });
    await waitFor(() =>
      expect(tree.clientHeight).toBeGreaterThanOrEqual(row.offsetHeight),
    );
    await userEvent.click(row);
    await expect(row).toHaveFocus();
  },
};
export const Framed: StoryObj<typeof Demo> = {
  render: () => <Demo tabVariant="framed" />,
  play: async ({ canvas, userEvent }) => {
    const list = canvas.getByRole("tablist", { name: "Left panel" });
    const library = within(list).getByRole("tab", { name: "Library" });
    await userEvent.click(library);
    await expect(
      canvas.getByRole("tabpanel", { name: "Library" }),
    ).toBeVisible();
    await userEvent.keyboard("{ArrowLeft}{Enter}");
    const file = within(list).getByRole("tab", { name: "File" });
    await expect(file).toHaveFocus();
    const panel = canvas.getByRole("tabpanel", { name: "File" });
    await expect(panel.getBoundingClientRect().top).toBeCloseTo(
      list.getBoundingClientRect().bottom,
      0,
    );
    await expect(getComputedStyle(file).backgroundColor).toBe(
      getComputedStyle(panel).backgroundColor,
    );
  },
};
export const NavigateAndEdit: StoryObj<typeof Demo> = {
  play: async ({ canvas, userEvent }) => {
    const left = canvas.getByRole("complementary", { name: "File" });
    const host = within(left);
    const tree = () => within(host.getByRole("tree", { name: "Layers" }));
    await expect(
      tree().getByRole("treeitem", { name: "Mark" }),
    ).toHaveAttribute("aria-level", "4");
    await userEvent.click(tree().getByRole("treeitem", { name: "Logo" }));
    await userEvent.keyboard("{ArrowLeft}");
    await expect(tree().queryByRole("treeitem", { name: "Mark" })).toBeNull();
    await userEvent.keyboard("{ArrowRight}");
    await expect(tree().getByRole("treeitem", { name: "Mark" })).toBeVisible();
    await userEvent.click(host.getByRole("button", { name: "Search layers" }));
    await userEvent.type(host.getByRole("searchbox"), "Changelog");
    await userEvent.click(
      within(
        host.getByRole("navigation", { name: "Matching layers" }),
      ).getByRole("button", { name: "Changelog" }),
    );
    await userEvent.click(host.getByRole("button", { name: "Search layers" }));
    await expect(
      tree().getByRole("treeitem", { name: "Changelog" }),
    ).toHaveAttribute("aria-selected", "true");
    await userEvent.click(tree().getByRole("treeitem", { name: "Logo" }));
    await userEvent.keyboard("{ArrowLeft}");
    await userEvent.click(host.getByRole("tab", { name: "Library" }));
    await userEvent.click(host.getByRole("tab", { name: "File" }));
    await expect(
      tree().getByRole("treeitem", { name: "Logo" }),
    ).toHaveAttribute("aria-expanded", "false");
    const search = host.getByRole("button", { name: "Search layers" });
    await userEvent.click(search);
    await userEvent.type(host.getByRole("searchbox"), "Nav{Escape}");
    await expect(search).toHaveFocus();
    await userEvent.click(tree().getByRole("treeitem", { name: "Nav" }));
    await userEvent.keyboard("{ArrowLeft}");
    await expect(tree().queryByRole("treeitem", { name: "Logo" })).toBeNull();
    await userEvent.click(host.getByRole("tab", { name: "Library" }));
    await userEvent.click(
      within(
        host.getByRole("navigation", { name: "Components on this page" }),
      ).getByRole("button", { name: "Logo" }),
    );
    await waitFor(() =>
      expect(tree().getByRole("treeitem", { name: "Logo" })).toHaveFocus(),
    );
    await userEvent.click(host.getByRole("button", { name: "Docs" }));
    await expect(
      tree().getByRole("treeitem", { name: "Documentation" }),
    ).toBeVisible();
    await userEvent.click(host.getByRole("button", { name: "Add page" }));
    await expect(
      tree().getByRole("treeitem", { name: "Untitled" }),
    ).toBeVisible();
    await userEvent.click(host.getByRole("tab", { name: "Agent" }));
    await expect(
      host.getByRole("heading", { name: "Selection context" }),
    ).toBeVisible();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Enter}");
    await expect(host.getByRole("tab", { name: "File" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.click(
      host.getByRole("button", { name: "Collapse file panel" }),
    );
    const restore = canvas.getByRole("button", { name: "Open file panel" });
    await expect(restore).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(
      canvas.getByRole("button", { name: "Collapse file panel" }),
    ).toHaveFocus();
  },
};

export const FindNestedLayer: StoryObj<typeof Demo> = {
  play: async ({ canvas, userEvent }) => {
    const layerName = "E\u0301tude";
    await userEvent.click(canvas.getByRole("treeitem", { name: "Mark" }));
    await userEvent.keyboard("{F2}");
    const rename = canvas.getByRole("textbox", { name: "Rename Mark" });
    await userEvent.clear(rename);
    await userEvent.type(rename, layerName + "{Enter}");
    const logo = canvas.getByRole("treeitem", { name: "Logo" });
    await userEvent.click(logo);
    await userEvent.keyboard("{ArrowLeft}");
    await expect(logo).toHaveAttribute("aria-expanded", "false");
    await expect(
      canvas.queryByRole("treeitem", { name: layerName }),
    ).toBeNull();

    const search = canvas.getByRole("button", { name: "Search layers" });
    await userEvent.click(search);
    const input = canvas.getByRole("searchbox");
    await userEvent.type(input, "ÉTUDE");
    await fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    await expect(input).toHaveFocus();
    const matches = within(
      canvas.getByRole("navigation", { name: "Matching layers" }),
    );
    const mark = matches.getByRole("button", { name: layerName });
    await userEvent.tab();
    await expect(mark).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(mark).toHaveAttribute("aria-current", "true");
    await userEvent.keyboard("{Escape}");
    await expect(search).toHaveFocus();
    await expect(
      canvas.getByRole("treeitem", { name: layerName }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      canvas.getByRole("treeitem", { name: "Logo" }),
    ).toHaveAttribute("aria-expanded", "true");
  },
};

export const FilterByType: StoryObj<typeof Demo> = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    const filter = canvas.getByRole("button", { name: "Filter layers" });
    await userEvent.click(filter);
    const type = () => canvas.getByRole("combobox", { name: "Layer type" });
    await userEvent.click(type());
    const popup = within(canvasElement.ownerDocument.body);
    await popup.findByRole("option", { name: "Icons" });
    await expect(type()).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(type()).toHaveFocus());
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Escape}");
    await expect(filter).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(type());
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole("option", {
        name: "Icons",
      }),
    );
    const search = canvas.getByRole("button", { name: "Search layers" });
    await userEvent.click(search);
    await userEvent.type(canvas.getByRole("searchbox"), "Mark");
    const results = within(
      canvas.getByRole("navigation", { name: "Matching layers" }),
    );
    const mark = results.getByRole("button", { name: /^Mark$/ });
    await userEvent.click(mark);
    await expect(mark).toHaveAttribute("aria-current", "true");
    await userEvent.keyboard("{Escape}");
    await expect(search).toHaveFocus();
    await expect(type()).toHaveTextContent("Icons");
    await userEvent.click(results.getByRole("button", { name: /^Mark$/ }));
    await userEvent.keyboard("{Escape}");
    await expect(filter).toHaveFocus();
    await expect(filter).toHaveAttribute("aria-pressed", "false");
    await expect(
      canvas.getByRole("treeitem", { name: /^Mark$/ }),
    ).toHaveAttribute("aria-selected", "true");
  },
};

export const NestedLibraryViews: StoryObj<typeof Demo> = {
  render: function NestedLibraryViewsExample() {
    const [tab, setTab] = React.useState("library");
    return (
      <div style={{ inlineSize: "min(320px, 100%)", blockSize: 320 }}>
        <DesignFilePanel
          title="Design resources"
          tabsLabel="Document panels"
          tabVariant="framed"
          tab={tab}
          onTabChange={setTab}
          tabs={[
            { value: "pages", label: "Pages", panel: "Home" },
            {
              value: "library",
              label: "Library",
              panel: (
                <Tabs defaultValue="components" className="p-2">
                  <TabsList aria-label="Library views">
                    <TabsTab value="components">Components</TabsTab>
                    <TabsTab value="tokens">Tokens</TabsTab>
                  </TabsList>
                  <TabsPanel value="components">Buttons and inputs</TabsPanel>
                  <TabsPanel value="tokens">Color and typography</TabsPanel>
                </Tabs>
              ),
            },
          ]}
        />
      </div>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const outer = canvas.getByRole("tabpanel", { name: "Library" });
    const library = within(outer);
    await userEvent.click(library.getByRole("tab", { name: "Components" }));
    await userEvent.keyboard("{End}{Enter}");
    const tokens = library.getByRole("tab", { name: "Tokens", selected: true });
    await expect(tokens).toHaveFocus();
    await expect(
      canvas.getByRole("tab", { name: "Library", selected: true }),
    ).toBeVisible();
    const panel = library.getByRole("tabpanel", { name: "Tokens" });
    await expect(getComputedStyle(outer).overflowY).toBe("auto");
    await expect(getComputedStyle(panel).overflowY).toBe("visible");
    await expect(getComputedStyle(panel).flexGrow).toBe("0");
  },
};

export const NarrowPageList: StoryObj<typeof Demo> = {
  render: function NarrowPageListExample() {
    const [page, setPage] = React.useState("library");
    return (
      <div style={{ inlineSize: 160 }}>
        <DesignFilePageList
          label="Pages"
          value={page}
          onValueChange={setPage}
          pages={[
            { id: "library", label: "DesignSystemComponentLibrary" },
            {
              id: "assets",
              label: (
                <span>
                  Project <strong>assets</strong>
                </span>
              ),
            },
          ]}
        />
      </div>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const list = canvas.getByRole("navigation", { name: "Pages" });
    const library = within(list).getByRole("button", {
      name: "DesignSystemComponentLibrary",
    });
    const assets = within(list).getByRole("button", { name: "Project assets" });
    await expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
    const range = assets.ownerDocument.createRange();
    range.selectNodeContents(within(assets).getByText("assets"));
    const bounds = assets.getBoundingClientRect();
    for (const line of range.getClientRects()) {
      await expect(line.left).toBeGreaterThanOrEqual(bounds.left);
      await expect(line.right).toBeLessThanOrEqual(bounds.right);
    }
    library.focus();
    await userEvent.tab();
    await expect(assets).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(assets).toHaveAttribute("aria-current", "page");
  },
};

export const ResizeWhileRenaming: StoryObj<typeof Demo> = {
  play: async ({ canvas, userEvent }) => {
    const tree = canvas.getByRole("tree", { name: "Layers" });
    const viewport = tree.parentElement;
    if (!viewport) throw new Error("Missing layer viewport");
    await userEvent.click(within(tree).getByRole("treeitem", { name: "Nav" }));
    await userEvent.keyboard("{F2}");
    const name = within(tree).getByRole("textbox", { name: "Rename Nav" });
    await userEvent.clear(name);
    await userEvent.type(name, "Navigation");
    const flex = viewport.style.flex;
    try {
      viewport.style.flex = "0 0 0px";
      await waitFor(() => expect(viewport).toHaveAttribute("inert"));
      await expect(tree.isConnected).toBe(true);
      await waitFor(() => expect(name).not.toHaveFocus());
      viewport.style.flex = "0 0 127.5px";
      await waitFor(() =>
        expect(tree.getBoundingClientRect().height).toBe(127.5),
      );
      await expect(tree.getBoundingClientRect().bottom).toBe(
        viewport.getBoundingClientRect().bottom,
      );
    } finally {
      viewport.style.flex = flex;
    }
    await waitFor(() => expect(viewport).not.toHaveAttribute("inert"));
    const renamed = within(tree).getByRole("treeitem", { name: "Navigation" });
    await expect(renamed).toHaveAttribute("aria-selected", "true");
    await expect(renamed).toHaveAttribute("tabindex", "0");
  },
};
