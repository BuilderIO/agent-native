import { avatarProps, COLORS } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconUser } from "@tabler/icons-react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "../../../src/ui/base-ui/avatar.js";
import { propControls } from "../prop-controls.js";
import guide from "./avatar.docs.md?raw";

const controls = propControls(avatarProps);

const meta = {
  title: "Components/Avatar",
  component: Avatar,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: {
    ...controls.args,
    children: <AvatarFallback>AL</AvatarFallback>,
  },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Avatar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The avatar with the props from the controls, showing its initials. */
export const Playground: Story = {};

/** Both variants in every color, then in high contrast. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {[false, true].map((highContrast) =>
        avatarProps.variant.values.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex items-center gap-2"
          >
            {COLORS.map((color) => (
              <Avatar
                key={color}
                variant={variant}
                color={color}
                highContrast={highContrast}
              >
                <AvatarFallback>{color.slice(0, 2)}</AvatarFallback>
              </Avatar>
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

/**
 * An image that fails falls back to initials or an icon; `radius` squares
 * the corners.
 */
export const States: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarImage src="/missing-avatar.png" alt="Ada Lovelace" />
        <AvatarFallback>AL</AvatarFallback>
      </Avatar>
      <Avatar color="gray">
        <AvatarFallback>
          <IconUser aria-hidden />
        </AvatarFallback>
      </Avatar>
      {avatarProps.radius.values.map((radius) => (
        <Avatar key={radius} radius={radius}>
          <AvatarFallback>{radius.slice(0, 2)}</AvatarFallback>
        </Avatar>
      ))}
    </div>
  ),
};
