import { COLORS, meterProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import {
  Meter,
  MeterLabel,
  MeterValue,
} from "../../../src/ui/base-ui/meter.js";
import { propControls } from "../prop-controls.js";
import guide from "./meter.docs.md?raw";

const controls = propControls(meterProps);

const meta = {
  title: "Components/Meter",
  component: Meter,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
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

/** The fill uses the full range, including values below zero. */
export const SignedRange: Story = {
  args: {
    min: -180,
    max: 180,
    value: -45,
    locale: "en-US",
    format: { style: "unit", unit: "degree" },
    children: (
      <>
        <MeterLabel>Rotation</MeterLabel>
        <MeterValue />
      </>
    ),
  },
  play: async ({ canvas }) => {
    const control = canvas.getByRole("meter", { name: "Rotation" });
    const formatted = new Intl.NumberFormat("en-US", {
      style: "unit",
      unit: "degree",
    }).format(-45);
    await expect(control).toHaveAttribute("aria-valuemin", "-180");
    await expect(control).toHaveAttribute("aria-valuemax", "180");
    await expect(control).toHaveAttribute("aria-valuenow", "-45");
    await expect(control).toHaveAttribute("aria-valuetext", formatted);
    await expect(canvas.getByText(formatted)).toBeVisible();
    const track = control.querySelector(".meter-track");
    const fill = control.querySelector(".meter-indicator");
    if (!track || !fill) throw new Error("Missing meter track or fill");
    await expect(
      fill.getBoundingClientRect().width / track.getBoundingClientRect().width,
    ).toBeCloseTo(0.375, 2);
  },
};

/** The full label and value stay readable in a narrow property panel. */
export const NarrowPanel: Story = {
  render: (args) => (
    <div style={{ inlineSize: 128 }}>
      <Meter
        {...args}
        max={2048}
        value={1536}
        locale="de-DE"
        format={{ style: "unit", unit: "megabyte", unitDisplay: "long" }}
      >
        <MeterLabel>ComponentLibraryStorage</MeterLabel>
        <MeterValue />
      </Meter>
    </div>
  ),
  play: async ({ canvas }) => {
    const control = canvas.getByRole("meter", {
      name: "ComponentLibraryStorage",
    });
    await expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth);
    const track = control.querySelector(".meter-track");
    if (!track) throw new Error("Missing track");
    await expect(track.getBoundingClientRect().width).toBe(control.clientWidth);
    await expect(control).toHaveAttribute(
      "aria-valuetext",
      control.querySelector(".meter-value")?.textContent,
    );
  },
};
