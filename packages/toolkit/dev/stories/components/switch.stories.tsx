import { COLORS, RADII, switchProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Switch } from "../../../src/ui/base-ui/switch.js";
import { propControls } from "../prop-controls.js";
import guide from "./switch.docs.md?raw";

const controls = propControls(switchProps);

const meta = {
  title: "Components/Switch",
  component: Switch,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, defaultChecked: true, disabled: false },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The switch with the props from the controls. */
export const Playground: Story = { args: { "aria-label": "Sync" } };

/** Each variant off and on in every color, then in high contrast. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {[false, true].map((highContrast) =>
        switchProps.variant.values.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex items-center gap-4"
          >
            {COLORS.map((color) => (
              <div key={color} className="flex items-center gap-1">
                <Switch
                  {...args}
                  variant={variant}
                  color={color}
                  highContrast={highContrast}
                  defaultChecked={false}
                  aria-label={`${color} off`}
                />
                <Switch
                  {...args}
                  variant={variant}
                  color={color}
                  highContrast={highContrast}
                  defaultChecked
                  aria-label={`${color} on`}
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

/** A pill by default; `radius` sets the control shape instead. */
export const Radius: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      {RADII.map((radius) => (
        <Switch
          key={radius}
          {...args}
          radius={radius}
          aria-label={`Radius ${radius}`}
        />
      ))}
    </div>
  ),
};

/** Off and on, each disabled. */
export const Disabled: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <Switch
        {...args}
        defaultChecked={false}
        disabled
        aria-label="Off, disabled"
      />
      <Switch {...args} defaultChecked disabled aria-label="On, disabled" />
    </div>
  ),
};
