import { COLORS, textComponentProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Text } from "../../../src/ui/base-ui/text.js";
import { propControls } from "../prop-controls.js";
import guide from "./text.docs.md?raw";

const controls = propControls(textComponentProps);

const SAMPLE = "Ship the draft before the review";
const LONG_SAMPLE =
  "Ship the draft before the review, then send the summary to everyone who joined the call and file the follow-ups in the tracker.";

const meta = {
  title: "Typography/Text",
  component: Text,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, children: SAMPLE },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Text>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Text with the props from the controls. */
export const Playground: Story = {};

/** Each text style, set by its job: body for UI text, label for controls. */
export const TextStyles: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {textComponentProps.textStyle.values.map((textStyle) => (
        <Text key={textStyle} as="div" textStyle={textStyle} truncate>
          {textStyle}: {SAMPLE}
        </Text>
      ))}
    </div>
  ),
};

/** Every step of the type scale, 10 to 60px. */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {textComponentProps.size.values.map((size) => (
        <Text key={size} as="div" size={size} truncate>
          {size}: {SAMPLE}
        </Text>
      ))}
    </div>
  ),
};

/** Every weight token. */
export const Weights: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {textComponentProps.weight.values.map((weight) => (
        <Text key={weight} as="div" size="4" weight={weight}>
          {weight}: {SAMPLE}
        </Text>
      ))}
    </div>
  ),
};

/** Each color in the scale's text step, then in high contrast. */
export const Colors: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {[false, true].map((highContrast) => (
        <div key={String(highContrast)} className="flex flex-col gap-1">
          {COLORS.map((color) => (
            <Text
              key={color}
              as="div"
              size="3"
              color={color}
              highContrast={highContrast}
            >
              {color}
              {highContrast ? ", high contrast" : ""}: {SAMPLE}
            </Text>
          ))}
        </div>
      ))}
    </div>
  ),
};

/** Truncate keeps one line; pretty and balance choose where lines break. */
export const TruncateAndWrap: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-6">
      <Text as="p" size="2" truncate>
        {LONG_SAMPLE}
      </Text>
      {textComponentProps.wrap.values.map((wrap) => (
        <div key={wrap} className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">{wrap}</span>
          <Text as="p" size="3" wrap={wrap}>
            {LONG_SAMPLE}
          </Text>
        </div>
      ))}
    </div>
  ),
};

/** Trim removes the leading above the first line and below the last. */
export const Trim: Story = {
  render: () => (
    <div className="flex items-start gap-4">
      {textComponentProps.trim.values.map((trim) => (
        <div key={trim} className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">{trim}</span>
          <div className="w-48 border border-line">
            <Text as="p" size="4" trim={trim}>
              {SAMPLE}
            </Text>
          </div>
        </div>
      ))}
    </div>
  ),
};

/** Alignment within its block. */
export const Align: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-2">
      {textComponentProps.align.values.map((align) => (
        <Text key={align} as="p" size="2" align={align}>
          {align}
        </Text>
      ))}
    </div>
  ),
};
