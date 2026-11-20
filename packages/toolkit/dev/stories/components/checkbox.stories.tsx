import { checkboxProps, COLORS } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Checkbox } from "../../../src/ui/base-ui/checkbox.js";
import { Field, FieldLabel } from "../../../src/ui/base-ui/field.js";
import { propControls } from "../prop-controls.js";

const controls = propControls(checkboxProps);

const meta = {
  title: "Components/Checkbox",
  component: Checkbox,
  parameters: { layout: "padded" },
  args: { ...controls.args, defaultChecked: true, disabled: false },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Checkbox>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The checkbox with the props from the controls. */
export const Playground: Story = { args: { "aria-label": "Notify me" } };

/** Sizes 1 to 3: 12, 16 and 20px boxes. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      {checkboxProps.size.values.map((size) => (
        <Checkbox
          key={size}
          {...args}
          size={size}
          aria-label={`Size ${size}`}
        />
      ))}
    </div>
  ),
};

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
