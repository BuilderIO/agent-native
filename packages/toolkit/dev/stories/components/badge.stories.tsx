import { badgeProps, COLORS } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "../../../src/ui/base-ui/badge.js";
import { propControls } from "../prop-controls.js";
import guide from "./badge.docs.md?raw";

const controls = propControls(badgeProps);

const meta = {
  title: "Components/Badge",
  component: Badge,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, children: "Beta" },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The badge with the props from the controls. */
export const Playground: Story = {};

const VARIANTS = badgeProps.variant.values;

/** Every variant in every color, then in high contrast. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {[false, true].map((highContrast) =>
        VARIANTS.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex items-center gap-2"
          >
            {COLORS.map((color) => (
              <Badge
                key={color}
                variant={variant}
                color={color}
                highContrast={highContrast}
              >
                {color}
              </Badge>
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

/** A dot keeps its label for assistive technology. */
export const Dot: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {COLORS.map((color) => (
        <Badge key={color} color={color} dot>
          {color}
        </Badge>
      ))}
    </div>
  ),
};
