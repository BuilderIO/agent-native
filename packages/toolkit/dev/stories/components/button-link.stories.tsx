import {
  buttonLinkProps,
  COLORS,
  CONTROL_SIZES,
  VARIANTS,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconArrowUpRight, IconHelp } from "@tabler/icons-react";

import {
  Button,
  ButtonLink,
  IconButtonLink,
} from "../../../src/ui/base-ui/button.js";
import { VisuallyHidden } from "../../../src/ui/base-ui/visually-hidden.js";
import { propControls } from "../prop-controls.js";
import guide from "./button-link.docs.md?raw";

const controls = propControls(buttonLinkProps);

const meta = {
  title: "Components/Button Link",
  component: ButtonLink,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, href: "#docs", children: "Read the docs" },
  argTypes: controls.argTypes,
} satisfies Meta<typeof ButtonLink>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The link with the props from the controls. */
export const Playground: Story = {};

/** md and sm, as Button's. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {CONTROL_SIZES.map((size) => (
        <ButtonLink key={size} {...args} size={size}>
          Size {size}
        </ButtonLink>
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
            <ButtonLink key={variant} {...args} variant={variant} color={color}>
              {variant}
            </ButtonLink>
          ))}
          <span className="text-xs text-fg-muted">{color}</span>
        </div>
      ))}
    </div>
  ),
};

/**
 * A link and a button side by side look the same; only the link goes
 * somewhere. A screen reader announces one as a link and the other as a
 * button.
 */
export const BesideAButton: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <ButtonLink {...args} variant="surface" color="gray">
        Open in Design
      </ButtonLink>
      <Button variant="surface" color="gray">
        Duplicate
      </Button>
    </div>
  ),
};

/** A new tab says so in the name and with an icon. */
export const NewTab: Story = {
  args: { target: "_blank", rel: "noopener noreferrer" },
  render: (args) => (
    <ButtonLink {...args}>
      Docs
      <IconArrowUpRight aria-hidden />
      <VisuallyHidden>(opens in a new tab)</VisuallyHidden>
    </ButtonLink>
  ),
};

/** The icon-only form, named by its `aria-label`. */
export const IconOnly: Story = {
  render: (args) => (
    <IconButtonLink
      href="#help"
      size={args.size}
      variant="ghost"
      color="gray"
      aria-label="Help"
    >
      <IconHelp aria-hidden />
    </IconButtonLink>
  ),
};
