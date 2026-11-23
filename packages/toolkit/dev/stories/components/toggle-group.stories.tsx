import { COLORS, toggleGroupProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
} from "@tabler/icons-react";

import {
  ToggleGroup,
  type ToggleGroupProps,
} from "../../../src/ui/base-ui/toggle-group.js";
import { Toggle } from "../../../src/ui/base-ui/toggle.js";
import { propControls } from "../prop-controls.js";
import guide from "./toggle-group.docs.md?raw";

const controls = propControls(toggleGroupProps);

function Alignment(props: ToggleGroupProps) {
  return (
    <ToggleGroup defaultValue={["left"]} aria-label="Align" {...props}>
      <Toggle value="left" aria-label="Left">
        <IconAlignLeft aria-hidden />
      </Toggle>
      <Toggle value="center" aria-label="Center">
        <IconAlignCenter aria-hidden />
      </Toggle>
      <Toggle value="right" aria-label="Right">
        <IconAlignRight aria-hidden />
      </Toggle>
    </ToggleGroup>
  );
}

const meta = {
  title: "Components/Toggle Group",
  component: ToggleGroup,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, disabled: false, multiple: false },
  argTypes: controls.argTypes,
  render: (args) => <Alignment {...args} />,
} satisfies Meta<typeof ToggleGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The group with the props from the controls, which its toggles take. */
export const Playground: Story = {};

/** md and sm, set once on the group. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-6">
      {toggleGroupProps.size.values.map((size) => (
        <Alignment key={size} {...args} size={size} />
      ))}
    </div>
  ),
};

/** Each variant in every color, set on the group, then in high contrast. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {[false, true].map((highContrast) =>
        toggleGroupProps.variant.values.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex items-center gap-6"
          >
            {COLORS.map((color) => (
              <Alignment
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

/** Vertical, several pressed at once, and disabled. */
export const States: Story = {
  render: (args) => (
    <div className="flex items-start gap-8">
      <Alignment {...args} orientation="vertical" />
      <Alignment {...args} multiple defaultValue={["left", "right"]} />
      <Alignment {...args} disabled />
    </div>
  ),
};
