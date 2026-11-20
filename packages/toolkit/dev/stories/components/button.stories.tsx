import {
  buttonProps,
  COLORS,
  CONTROL_SIZES,
  VARIANTS,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconBookmark, IconPlus, IconTrash } from "@tabler/icons-react";

import { Button } from "../../../src/ui/base-ui/button.js";
import { propControls } from "../prop-controls.js";

const controls = propControls(buttonProps);

const meta = {
  title: "Components/Button",
  component: Button,
  parameters: { layout: "padded" },
  args: { ...controls.args, children: "Save changes", disabled: false },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The button with the props from the controls. */
export const Playground: Story = {};

/** Sizes 1 to 4: the 16, 20, 24 and 32px control heights. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {CONTROL_SIZES.map((size) => (
        <Button key={size} {...args} size={size}>
          Size {size}
        </Button>
      ))}
    </div>
  ),
};

/** Every variant in every color, then in high contrast. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {[false, true].map((highContrast) =>
        COLORS.map((color) => (
          <div
            key={`${color}-${String(highContrast)}`}
            className="flex items-center gap-3"
          >
            {VARIANTS.map((variant) => (
              <Button
                key={variant}
                {...args}
                variant={variant}
                color={color}
                highContrast={highContrast}
              >
                {variant}
              </Button>
            ))}
            <span className="text-xs text-fg-muted">
              {color}
              {highContrast ? ", high contrast" : ""}
            </span>
          </div>
        )),
      )}
    </div>
  ),
};

/** Icons sit in the children, beside the label. */
export const WithIcons: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <Button {...args}>
        <IconPlus aria-hidden /> New design
      </Button>
      <Button {...args} variant="soft" color="gray">
        <IconBookmark aria-hidden /> Save
      </Button>
      <Button {...args} variant="outline" color="danger">
        <IconTrash aria-hidden /> Delete
      </Button>
    </div>
  ),
};

/** Loading keeps the label for assistive technology and the button's width. */
export const Loading: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {CONTROL_SIZES.map((size) => (
        <Button key={size} {...args} size={size} loading>
          Saving
        </Button>
      ))}
    </div>
  ),
};

/** Disabled buttons in each variant. */
export const Disabled: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {VARIANTS.map((variant) => (
        <Button key={variant} {...args} variant={variant} disabled>
          {variant}
        </Button>
      ))}
    </div>
  ),
};
