import {
  COLORS,
  CONTROL_SIZES,
  toggleProps,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconBold } from "@tabler/icons-react";
import { useState } from "react";
import { expect } from "storybook/test";

import { Toggle } from "../../../src/ui/base-ui/toggle.js";
import { propControls } from "../prop-controls.js";
import guide from "./toggle.docs.md?raw";

const controls = propControls(toggleProps);

const meta = {
  title: "Components/Toggle",
  component: Toggle,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: {
    ...controls.args,
    children: <IconBold aria-hidden />,
    disabled: false,
  },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Toggle>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The toggle with the props from the controls. */
export const Playground: Story = { args: { "aria-label": "Bold" } };

/** Square with an icon at every size: 16, 20, 24 and 32px. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {CONTROL_SIZES.map((size) => (
        <Toggle
          key={size}
          {...args}
          size={size}
          defaultPressed
          aria-label={`Bold, size ${size}`}
        />
      ))}
    </div>
  ),
};

/** Each variant off and pressed in every color, then in high contrast. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {[false, true].map((highContrast) =>
        toggleProps.variant.values.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex items-center gap-4"
          >
            {COLORS.map((color) => (
              <div key={color} className="flex items-center gap-1">
                <Toggle
                  {...args}
                  variant={variant}
                  color={color}
                  highContrast={highContrast}
                  aria-label={`Bold, ${color}`}
                />
                <Toggle
                  {...args}
                  variant={variant}
                  color={color}
                  highContrast={highContrast}
                  defaultPressed
                  aria-label={`Bold, ${color}, pressed`}
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

/** A label widens it; disabled keeps showing whether it was pressed. */
export const States: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <Toggle {...args}>
        <IconBold aria-hidden /> Bold
      </Toggle>
      <Toggle {...args} disabled aria-label="Bold, disabled" />
      <Toggle
        {...args}
        disabled
        defaultPressed
        aria-label="Bold, disabled, pressed"
      />
    </div>
  ),
};

/** A formatting selection can contain both bold and regular text. */
export const MixedSelection: Story = {
  render: function Example(args) {
    const [pressed, setPressed] = useState<boolean | "mixed">("mixed");
    return (
      <Toggle
        {...args}
        aria-label="Bold"
        aria-pressed={pressed}
        pressed={pressed === true}
        onPressedChange={setPressed}
      />
    );
  },
  play: async ({ canvas, userEvent }) => {
    const toggle = canvas.getByRole("button", { name: "Bold" });
    await expect(toggle).toHaveAttribute("aria-pressed", "mixed");
    await userEvent.tab();
    await expect(toggle).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  },
};
