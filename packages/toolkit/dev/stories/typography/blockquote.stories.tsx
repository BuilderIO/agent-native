import { blockquoteProps, COLORS } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Blockquote } from "../../../src/ui/base-ui/blockquote.js";
import { propControls } from "../prop-controls.js";
import guide from "./blockquote.docs.md?raw";

const controls = propControls(blockquoteProps);

const SAMPLE =
  "Ship the draft before the review, so the review is about the work and not the plan.";

const meta = {
  title: "Typography/Blockquote",
  component: Blockquote,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
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

/** Each color colors the rule and the text, then in high contrast. */
export const Colors: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {[false, true].map((highContrast) =>
        COLORS.map((color) => (
          <Blockquote
            key={`${color}-${String(highContrast)}`}
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
