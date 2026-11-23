import { COLORS, progressProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "../../../src/ui/base-ui/progress.js";
import { propControls } from "../prop-controls.js";

const controls = propControls(progressProps);

const meta = {
  title: "Components/Progress",
  component: Progress,
  parameters: { layout: "padded" },
  args: {
    ...controls.args,
    value: 40,
    children: (
      <>
        <ProgressLabel>Uploading</ProgressLabel>
        <ProgressValue />
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
} satisfies Meta<typeof Progress>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The progress with the props from the controls. */
export const Playground: Story = {};

/** Both variants in every color, then in high contrast. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {[false, true].map((highContrast) =>
        progressProps.variant.values.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex flex-col gap-2"
          >
            <span className="text-xs text-fg-muted">
              {variant}
              {highContrast ? ", high contrast" : ""}
            </span>
            {COLORS.map((color) => (
              <Progress
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

/**
 * Moving, complete, and indeterminate: an indeterminate bar fills over its
 * `duration`, then pulses. `radius` squares the track.
 */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <Progress value={40}>
        <ProgressLabel>Uploading</ProgressLabel>
        <ProgressValue />
      </Progress>
      <Progress value={100} color="success">
        <ProgressLabel>Uploaded</ProgressLabel>
        <ProgressValue />
      </Progress>
      <Progress value={null} duration="3s">
        <ProgressLabel>Waiting</ProgressLabel>
      </Progress>
      {progressProps.radius.values.map((radius) => (
        <Progress
          key={radius}
          value={60}
          radius={radius}
          aria-label={`Radius ${radius}`}
        />
      ))}
    </div>
  ),
};
