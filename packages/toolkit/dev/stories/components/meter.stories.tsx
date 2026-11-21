import { COLORS, meterProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Meter,
  MeterLabel,
  MeterValue,
} from "../../../src/ui/base-ui/meter.js";
import { propControls } from "../prop-controls.js";

const controls = propControls(meterProps);

const meta = {
  title: "Components/Meter",
  component: Meter,
  parameters: { layout: "padded" },
  args: {
    ...controls.args,
    value: 72,
    children: (
      <>
        <MeterLabel>Storage</MeterLabel>
        <MeterValue />
      </>
    ),
  },
  argTypes: controls.argTypes,
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Meter>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The meter with the props from the controls. */
export const Playground: Story = {};

/** Both variants in every color, then in high contrast. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {[false, true].map((highContrast) =>
        meterProps.variant.values.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex flex-col gap-2"
          >
            <span className="text-xs text-fg-muted">
              {variant}
              {highContrast ? ", high contrast" : ""}
            </span>
            {COLORS.map((color) => (
              <Meter
                key={color}
                value={60}
                variant={variant}
                color={color}
                highContrast={highContrast}
                aria-label={color}
              />
            ))}
          </div>
        )),
      )}
    </div>
  ),
};

/** A level low and high, a level nearing its limit, and a squared track. */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <Meter value={24}>
        <MeterLabel>Seats</MeterLabel>
        <MeterValue />
      </Meter>
      <Meter value={92} color="warning">
        <MeterLabel>Storage</MeterLabel>
        <MeterValue />
      </Meter>
      <Meter value={60} radius="none" aria-label="Credits" />
    </div>
  ),
};
