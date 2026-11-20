import { quoteProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Quote } from "../../../src/ui/base-ui/quote.js";
import { Text } from "../../../src/ui/base-ui/text.js";
import { propControls } from "../prop-controls.js";

const controls = propControls(quoteProps);

const meta = {
  title: "Components/Quote",
  component: Quote,
  parameters: { layout: "padded" },
  args: { ...controls.args, children: "before the review" },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Quote>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Quote with the props from the controls. */
export const Playground: Story = {};

/** In running text, at a few steps of the type scale. */
export const InText: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {(["2", "3", "5"] as const).map((size) => (
        <Text key={size} as="p" size={size}>
          She said <Quote>ship the draft before the review</Quote> and left.
        </Text>
      ))}
    </div>
  ),
};

/** Truncated to one line inside a narrow block. */
export const Truncate: Story = {
  render: () => (
    <Text as="p" size="2" className="flex w-48">
      <Quote truncate>
        ship the draft before the review, then send the summary
      </Quote>
    </Text>
  ),
};
