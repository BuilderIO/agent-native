import { checkboxProps, COLORS } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconStarFilled } from "@tabler/icons-react";
import { expect } from "storybook/test";

import {
  Checkbox,
  CheckboxIndicator,
} from "../../../src/ui/base-ui/checkbox.js";
import { Field, FieldLabel } from "../../../src/ui/base-ui/field.js";
import { propControls } from "../prop-controls.js";
import guide from "./checkbox.docs.md?raw";

const controls = propControls(checkboxProps);

const meta = {
  title: "Components/Checkbox",
  component: Checkbox,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, defaultChecked: true, disabled: false },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Checkbox>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The checkbox with the props from the controls. */
export const Playground: Story = { args: { "aria-label": "Notify me" } };

/** Each variant off, on and indeterminate in every color, then in high contrast. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {[false, true].map((highContrast) =>
        checkboxProps.variant.values.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex items-center gap-4"
          >
            {COLORS.map((color) => (
              <div key={color} className="flex items-center gap-1">
                <Checkbox
                  {...args}
                  variant={variant}
                  color={color}
                  highContrast={highContrast}
                  defaultChecked={false}
                  aria-label={`${color} off`}
                />
                <Checkbox
                  {...args}
                  variant={variant}
                  color={color}
                  highContrast={highContrast}
                  defaultChecked
                  aria-label={`${color} on`}
                />
                <Checkbox
                  {...args}
                  variant={variant}
                  color={color}
                  highContrast={highContrast}
                  indeterminate
                  aria-label={`${color} indeterminate`}
                />
              </div>
            ))}
            <span className="text-xs text-fg-muted">
              {variant}
              {highContrast ? ", high contrast" : ""}
            </span>
          </div>
        )),
      )}
    </div>
  ),
};

/** Off, on, indeterminate, disabled and invalid, each labelled by its field. */
export const States: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <Field>
        <FieldLabel>
          <Checkbox {...args} defaultChecked={false} /> Off
        </FieldLabel>
      </Field>
      <Field>
        <FieldLabel>
          <Checkbox {...args} defaultChecked /> On
        </FieldLabel>
      </Field>
      <Field>
        <FieldLabel>
          <Checkbox {...args} indeterminate /> Indeterminate
        </FieldLabel>
      </Field>
      <Field disabled>
        <FieldLabel>
          <Checkbox {...args} defaultChecked disabled /> Disabled
        </FieldLabel>
      </Field>
      <Field invalid>
        <FieldLabel>
          <Checkbox {...args} defaultChecked={false} /> Invalid
        </FieldLabel>
      </Field>
    </div>
  ),
};

/** A custom selection mark with the same label and keyboard behavior. */
export const CustomIndicator: Story = {
  render: (args) => (
    <Field>
      <FieldLabel>
        <Checkbox {...args} defaultChecked={false}>
          <CheckboxIndicator>
            <IconStarFilled aria-hidden />
          </CheckboxIndicator>
        </Checkbox>
        Favorite
      </FieldLabel>
    </Field>
  ),
  play: async ({ canvas, userEvent }) => {
    const checkbox = canvas.getByRole("checkbox", { name: "Favorite" });
    await userEvent.tab();
    await expect(checkbox).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect(checkbox).toBeChecked();
    await expect(
      checkbox.querySelector(".checkbox-indicator svg"),
    ).toBeVisible();
    await userEvent.click(canvas.getByText("Favorite"));
    await expect(checkbox).not.toBeChecked();
  },
};
