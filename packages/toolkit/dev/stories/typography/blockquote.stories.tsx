import { blockquoteProps, COLORS } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Blockquote } from "../../../src/ui/base-ui/blockquote.js";
import { propControls } from "../prop-controls.js";

const controls = propControls(blockquoteProps);

const SAMPLE =
  "Ship the draft before the review, so the review is about the work and not the plan.";

const meta = {
  title: "Typography/Blockquote",
  component: Blockquote,
  parameters: { layout: "padded" },
  args: { ...controls.args, children: SAMPLE },
  argTypes: controls.argTypes,
  decorators: [
    (Story) => (
      <div className="max-w-[560px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Blockquote>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A blockquote with the props from the controls. */
export const Playground: Story = {};

/** Steps of the type scale; the rule grows with the text. */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(["1", "2", "3", "5", "7"] as const).map((size) => (
        <Blockquote key={size} size={size}>
          {SAMPLE}
        </Blockquote>
      ))}
    </div>
  ),
};

/** Each color colors the rule and the text, then in high contrast. */
export const Colors: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {[false, true].map((highContrast) =>
        COLORS.map((color) => (
          <Blockquote
            key={`${color}-${String(highContrast)}`}
            size="2"
            color={color}
            highContrast={highContrast}
          >
            {color}
            {highContrast ? ", high contrast" : ""}
          </Blockquote>
        )),
      )}
    </div>
  ),
};
