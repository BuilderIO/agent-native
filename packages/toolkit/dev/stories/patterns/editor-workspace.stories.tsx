import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import guide from "./editor-workspace.docs.md?raw";
import { EditorWorkspace } from "./editor-workspace.js";

export default {
  title: "Patterns/Editor Workspace",
  component: EditorWorkspace,
  parameters: {
    docs: { description: { component: guide } },
    layout: "fullscreen",
    stage: "editor",
    viewport: { defaultViewport: "desktop" },
  },
} satisfies Meta<typeof EditorWorkspace>;
export const Design: StoryObj<typeof EditorWorkspace> = {
  render: () => <EditorWorkspace />,
};
export const Dockable: StoryObj<typeof EditorWorkspace> = {
  args: { initialSelection: "nav" },
  render: (args) => <EditorWorkspace {...args} dockable />,
  play: async ({ canvas }) => {
    const workspace = within(
      canvas.getByRole("region", { name: "Dockable workspace" }),
    );
    await expect(
      workspace.getByRole("region", { name: "Design canvas" }),
    ).toBeVisible();
    await expect(workspace.queryByRole("tab", { name: "Canvas" })).toBeNull();
    await expect(
      workspace.getByRole("tab", { name: "Inspector" }),
    ).toBeVisible();
  },
};
export const AutoLayout: StoryObj<typeof EditorWorkspace> = {
  ...Design,
  play: async ({ canvas, userEvent }) => {
    const inspector = canvas.queryByRole("tab", { name: "Inspector" });
    if (inspector) await userEvent.click(inspector);
    const linksBounds = async () => {
      const scene = canvas.getByRole("region", { name: "Design canvas" });
      const links = within(scene).getByRole("button", { name: "Select Links" });
      const rect = links.getBoundingClientRect().toJSON();
      return rect;
    };
    const original = await linksBounds();
    const auto = () => canvas.getByRole("button", { name: "Auto layout" });
    await userEvent.click(auto());
    await userEvent.click(canvas.getByRole("button", { name: "Vertical" }));
    await expect(await linksBounds()).not.toEqual(original);
    await userEvent.click(canvas.getByRole("button", { name: "Horizontal" }));
    const matrix = canvas.getByRole("radiogroup", { name: "Frame alignment" });
    await userEvent.click(
      within(matrix).getByRole("radio", { name: /^Center$/ }),
    );
    const centered = await linksBounds();
    await userEvent.click(auto());
    await expect(await linksBounds()).toEqual(original);
    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
    await expect(auto()).toHaveAttribute("aria-pressed", "true");
    await expect(await linksBounds()).toEqual(centered);
  },
};
export const MixedSelection: StoryObj<typeof EditorWorkspace> = {
  render: () => <EditorWorkspace initialSelection="hundred" />,
};
export const EditSelection: StoryObj<typeof EditorWorkspace> = {
  ...MixedSelection,
  play: async ({ canvas, userEvent }) => {
    if (!canvas.queryByRole("complementary", { name: "Layer properties" })) {
      await userEvent.click(canvas.getByRole("tab", { name: "Inspector" }));
    }
    const width = () => canvas.getByRole("textbox", { name: "Width" });
    await expect(canvas.getByTestId("selected-count")).toHaveTextContent(
      "100 selected",
    );
    await expect(width()).toHaveAttribute("placeholder", "Mixed");
    await userEvent.click(width());
    await userEvent.type(width(), "400{Escape}");
    await expect(width()).toHaveFocus();
    await expect(width()).toHaveValue("");
    await expect(canvas.getByRole("button", { name: "Undo" })).toBeDisabled();
    await userEvent.type(width(), "512{Enter}");
    await expect(width()).toHaveValue("512");
    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
    await expect(width()).toHaveValue("");
    await expect(canvas.getByRole("button", { name: "Undo" })).toBeDisabled();
    const layers = canvas.queryByRole("tree", { name: "Layers" });
    if (layers) {
      await userEvent.click(
        within(layers).getByRole("treeitem", { name: "Nav" }),
      );
      await expect(
        canvas.getByRole("button", { name: "Select Nav" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(width()).toHaveValue("1280");
      await userEvent.click(
        canvas.getByRole("button", { name: "Select Headline" }),
      );
      await expect(
        within(layers).getByRole("treeitem", {
          name: "The app framework your agent can actually use.",
        }),
      ).toHaveAttribute("aria-selected", "true");
    }
  },
};

export const LockedSelection: StoryObj<typeof EditorWorkspace> = {
  ...Design,
  play: async ({ canvas, userEvent }) => {
    const tree = canvas.getByRole("tree", { name: "Layers" });
    const nav = within(tree).getByRole("treeitem", { name: "Nav" });
    await userEvent.click(nav);
    await userEvent.click(
      within(nav).getByRole("button", { name: "Lock Nav" }),
    );
    const width = () => canvas.getByRole("textbox", { name: "Width" });
    await expect(width()).toBeDisabled();
    const logo = within(tree).getByRole("treeitem", { name: "Logo" });
    await userEvent.click(logo);
    await expect(width()).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Select Logo" }),
    ).toHaveAttribute("aria-disabled", "true");
    const headline = canvas.getByRole("button", { name: "Select Headline" });
    await userEvent.click(headline);
    await userEvent.keyboard("{Control>}");
    await userEvent.click(nav);
    await userEvent.keyboard("{/Control}");
    await expect(canvas.getByTestId("selected-count")).toHaveTextContent(
      "2 selected",
    );
    await expect(canvas.getByRole("img", { name: "1 locked" })).toBeVisible();
    await expect(width()).toHaveValue("700");
    await userEvent.clear(width());
    await userEvent.type(width(), "512{Enter}");
    await expect(headline.parentElement).toHaveStyle({ width: "512px" });
    await expect(
      canvas.getByRole("button", { name: "Select Nav" }).parentElement,
    ).toHaveStyle({ width: "1280px" });
    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
    await expect(headline.parentElement).toHaveStyle({ width: "700px" });
  },
};
export const PageHistory: StoryObj<typeof EditorWorkspace> = {
  ...Design,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Add page" }));
    const count = () => canvas.getByTestId("selected-count");
    await expect(count()).toHaveTextContent("Untitled");
    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
    await expect(count()).toHaveTextContent("Nav");
    await expect(
      canvas.getByRole("button", { name: "Select Nav" }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(canvas.getByRole("button", { name: "Redo" }));
    await expect(count()).toHaveTextContent("Untitled");
    await expect(
      canvas.getByRole("button", { name: "Select Untitled" }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};

export const FilePanelFocus: StoryObj<typeof EditorWorkspace> = {
  ...Design,
  play: async ({ canvas, userEvent }) => {
    const close = canvas.getByRole("button", { name: "Collapse file panel" });
    close.focus();
    await userEvent.keyboard("{Enter}");
    const separator = canvas.getByRole("separator", {
      name: /Layers panel width|Tool panel height/,
    });
    await expect(separator).toHaveFocus();
    await expect(separator).toHaveAttribute("aria-valuenow", "0");
    await expect(
      canvas.getByRole("region", { name: "Design canvas" }),
    ).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(canvas.getByRole("complementary", { name: "File" })).toBeVisible(),
    );
  },
};

export const MatchingFills: StoryObj<typeof EditorWorkspace> = {
  ...Design,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body);
    const logo = canvas.getByRole("button", { name: "Select Logo" });
    const headline = canvas.getByRole("button", { name: "Select Headline" });
    const paintId = () =>
      canvas
        .getByRole("listitem", { name: "Linear gradient 1" })
        .getAttribute("data-paint-id");
    const ids = [];
    for (const layer of [logo, headline]) {
      await userEvent.click(layer);
      await userEvent.click(canvas.getByRole("button", { name: "Add fill" }));
      await userEvent.click(
        await page.findByRole("menuitem", { name: "Linear gradient" }),
      );
      ids.push(paintId());
    }
    const original = [
      logo.style.backgroundImage,
      headline.style.backgroundImage,
    ];
    await expect(ids[0]).toBeTruthy();
    await expect(ids[1]).toBeTruthy();
    await expect(ids[0]).not.toBe(ids[1]);
    await userEvent.keyboard("{Shift>}");
    await userEvent.click(logo);
    await userEvent.keyboard("{/Shift}");
    await expect(canvas.getByTestId("selected-count")).toHaveTextContent(
      "2 selected",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Edit Linear gradient 1" }),
    );
    const stop = await page.findByRole("slider", { name: "Stop 1" });
    stop.focus();
    await userEvent.keyboard("{ArrowRight}{Escape}");
    for (const layer of [logo, headline])
      await expect(layer.style.backgroundImage).toContain("1%");
    for (const [i, layer] of [logo, headline].entries()) {
      await userEvent.click(layer);
      await expect(paintId()).toBe(ids[i]);
    }
    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
    await expect([
      logo.style.backgroundImage,
      headline.style.backgroundImage,
    ]).toEqual(original);
  },
};
