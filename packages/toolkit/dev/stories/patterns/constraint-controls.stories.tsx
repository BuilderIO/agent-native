import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, waitFor, within } from "storybook/test";

import {
  ConstraintControls,
  ConstraintPicker,
  type ConstraintValue,
  type ConstraintEdit,
} from "../../../src/ui/base-ui/constraint-controls.js";
import guide from "./constraint-controls.docs.md?raw";

const initial: ConstraintValue = { horizontal: "left", vertical: "top" };

function Example({
  mixed = false,
  disabled = false,
  popup = false,
}: {
  mixed?: boolean;
  disabled?: boolean;
  popup?: boolean;
}) {
  const [layers, setLayers] = useState<ConstraintValue[]>(
    mixed ? [initial, { horizontal: "right", vertical: "bottom" }] : [initial],
  );
  const [first] = layers;
  const value: ConstraintValue = {
    horizontal: layers.every((layer) => layer.horizontal === first.horizontal)
      ? first.horizontal
      : "mixed",
    vertical: layers.every((layer) => layer.vertical === first.vertical)
      ? first.vertical
      : "mixed",
  };
  const props = {
    value,
    disabled,
    onChange: (change: ConstraintEdit) =>
      setLayers((layers) => layers.map((layer) => ({ ...layer, ...change }))),
  };
  return popup ? (
    <ConstraintPicker {...props} />
  ) : (
    <div className="max-w-64">
      <ConstraintControls {...props} />
    </div>
  );
}

export default {
  title: "Patterns/Constraint Controls",
  component: ConstraintControls,
  parameters: { docs: { description: { component: guide } } },
} satisfies Meta<typeof ConstraintControls>;
export const Pins: StoryObj = {
  render: () => <Example />,
  play: async ({ canvas, userEvent }) => {
    const left = canvas.getByRole("button", { name: "Left" });
    const right = canvas.getByRole("button", { name: "Right" });
    await expect(left).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(right);
    await expect(
      canvas.getByRole("combobox", { name: "Horizontal constraint" }),
    ).toHaveTextContent("Left and right");
    left.focus();
    await userEvent.keyboard(" ");
    await expect(right).toHaveAttribute("aria-pressed", "true");
    await expect(left).toHaveAttribute("aria-pressed", "false");
    await expect(
      canvas.getByRole("combobox", { name: "Horizontal constraint" }),
    ).toHaveTextContent("Right");
    await expect(canvas.getByRole("button", { name: "Top" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  },
};
export const MixedSelection: StoryObj = {
  render: () => <Example mixed />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const horizontal = canvas.getByRole("combobox", {
      name: "Horizontal constraint",
    });
    const vertical = canvas.getByRole("combobox", {
      name: "Vertical constraint",
    });
    await expect(horizontal).toHaveTextContent("Mixed");
    await expect(
      canvas.getByRole("button", { name: "Bottom" }),
    ).toHaveAttribute("aria-pressed", "mixed");
    await userEvent.click(horizontal);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole("option", { name: "Center" }));
    await expect(horizontal).toHaveTextContent("Center");
    await expect(vertical).toHaveTextContent("Mixed");
    await waitFor(() => expect(horizontal).toHaveFocus());
    vertical.focus();
    await userEvent.keyboard("{ArrowDown}");
    const list = await page.findByRole("listbox", {
      name: "Vertical constraint",
    });
    await waitFor(() =>
      expect(within(list).getByRole("option", { name: "Top" })).toHaveFocus(),
    );
    await userEvent.keyboard("{End}");
    await waitFor(() =>
      expect(page.getByRole("option", { name: "Scale" })).toHaveFocus(),
    );
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(vertical).toHaveTextContent("Scale"));
    await expect(horizontal).toHaveTextContent("Center");
  },
};
export const InPopover: StoryObj = {
  render: () => <Example popup />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Constraints" });
    await userEvent.click(trigger);
    const page = within(canvasElement.ownerDocument.body);
    const axis = await page.findByRole("combobox", {
      name: "Vertical constraint",
    });
    await userEvent.click(axis);
    await page.findByRole("listbox", { name: "Vertical constraint" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(axis).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
export const Disabled: StoryObj = {
  render: () => <Example disabled />,
  play: async ({ canvas }) => {
    for (const role of ["combobox", "button"] as const)
      for (const control of canvas.getAllByRole(role))
        await expect(control).toBeDisabled();
  },
};
