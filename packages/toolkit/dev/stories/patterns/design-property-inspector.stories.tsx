import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { expect, waitFor, within } from "storybook/test";

import { DesignSelectionProperties } from "../../../src/ui/base-ui/design-property-inspector.js";
import guide from "./design-property-inspector.docs.md?raw";
import { EditorWorkspace } from "./editor-workspace.js";
export default {
  title: "Patterns/Design Property Inspector",
  component: DesignSelectionProperties,
  parameters: {
    docs: { description: { component: guide } },
    layout: "fullscreen",
    stage: "editor",
  },
  render: () => <EditorWorkspace inspectorOnly />,
} satisfies Meta;
export const Nav: StoryObj = {};
export const CustomGrid: StoryObj = {
  render: () => (
    <div
      style={
        {
          "--inspector-inset-start": "24px",
          "--inspector-inset-end": "12px",
          "--inspector-gap": "16px",
          "--inspector-action-width": "40px",
          "--inspector-rule-width": "160px",
        } as CSSProperties
      }
    >
      <EditorWorkspace inspectorOnly />
    </div>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const panel = canvasElement.querySelector(".design-property-inspector");
    if (!panel) throw new Error("Missing inspector");
    const region = panel.getBoundingClientRect();
    const rtl = getComputedStyle(panel).direction === "rtl";
    const measurePart = (selector: string) => {
      const el = panel.querySelector(selector);
      if (!el) throw new Error("Missing inspector part: " + selector);
      const box = el.getBoundingClientRect();
      return [
        rtl ? region.right - box.right : box.left - region.left,
        box.width,
      ];
    };
    const fieldWidth = (region.width - 24 - 12 - 40 - 2 * 16) / 2;
    await expect(measurePart('.input:has(input[aria-label="X"])')).toEqual([
      24,
      fieldWidth,
    ]);
    const pairWidth = (region.width - 2 * 24 - 16) / 2;
    for (const part of [
      '.input:has(input[aria-label="Rotation"])',
      '[aria-label="Horizontal alignment"]',
    ]) {
      await expect(measurePart(part)).toEqual([24, pairWidth]);
    }
    await expect(measurePart('[aria-label="Vertical alignment"]')).toEqual([
      24 + pairWidth + 16,
      pairWidth,
    ]);
    await expect(
      measurePart(".design-property-inspector-instance .segmented-control"),
    ).toEqual([24, region.width - 48]);
    await expect(measurePart('[aria-label="Selection actions"]')).toEqual(
      measurePart('[aria-label="Auto layout"]'),
    );
    await expect(measurePart(".paint-editor-trigger")).toEqual([
      24,
      region.width - 24 - 12 - 2 * 40 - 16,
    ]);
    const first = measurePart('.input:has(input[aria-label="Width"])');
    const second = measurePart('.input:has(input[aria-label="Height"])');
    const action = measurePart('[aria-label="Auto layout"]');
    await expect(measurePart('[aria-label="Breakpoint"]')).toEqual([24, 160]);
    await expect(measurePart('[aria-label="Remove responsive rule"]')).toEqual([
      24 + 160 + 16 + (40 - action[1]) / 2,
      action[1],
    ]);
    await userEvent.click(canvas.getByRole("button", { name: "Auto layout" }));
    await expect(measurePart(".alignment-picker")).toEqual(first);
    await expect(measurePart('[aria-label="Layout direction"]')).toEqual(
      second,
    );
    await expect(measurePart('[aria-label="Wrap"]')).toEqual(action);
    await userEvent.click(canvas.getByLabelText("Grid", { exact: true }));
    await expect(measurePart(".grid-size-picker")).toEqual(first);
    await expect(measurePart('.input:has(input[aria-label="Gap"])')).toEqual(
      second,
    );
  },
};
export const AutoLayout: StoryObj = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Auto layout" }));
    await expect(
      canvas.getByRole("radiogroup", { name: "Frame alignment" }),
    ).toBeVisible();
  },
};
export const MultipleLayers: StoryObj = {
  render: () => <EditorWorkspace inspectorOnly initialSelection="hundred" />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const portal = within(canvasElement.ownerDocument.body);
    const settings = canvas.getByRole("button", {
      name: "Corner radius settings",
    });
    await userEvent.click(settings);
    const corners = await portal.findByRole("textbox", { name: "All corners" });
    await userEvent.clear(corners);
    await userEvent.type(corners, "16{Enter}");
    await expect(corners).toHaveValue("16");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(settings).toHaveFocus());
    await expect(
      canvas.getByRole("textbox", { name: "Corner radius" }),
    ).toHaveValue("16");
    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
    await userEvent.click(settings);
    await expect(
      await portal.findByRole("textbox", { name: "All corners" }),
    ).toHaveValue("0");
    await userEvent.keyboard("{Escape}");
  },
};

export const MixedResponsiveRules: StoryObj = {
  ...MultipleLayers,
  play: async ({ canvas, userEvent, canvasElement }) => {
    const breakpoint = canvas.getByRole("combobox", { name: "Breakpoint" });
    const padding = canvas.getByRole("combobox", {
      name: "Responsive padding",
    });
    const add = canvas.getByRole("button", { name: "Add responsive rule" });
    await expect(breakpoint).toHaveTextContent("Mixed");
    await expect(padding).toHaveTextContent("Mixed");
    await userEvent.click(add);
    await expect(add).toBeDisabled();
    await expect(breakpoint).toHaveTextContent("Below sm · 640");
    await userEvent.click(padding);
    const portal = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await portal.findByRole("option", { name: "Padding 16px" }),
    );
    await expect(padding).toHaveTextContent("Padding 16px");
    const undo = canvas.getByRole("button", { name: "Undo" });
    await userEvent.click(undo);
    await expect(padding).toHaveTextContent("Padding 24px");
    await userEvent.click(undo);
    await expect(add).toBeEnabled();
    await expect(breakpoint).toHaveTextContent("Mixed");
  },
};

export const SharedFill: StoryObj = {
  ...MultipleLayers,
  play: async ({ canvas, userEvent, canvasElement }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Use first fill" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Fill styles" }));
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole("menuitem", {
        name: "Ink",
      }),
    );
    const fills = within(canvas.getByRole("list", { name: "Fill" }));
    await expect(fills.getByText("Ink", { exact: true })).toBeVisible();
    const undo = canvas.getByRole("button", { name: "Undo" });
    await userEvent.click(undo);
    await expect(
      canvas.queryByRole("button", { name: "Use first fill" }),
    ).toBeNull();
    await userEvent.click(undo);
    await expect(
      canvas.getByRole("button", { name: "Use first fill" }),
    ).toBeVisible();
  },
};

export const EditNav: StoryObj = {
  play: async ({ canvas, userEvent, canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      canvas.getByRole("button", { name: "Width presets" }),
    );
    await userEvent.click(await portal.findByRole("menuitem", { name: "50%" }));
    await expect(canvas.getByRole("textbox", { name: "Width" })).toHaveValue(
      "640",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
    await expect(canvas.getByRole("textbox", { name: "Width" })).toHaveValue(
      "1280",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Fill styles" }));
    await userEvent.click(await portal.findByRole("menuitem", { name: "Ink" }));
    await expect(
      within(canvas.getByRole("list", { name: "Fill" })).getByText("Ink", {
        exact: true,
      }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: /^Remove .*1$/i }),
    );
    await expect(
      within(canvas.getByRole("list", { name: "Fill" })).queryByText("Ink", {
        exact: true,
      }),
    ).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: "Remove responsive rule" }),
    );
    await expect(
      canvas.queryByRole("combobox", { name: "Breakpoint" }),
    ).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: "Add responsive rule" }),
    );
    await expect(
      canvas.getByRole("combobox", { name: "Breakpoint" }),
    ).toBeVisible();
  },
};

export const Constraints: StoryObj = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Constraints" });
    await userEvent.click(trigger);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole("button", { name: "Right" }));
    const axis = page.getByRole("combobox", { name: "Horizontal constraint" });
    await expect(axis).toHaveTextContent("Left and right");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
    await userEvent.click(trigger);
    await expect(
      await page.findByRole("combobox", { name: "Horizontal constraint" }),
    ).toHaveTextContent(/^Left$/);
  },
};

export const StrokeAndEffects: StoryObj = {
  ...MultipleLayers,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body);
    for (const [section, field, preset] of [
      ["Stroke", "Stroke width", "2"],
      ["Effects", "Shadow blur", "12"],
    ] as const) {
      await userEvent.click(
        canvas.getByRole("button", { name: section + " styles" }),
      );
      await userEvent.click(
        await page.findByRole("menuitem", { name: preset + "px" }),
      );
      const input = canvas.getByRole("textbox", { name: field });
      await expect(input).toHaveValue(preset);
      await userEvent.clear(input);
      await userEvent.type(input, "6{Enter}");
      await expect(input).toHaveValue("6");
      await userEvent.click(
        canvas.getByRole("button", { name: "Remove " + section.toLowerCase() }),
      );
      await expect(canvas.queryByRole("textbox", { name: field })).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
      await expect(canvas.getByRole("textbox", { name: field })).toHaveValue(
        "6",
      );
    }
  },
};

export const RadiusBinding: StoryObj = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    const picker = canvas.getByRole("combobox", {
      name: "Corner radius token",
    });
    async function choose(name: RegExp | string) {
      picker.focus();
      await userEvent.keyboard("{Enter}");
      await waitFor(() =>
        expect(picker).toHaveAttribute("aria-expanded", "true"),
      );
      const item = await within(canvasElement.ownerDocument.body).findByRole(
        "option",
        { name },
      );
      await waitFor(() =>
        expect(getComputedStyle(item).pointerEvents).not.toBe("none"),
      );
      await userEvent.click(item);
      await waitFor(() => expect(picker).toHaveFocus());
    }
    await choose(/Radius 4\b/);
    await expect(picker.querySelector(".badge")).toHaveTextContent("Radius 4");
    await choose("Detach");
    await expect(
      canvas.getByRole("textbox", { name: "Corner radius" }),
    ).toHaveValue("8");
    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
    await expect(picker.querySelector(".badge")).toHaveTextContent("Radius 4");
  },
};
