import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, within } from "storybook/test";

import { InspectorGrid } from "../../../src/ui/base-ui/inspector.js";
import { PropertyNumber } from "../../../src/ui/base-ui/layout-properties.js";
import {
  PropertyTokenField,
  useTokenBinding,
  type PropertyBinding,
} from "../../../src/ui/base-ui/property-token.js";

const spacing = [
  { id: "space-1", label: "Small", value: 4 },
  { id: "space-2", label: "Medium", value: 8 },
];
function SpacingField({
  axis,
  initial,
}: {
  axis: string;
  initial: PropertyBinding<number>;
}) {
  const [property, change] = useState(initial);
  const binding = useTokenBinding(property, spacing, change);
  return (
    <PropertyTokenField
      label={axis + " padding token"}
      binding={binding}
      prefix={axis}
      format={(n) => n + "px"}
    >
      <PropertyNumber
        label={axis + " padding"}
        prefix={axis}
        value={binding.resolved}
        onEdit={(edit) => {
          if (edit.phase === "commit") change({ value: edit.value });
        }}
      />
    </PropertyTokenField>
  );
}

export default {
  title: "Components/Property Token",
  component: PropertyTokenField,
  parameters: {
    docs: {
      description: {
        component:
          "Bind a property to a named value. The picker sits inside the literal field. A compact badge marks the bound value. Detach is the first entry in its menu. Open that field to replace or detach its token, or press Backspace while it has focus.",
      },
    },
  },
} satisfies Meta;

export const AdjacentFields: StoryObj = {
  render: () => (
    <div style={{ inlineSize: "min(100%, 16rem)" }}>
      <InspectorGrid>
        <SpacingField axis="X" initial={{ token: "space-1", value: 4 }} />
        <SpacingField axis="Y" initial={{ token: "space-2", value: 8 }} />
      </InspectorGrid>
    </div>
  ),
};

export const DetachOneField: StoryObj = {
  ...AdjacentFields,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const x = canvas.getByRole("combobox", { name: "X padding token" });
    const y = canvas.getByRole("combobox", { name: "Y padding token" });
    await expect(x.querySelector(".badge")).toHaveTextContent("Small");
    await expect(y.querySelector(".badge")).toHaveTextContent("Medium");
    await userEvent.click(x);
    const options = await within(
      canvasElement.ownerDocument.body,
    ).findAllByRole("option");
    await expect(options[0]).toHaveAccessibleName("Detach");
    await userEvent.click(options[0]);
    await expect(
      canvas.getByRole("textbox", { name: "X padding" }),
    ).toHaveValue("4");
    await expect(y.querySelector(".badge")).toHaveTextContent("Medium");
    const field = canvas
      .getByRole("textbox", { name: "X padding" })
      .closest(".input");
    if (!field) throw new Error("Missing literal field");
    const frame = field.getBoundingClientRect(),
      trigger = x.getBoundingClientRect();
    await expect(trigger.left).toBeGreaterThanOrEqual(frame.left - 0.5);
    await expect(trigger.right).toBeLessThanOrEqual(frame.right + 0.5);
    await expect(trigger.top).toBeGreaterThanOrEqual(frame.top - 0.5);
    await expect(trigger.bottom).toBeLessThanOrEqual(frame.bottom + 0.5);
  },
};
