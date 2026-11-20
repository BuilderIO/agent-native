import { strongProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Strong } from "../../../src/ui/base-ui/strong.js";
import { Text } from "../../../src/ui/base-ui/text.js";
import { propControls } from "../prop-controls.js";

const controls = propControls(strongProps);

const meta = {
  title: "Components/Strong",
  component: Strong,
  parameters: { layout: "padded" },
  args: { ...controls.args, children: "before the review" },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Strong>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Strong with the props from the controls. */
export const Playground: Story = {};

/** In running text, at a few steps of the type scale. */
export const InText: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {(["2", "3", "5"] as const).map((size) => (
        <Text key={size} as="p" size={size}>
          Ship the draft <Strong>before</Strong> the review.
        </Text>
      ))}
    </div>
  ),
};

/** Truncated to one line inside a narrow block. */
export const Truncate: Story = {
  render: () => (
    <Text as="p" size="2" className="flex w-48">
      <Strong truncate>
        ship the draft before the review, then send the summary
      </Strong>
    </Text>
  ),
};
