import { cardProps, RADII } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "../../../src/ui/base-ui/badge.js";
import { Card } from "../../../src/ui/base-ui/card.js";
import { Inset } from "../../../src/ui/base-ui/inset.js";
import { propControls } from "../prop-controls.js";
import guide from "./card.docs.md?raw";

const controls = propControls(cardProps);

function Summary({ title = "Nightly sync" }: { title?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-fg-muted">
        Ran 2 hours ago, 4,210 tokens
      </span>
    </div>
  );
}

const meta = {
  title: "Components/Card",
  component: Card,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, children: <Summary /> },
  argTypes: controls.argTypes,
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The card with the props from the controls. */
export const Playground: Story = {};

/**
 * Surface on the raised surface with a hairline; ghost with no frame, its
 * content lined up with the text around it.
 */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {cardProps.variant.values.map((variant) => (
        <div key={variant} className="flex flex-col gap-2">
          <span className="text-xs text-fg-muted">{variant}</span>
          <Card variant={variant}>
            <Summary />
          </Card>
        </div>
      ))}
    </div>
  ),
};

/**
 * A card that is a link or a button takes hover, pressed and focus
 * states (Tab to it); a plain card takes none. Each variant once more as a
 * link.
 */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <Card>
        <Summary title="Static" />
      </Card>
      <Card render={<a href="#run" />}>
        <Summary title="Link" />
      </Card>
      <Card render={<button type="button" />}>
        <Summary title="Button" />
      </Card>
      <Card variant="ghost" render={<a href="#run" />}>
        <Summary title="Ghost link" />
      </Card>
    </div>
  ),
};

/** Media in an Inset runs to the card's edge and takes its corners. */
export const WithInset: Story = {
  render: () => (
    <Card>
      <div className="flex flex-col gap-3">
        <Inset side="top">
          <div
            className="h-28"
            style={{ background: "var(--gradient-brand)" }}
          />
        </Inset>
        <div className="flex items-center justify-between">
          <Summary title="Weekly report" />
          <Badge color="success">Done</Badge>
        </div>
      </div>
    </Card>
  ),
};

/** The theme's radius presets reach the card's corners. */
export const Radius: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {RADII.map((radius) => (
        <div key={radius} data-radius={radius}>
          <Card>
            <Summary title={radius} />
          </Card>
        </div>
      ))}
    </div>
  ),
};
