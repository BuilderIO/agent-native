import { checkboxGroupProps, COLORS } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CheckboxGroup,
  type CheckboxGroupProps,
} from "../../../src/ui/base-ui/checkbox-group.js";
import { Checkbox } from "../../../src/ui/base-ui/checkbox.js";
import { Field, FieldLabel } from "../../../src/ui/base-ui/field.js";
import { propControls } from "../prop-controls.js";
import guide from "./checkbox-group.docs.md?raw";

const controls = propControls(checkboxGroupProps);

const CHANNELS = ["Email", "SMS", "Push"] as const;

function Channels(props: CheckboxGroupProps) {
  return (
    <CheckboxGroup defaultValue={["email"]} aria-label="Channels" {...props}>
      {CHANNELS.map((channel) => (
        <Field key={channel}>
          <FieldLabel>
            <Checkbox value={channel.toLowerCase()} /> {channel}
          </FieldLabel>
        </Field>
      ))}
    </CheckboxGroup>
  );
}

const meta = {
  title: "Components/Checkbox Group",
  component: CheckboxGroup,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, disabled: false },
  argTypes: controls.argTypes,
  render: (args) => <Channels {...args} />,
} satisfies Meta<typeof CheckboxGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The group with the props from the controls, which its checkboxes take. */
export const Playground: Story = {};

/** Each variant in every color, set on the group, then in high contrast. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-6">
      {[false, true].map((highContrast) =>
        checkboxGroupProps.variant.values.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex items-start gap-6"
          >
            {COLORS.map((color) => (
              <Channels
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

/** A checkbox's own props win over the group's. */
export const ItemOverride: Story = {
  render: (args) => (
    <CheckboxGroup
      {...args}
      color="gray"
      defaultValue={["email", "sms"]}
      aria-label="Channels"
    >
      <Field>
        <FieldLabel>
          <Checkbox value="email" /> Email, the group's gray
        </FieldLabel>
      </Field>
      <Field>
        <FieldLabel>
          <Checkbox value="sms" color="danger" /> SMS, its own danger
        </FieldLabel>
      </Field>
    </CheckboxGroup>
  ),
};

/** A disabled group disables every checkbox in it. */
export const Disabled: Story = {
  render: (args) => <Channels {...args} disabled />,
};
