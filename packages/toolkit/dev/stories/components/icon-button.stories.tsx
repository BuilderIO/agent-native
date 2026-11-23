import {
  COLORS,
  CONTROL_SIZES,
  iconButtonProps,
  VARIANTS,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconStar } from "@tabler/icons-react";

import { IconButton } from "../../../src/ui/base-ui/button.js";
import { propControls } from "../prop-controls.js";
import guide from "./icon-button.docs.md?raw";

const controls = propControls(iconButtonProps);

const meta = {
  title: "Components/Icon Button",
  component: IconButton,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: {
    ...controls.args,
    "aria-label": "Star",
    children: <IconStar aria-hidden />,
  },
  argTypes: controls.argTypes,
} satisfies Meta<typeof IconButton>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The icon button with the props from the controls. */
export const Playground: Story = {};

/** Square at every size: 16, 20, 24 and 32px. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {CONTROL_SIZES.map((size) => (
        <IconButton key={size} {...args} size={size} />
      ))}
    </div>
  ),
};

/** Every variant in every color. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {COLORS.map((color) => (
        <div key={color} className="flex items-center gap-3">
          {VARIANTS.map((variant) => (
            <IconButton
              key={variant}
              {...args}
              variant={variant}
              color={color}
              aria-label={`${variant} ${color}`}
            />
          ))}
        </div>
      ))}
    </div>
  ),
};
