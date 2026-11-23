import { COLORS, RADII, sliderProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect } from "storybook/test";

import {
  Slider,
  SliderControl,
  SliderTrack,
  SliderThumb,
} from "../../../src/ui/base-ui/slider.js";
import { propControls } from "../prop-controls.js";
import guide from "./slider.docs.md?raw";

const controls = propControls(sliderProps);

const meta = {
  title: "Components/Slider",
  component: Slider,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: {
    ...controls.args,
    defaultValue: 40,
    thumbLabel: "Volume",
    disabled: false,
  },
  argTypes: controls.argTypes,
  decorators: [
    (Story) => (
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Slider>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The slider with the props from the controls. */
export const Playground: Story = {};

/** Each variant in every color, then in high contrast. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-6">
      {[false, true].map((highContrast) =>
        sliderProps.variant.values.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex flex-col gap-1"
          >
            <span className="text-xs text-fg-muted">
              {variant}
              {highContrast ? ", high contrast" : ""}
            </span>
            {COLORS.map((color) => (
              <Slider
                key={color}
                {...args}
                variant={variant}
                color={color}
                highContrast={highContrast}
                thumbLabel={color}
              />
            ))}
          </div>
        )),
      )}
    </div>
  ),
};

/** A pill by default; `radius` sets the control shape instead. */
export const Radius: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      {RADII.map((radius) => (
        <Slider
          key={radius}
          {...args}
          radius={radius}
          thumbLabel={`Radius ${radius}`}
        />
      ))}
    </div>
  ),
};

/** A range, a disabled slider, and a vertical one. */
export const States: Story = {
  render: (args) => (
    <div className="flex gap-12">
      <div className="flex w-64 flex-col gap-6">
        <Slider
          {...args}
          defaultValue={[20, 70]}
          thumbLabel={(index) => (index === 0 ? "From" : "To")}
        />
        <Slider {...args} defaultValue={60} thumbLabel="Disabled" disabled />
      </div>
      <div className="h-40">
        <Slider
          {...args}
          defaultValue={30}
          orientation="vertical"
          thumbLabel="Level"
        />
      </div>
    </div>
  ),
};

const stopColors = ["var(--info-9)", "var(--brand-9)", "var(--warning-9)"];
const stopLabels = ["Cool stop", "Accent stop", "Warm stop"];

function GradientStops() {
  const [positions, setPositions] = useState<readonly number[]>([10, 50, 90]);
  const gradient =
    "linear-gradient(to right, " +
    stopColors.map((color, i) => color + " " + positions[i] + "%").join(", ") +
    ")";
  return (
    <div className="grid gap-3">
      <div
        role="img"
        aria-label="Three-stop gradient preview"
        className="aspect-[3/1] rounded-card"
        style={{ backgroundImage: gradient }}
      />
      <Slider
        value={positions}
        onValueChange={setPositions}
        thumbCollisionBehavior="none"
        minStepsBetweenValues={1}
        thumbAlignment="edge"
      >
        <SliderControl>
          <SliderTrack style={{ backgroundImage: gradient }}>
            {stopColors.map((color, i) => (
              <SliderThumb
                key={color}
                index={i}
                aria-label={stopLabels[i]}
                getAriaValueText={(value) => value + " percent"}
                style={{ backgroundColor: color }}
              />
            ))}
          </SliderTrack>
        </SliderControl>
      </Slider>
    </div>
  );
}

export const Gradient: Story = {
  render: () => <GradientStops />,
  play: async ({ canvas, userEvent }) => {
    const middle = canvas.getByRole("slider", { name: "Accent stop" });
    middle.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(middle).toHaveAttribute("aria-valuenow", "51");
    await expect(
      canvas.getByRole("slider", { name: "Cool stop" }),
    ).toHaveAttribute("aria-valuenow", "10");
  },
};
