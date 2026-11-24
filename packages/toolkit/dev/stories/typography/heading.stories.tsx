import { COLORS, headingProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Heading } from "../../../src/ui/base-ui/heading.js";
import { propControls } from "../prop-controls.js";
import guide from "./heading.docs.md?raw";

const controls = propControls(headingProps);

const SAMPLE = "Quarterly review";

const meta = {
  title: "Typography/Heading",
  component: Heading,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, children: SAMPLE },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Heading>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A heading with the props from the controls. */
export const Playground: Story = {};

/** Each text style a heading takes; title-large is the default. */
export const TextStyles: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {headingProps.textStyle.values.map((textStyle) => (
        <Heading key={textStyle} as="h2" textStyle={textStyle} truncate>
          {textStyle}: Ship the draft
        </Heading>
      ))}
    </div>
  ),
};

/** Every step of the type scale; the level stays h2 throughout. */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {headingProps.size.values.map((size) => (
        <Heading key={size} as="h2" size={size} truncate>
          {size}: {SAMPLE}
        </Heading>
      ))}
    </div>
  ),
};

/** Every weight token; semibold unless set. */
export const Weights: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {headingProps.weight.values.map((weight) => (
        <Heading key={weight} as="h2" size="5" weight={weight}>
          {weight}: {SAMPLE}
        </Heading>
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
            <Heading
              key={color}
              as="h2"
              size="4"
              color={color}
              highContrast={highContrast}
            >
              {color}
              {highContrast ? ", high contrast" : ""}
            </Heading>
          ))}
        </div>
      ))}
    </div>
  ),
};

const LONG_SAMPLE =
  "Quarterly review of the onboarding funnel and the activation experiments";

/** Truncate keeps one line; pretty and balance choose where lines break. */
export const TruncateAndWrap: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-6">
      <Heading as="h2" size="5" truncate>
        {LONG_SAMPLE}
      </Heading>
      {headingProps.wrap.values.map((wrap) => (
        <div key={wrap} className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">{wrap}</span>
          <Heading as="h2" size="5" wrap={wrap}>
            {LONG_SAMPLE}
          </Heading>
        </div>
      ))}
    </div>
  ),
};

/** Trim removes the leading above the first line and below the last. */
export const Trim: Story = {
  render: () => (
    <div className="flex items-start gap-4">
      {headingProps.trim.values.map((trim) => (
        <div key={trim} className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">{trim}</span>
          <div className="border border-line">
            <Heading as="h2" size="7" trim={trim}>
              {SAMPLE}
            </Heading>
          </div>
        </div>
      ))}
    </div>
  ),
};
