import { COLORS, progressProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "../../../src/ui/base-ui/progress.js";
import { propControls } from "../prop-controls.js";
import guide from "./progress.docs.md?raw";

const controls = propControls(progressProps);

const meta = {
  title: "Components/Progress",
  component: Progress,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
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

/** The fill uses the full range, including values below zero. */
export const SignedRange: Story = {
  args: {
    min: -24,
    max: 72,
    value: 0,
    locale: "en-US",
    children: (
      <>
        <ProgressLabel>Rendering frames</ProgressLabel>
        <ProgressValue />
      </>
    ),
  },
  play: async ({ canvas }) => {
    const control = canvas.getByRole("progressbar", {
      name: "Rendering frames",
    });
    const formatted = "25%";
    await expect(control).toHaveAttribute("aria-valuemin", "-24");
    await expect(control).toHaveAttribute("aria-valuemax", "72");
    await expect(control).toHaveAttribute("aria-valuenow", "0");
    await expect(control).toHaveAttribute("aria-valuetext", formatted);
    await expect(canvas.getByText(formatted)).toBeVisible();
    const track = control.querySelector(".progress-track");
    const fill = control.querySelector(".progress-indicator");
    if (!track || !fill) throw new Error("Missing progress track or fill");
    await expect(
      fill.getBoundingClientRect().width / track.getBoundingClientRect().width,
    ).toBeCloseTo(0.25, 2);
  },
};

/** The full label and value stay readable in a narrow property panel. */
export const NarrowPanel: Story = {
  render: (args) => (
    <div style={{ inlineSize: 128 }}>
      <Progress {...args} value={63}>
        <ProgressLabel>HomepageHero@3x.avif</ProgressLabel>
        <ProgressValue />
      </Progress>
    </div>
  ),
  play: async ({ canvas }) => {
    const control = canvas.getByRole("progressbar", {
      name: "HomepageHero@3x.avif",
    });
    await expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth);
    const track = control.querySelector(".progress-track");
    if (!track) throw new Error("Missing track");
    await expect(track.getBoundingClientRect().width).toBe(control.clientWidth);
    await expect(control).toHaveAttribute(
      "aria-valuetext",
      control.querySelector(".progress-value")?.textContent,
    );
  },
};
