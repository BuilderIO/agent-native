import { COLORS, radioGroupProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { Field, FieldLabel } from "../../../src/ui/base-ui/field.js";
import {
  Radio,
  RadioGroup,
  type RadioGroupProps,
} from "../../../src/ui/base-ui/radio-group.js";
import { propControls } from "../prop-controls.js";
import guide from "./radio-group.docs.md?raw";

const controls = propControls(radioGroupProps);

const PLANS = ["Free", "Pro", "Team"] as const;

function Plans(props: RadioGroupProps) {
  return (
    <RadioGroup defaultValue="pro" aria-label="Plan" {...props}>
      {PLANS.map((plan) => (
        <Field key={plan}>
          <FieldLabel>
            <Radio value={plan.toLowerCase()} /> {plan}
          </FieldLabel>
        </Field>
      ))}
    </RadioGroup>
  );
}

const meta = {
  title: "Components/Radio Group",
  component: RadioGroup,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, disabled: false },
  argTypes: controls.argTypes,
  render: (args) => <Plans {...args} />,
} satisfies Meta<typeof RadioGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The group with the props from the controls, which its radios draw with. */
export const Playground: Story = {};

/** Each variant in every color, then in high contrast. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-6">
      {[false, true].map((highContrast) =>
        radioGroupProps.variant.values.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex items-start gap-6"
          >
            {COLORS.map((color) => (
              <Plans
                key={color}
                {...args}
                variant={variant}
                color={color}
                highContrast={highContrast}
              />
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

/** A disabled option, an invalid group, and a disabled group. */
export const States: Story = {
  render: (args) => (
    <div className="flex items-start gap-8">
      <RadioGroup {...args} defaultValue="pro" aria-label="Plan">
        <Field>
          <FieldLabel>
            <Radio value="pro" /> Pro
          </FieldLabel>
        </Field>
        <Field disabled>
          <FieldLabel>
            <Radio value="enterprise" disabled /> Enterprise
          </FieldLabel>
        </Field>
      </RadioGroup>
      <Field invalid>
        <Plans {...args} defaultValue={null} aria-label="Plan, invalid" />
      </Field>
      <Plans {...args} disabled aria-label="Plan, disabled" />
    </div>
  ),
};

export const ItemOverrides: Story = {
  render: () => (
    <RadioGroup
      aria-label="Publishing"
      defaultValue="automatic"
      color="gray"
      variant="soft"
      highContrast
    >
      <label>
        <Radio value="automatic" />
        Automatic
      </label>
      <label>
        <Radio
          value="manual"
          variant="surface"
          highContrast={false}
          color="accent"
        />
        Manual approval
      </label>
    </RadioGroup>
  ),
  play: async ({ canvas, userEvent }) => {
    const automatic = canvas.getByRole("radio", { name: "Automatic" });
    const manual = canvas.getByRole("radio", { name: "Manual approval" });
    await expect(automatic).toHaveAttribute("data-color", "gray");
    await expect(automatic).toHaveAttribute("data-high-contrast");
    await expect(manual).toHaveAttribute("data-color", "accent");
    await expect(manual).toHaveAttribute("data-variant", "surface");
    await expect(manual).not.toHaveAttribute("data-high-contrast");
    automatic.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(manual).toBeChecked();
    await expect(automatic).not.toBeChecked();
  },
};
