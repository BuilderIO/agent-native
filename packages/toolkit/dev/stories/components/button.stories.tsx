import {
  buttonProps,
  COLORS,
  CONTROL_SIZES,
  VARIANTS,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconBookmark, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { expect } from "storybook/test";

import { Button, IconButton } from "../../../src/ui/base-ui/button.js";
import { propControls } from "../prop-controls.js";
import guide from "./button.docs.md?raw";

const controls = propControls(buttonProps);

const meta = {
  title: "Components/Button",
  component: Button,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, children: "Save changes", disabled: false },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The button with the props from the controls. */
export const Playground: Story = {};

/** md and sm: the 24 and 20px control heights. */
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

function LoadingButtons() {
  const [loading, setLoading] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <Button onClick={() => setLoading(!loading)}>Toggle loading</Button>
      <Button loading={loading}>
        <IconBookmark aria-hidden />
        <span id="bookmark-label">Save bookmark</span>
      </Button>
      <IconButton size="sm" loading={loading} aria-label="Bookmark">
        <IconBookmark />
      </IconButton>
    </div>
  );
}
export const LoadingTransition: Story = {
  render: () => <LoadingButtons />,
  play: async ({ canvas, userEvent }) => {
    const toggle = canvas.getByRole("button", { name: "Toggle loading" });
    const buttons = ["Save bookmark", "Bookmark"].map((name) =>
      canvas.getByRole("button", { name }),
    );
    const widths = buttons.map(
      (button) => button.getBoundingClientRect().width,
    );
    const children = buttons.map((button) => button.firstElementChild);
    for (const loading of [true, false]) {
      await userEvent.click(toggle);
      for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i];
        await expect(button).toHaveAccessibleName(
          i ? "Bookmark" : "Save bookmark",
        );
        await expect(button.firstElementChild).toBe(children[i]);
        await expect(button.getBoundingClientRect().width).toBe(widths[i]);
        if (loading) {
          await expect(button).toBeDisabled();
          await expect(
            getComputedStyle(button, "::after").animationName,
          ).toMatch(/^spinner-/);
          await expect(getComputedStyle(button, "::after").width).toBe(
            i ? "12px" : "16px",
          );
        } else await expect(button).toBeEnabled();
      }
    }
  },
};
