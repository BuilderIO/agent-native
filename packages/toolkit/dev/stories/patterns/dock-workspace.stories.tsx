import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, within, waitFor } from "storybook/test";

import {
  DockWorkspace,
  type DockLayout,
} from "../../../src/ui/base-ui/dock-workspace.js";
import { Input } from "../../../src/ui/base-ui/input.js";

const initial: DockLayout = {
  type: "split",
  id: "workspace",
  axis: "inline",
  side: "end",
  size: 240,
  first: {
    type: "group",
    id: "navigation",
    tabs: ["layers", "assets"],
    active: "layers",
  },
  second: {
    type: "group",
    id: "properties",
    tabs: ["inspector"],
    active: "inspector",
  },
};
function Example({ nested = false }: { nested?: boolean }) {
  const [layout, setLayout] = React.useState(initial);
  return (
    <div style={{ blockSize: 320, inlineSize: "min(100%, 640px)" }}>
      <DockWorkspace
        label={nested ? "Outer workspace" : "Workspace panels"}
        layout={layout}
        onLayoutChange={setLayout}
        onReset={() => setLayout(initial)}
        panels={[
          {
            id: "layers",
            label: "Layers",
            content: nested ? (
              <Example />
            ) : (
              <Input aria-label="Filter layers" placeholder="Filter layers" />
            ),
          },
          {
            id: "assets",
            label: "Assets",
            content: (
              <Input aria-label="Filter assets" placeholder="Filter assets" />
            ),
          },
          {
            id: "inspector",
            label: "Inspector",
            content: <Input aria-label="Layer name" defaultValue="Frame" />,
          },
        ]}
      />
    </div>
  );
}
export default {
  title: "Patterns/Dock Workspace",
  component: DockWorkspace,
  render: () => <Example />,
  parameters: {
    docs: {
      description: {
        component:
          "Drag a tab along its strip to reorder it, or onto another strip to join that group. The line marks the insertion point, including over empty strip space and the Arrange button. To split a pane, drag into the panel content until an edge highlights. Releasing over the unmarked center keeps the layout in place. On an overflowing strip, swipe sideways to browse tabs. Continue the swipe into another pane to dock, or drag vertically to start docking immediately. Pinch to zoom with two fingers. The Arrange menu also supports keyboard and touch. Keep panel IDs stable and store the layout separately from their content.",
      },
    },
  },
} satisfies Meta;
export const Playground: StoryObj = {
  play: async ({ canvas, canvasElement }) => {
    const assets = canvas.getByRole("tab", { name: "Assets" });
    assets.scrollIntoView({ block: "nearest", inline: "nearest" });
    const { left, width, top, bottom } = assets.getBoundingClientRect();
    for (const y of [top - 2, bottom + 2]) {
      const hit = canvasElement.ownerDocument.elementFromPoint(
        left + width / 2,
        y,
      );
      await expect(hit?.closest('[role="tab"]')).toBe(assets);
    }
  },
};
export const KeyboardPlacement: StoryObj = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    const doc = within(canvasElement.ownerDocument.body);
    const field = canvas.getByRole("textbox", { name: "Layer name" });
    await userEvent.clear(field);
    await userEvent.type(field, "Navigation");
    const arrange = canvas.getByRole("button", { name: "Arrange Inspector" });
    arrange.focus();
    await userEvent.keyboard("{Enter}");
    const destination = await doc.findByRole("menuitem", { name: "Layers" });
    await userEvent.keyboard("{Home}");
    await waitFor(() => expect(destination).toHaveFocus());
    await userEvent.keyboard("{ArrowRight}");
    const join = await doc.findByRole("menuitem", { name: "Join tab group" });
    await userEvent.keyboard("{Home}");
    await waitFor(() => expect(join).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(canvas.getAllByRole("tablist")).toHaveLength(1));
    await expect(
      canvas.getByRole("tab", { name: "Inspector", selected: true }),
    ).toHaveFocus();
    await expect(canvas.getByRole("textbox", { name: "Layer name" })).toBe(
      field,
    );
    await expect(field).toHaveValue("Navigation");
    await userEvent.click(
      canvas.getByRole("button", { name: "Arrange Inspector" }),
    );
    await userEvent.click(
      await doc.findByRole("menuitem", { name: "Reset layout" }),
    );
    await waitFor(() => expect(canvas.getAllByRole("tablist")).toHaveLength(2));
    await expect(field).toHaveValue("Navigation");
  },
};

export const NestedWorkspaces: StoryObj = {
  render: () => <Example nested />,
  play: async ({ canvas, userEvent }) => {
    const outer = within(
      canvas.getByRole("region", { name: "Outer workspace" }),
    );
    const inner = within(
      outer.getByRole("region", { name: "Workspace panels" }),
    );
    const nestedName = inner.getByRole("textbox", { name: "Layer name" });
    const outerName = outer
      .getAllByRole("textbox", { name: "Layer name" })
      .find((el) => el !== nestedName);
    if (!outerName) throw new Error("Missing outer inspector");
    await userEvent.type(nestedName, " draft");
    const outerList = outer.getAllByRole("tablist", {
      name: "Layers, Assets",
    })[0];
    await userEvent.click(
      within(outerList).getByRole("tab", { name: "Assets" }),
    );
    await expect(outer.getByRole("textbox", { name: "Layer name" })).toBe(
      outerName,
    );
    await userEvent.click(
      within(outerList).getByRole("tab", { name: "Layers" }),
    );
    await expect(inner.getByRole("textbox", { name: "Layer name" })).toBe(
      nestedName,
    );
    await expect(nestedName).toHaveValue("Frame draft");
  },
};

export const OverflowingTabs: StoryObj = {
  render: function OverflowingTabs() {
    const names = [
      "Layers",
      "Assets",
      "Inspector",
      "Library",
      "History",
      "Tokens",
      "Components",
      "Styles",
    ];
    const [layout, setLayout] = React.useState<DockLayout>(() => ({
      type: "group",
      id: "tools",
      tabs: names,
      active: "Layers",
    }));
    return (
      <div style={{ inlineSize: "min(100%, 280px)", blockSize: 160 }}>
        <DockWorkspace
          layout={layout}
          onLayoutChange={setLayout}
          label="Workspace tools"
          panels={names.map((label) => ({
            id: label,
            label,
            content: (
              <Input
                aria-label={`Filter ${label}`}
                placeholder={`Filter ${label}`}
              />
            ),
          }))}
        />
      </div>
    );
  },
};

export const ReorderOverflowingTabs: StoryObj = {
  ...OverflowingTabs,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body);
    const tab = canvas.getByRole("tab", { name: "Layers" });
    const list = canvas.getByRole("tablist");
    const arrange = canvas.getByRole("button", { name: "Arrange Layers" });
    for (let i = 1; i < within(list).getAllByRole("tab").length; i++) {
      arrange.focus();
      await userEvent.keyboard("{Enter}");
      const later = await page.findByRole("menuitem", {
        name: "Move tab later",
      });
      later.focus();
      await userEvent.keyboard("{Enter}");
      await waitFor(() =>
        expect(within(list).getAllByRole("tab")[i]).toBe(tab),
      );
      await expect(tab).toHaveFocus();
      const rail = list.getBoundingClientRect(),
        bounds = tab.getBoundingClientRect();
      await expect(bounds.left).toBeGreaterThanOrEqual(rail.left - 1);
      await expect(bounds.right).toBeLessThanOrEqual(rail.right + 1);
    }
  },
};
