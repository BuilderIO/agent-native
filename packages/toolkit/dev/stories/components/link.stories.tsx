import { COLORS, linkProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Callout, CalloutText } from "../../../src/ui/base-ui/callout.js";
import { Link } from "../../../src/ui/base-ui/link.js";
import { Text } from "../../../src/ui/base-ui/text.js";
import { propControls } from "../prop-controls.js";
import guide from "./link.docs.md?raw";

const controls = propControls(linkProps);

const meta = {
  title: "Components/Link",
  component: Link,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, href: "#", children: "Read the release notes" },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Link>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A link with the props from the controls. */
export const Playground: Story = {};

/** Each underline mode; auto and hover underline on hover. */
export const Underline: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {linkProps.underline.values.map((underline) => (
        <Text key={underline} as="p" size="2">
          {underline}:{" "}
          <Link href="#" underline={underline}>
            Read the release notes
          </Link>
        </Text>
      ))}
    </div>
  ),
};

/** Each color, then in high contrast, where auto always underlines. */
export const Colors: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {[false, true].map((highContrast) => (
        <div key={String(highContrast)} className="flex items-center gap-4">
          {COLORS.map((color) => (
            <Link
              key={color}
              href="#"
              color={color}
              highContrast={highContrast}
            >
              {color}
            </Link>
          ))}
          <span className="text-xs text-fg-muted">
            {highContrast ? "high contrast" : "default"}
          </span>
        </div>
      ))}
    </div>
  ),
};

/** Inside an element that sets a color, an uncolored link draws in step 12, underlined. */
export const InColoredText: Story = {
  render: () => (
    <div className="flex w-140 flex-col gap-4">
      <Text as="p" size="2" color="gray">
        Usage updates every hour. <Link href="#">See how it is counted</Link>.
      </Text>
      <Callout color="warning">
        <CalloutText>
          Your trial ends in 3 days. <Link href="#">Choose a plan</Link>.
        </CalloutText>
      </Callout>
    </div>
  ),
};

/** Rendered as a button through render, for an action that reads as a link. */
export const AsButton: Story = {
  render: () => (
    <Text as="p" size="2">
      Showing 20 of 84 results.{" "}
      <Link render={<button type="button" />}>Show all</Link>
    </Text>
  ),
};
