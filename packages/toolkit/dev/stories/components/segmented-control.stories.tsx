import { segmentedControlProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
} from "@tabler/icons-react";

import {
  SegmentedControl,
  SegmentedControlItem,
  type SegmentedControlProps,
} from "../../../src/ui/base-ui/segmented-control.js";
import { propControls } from "../prop-controls.js";
import guide from "./segmented-control.docs.md?raw";

const controls = propControls(segmentedControlProps);

const meta = {
  title: "Components/Segmented Control",
  component: SegmentedControl,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, disabled: false },
  argTypes: controls.argTypes,
} satisfies Meta<typeof SegmentedControl>;

export default meta;

type Story = StoryObj<typeof meta>;

function Example(props: SegmentedControlProps) {
  return (
    <SegmentedControl aria-label="View" defaultValue="list" {...props}>
      <SegmentedControlItem value="list">List</SegmentedControlItem>
      <SegmentedControlItem value="board">Board</SegmentedControlItem>
      <SegmentedControlItem value="calendar">Calendar</SegmentedControlItem>
    </SegmentedControl>
  );
}

/** The control with the props from the controls. */
export const Playground: Story = {
  render: (args) => <Example {...args} />,
};

/** md and sm: the 24 and 20px control heights. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-4">
      {segmentedControlProps.size.values.map((size) => (
        <Example key={size} {...args} size={size} />
      ))}
    </div>
  ),
};

/** Surface raises the selected item; soft tints it in the accent. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-4">
      {segmentedControlProps.variant.values.map((variant) => (
        <div key={variant} className="flex items-center gap-3">
          <Example {...args} variant={variant} />
          <span className="text-xs text-fg-muted">{variant}</span>
        </div>
      ))}
    </div>
  ),
};

/** Icon-only items, named by their labels; a full-width track; disabled. */
export const States: Story = {
  render: (args) => (
    <div className="flex w-80 flex-col items-start gap-4">
      <SegmentedControl {...args} aria-label="Align" defaultValue="left">
        <SegmentedControlItem value="left" aria-label="Left">
          <IconAlignLeft aria-hidden />
        </SegmentedControlItem>
        <SegmentedControlItem value="center" aria-label="Center">
          <IconAlignCenter aria-hidden />
        </SegmentedControlItem>
        <SegmentedControlItem value="right" aria-label="Right">
          <IconAlignRight aria-hidden />
        </SegmentedControlItem>
      </SegmentedControl>
      <SegmentedControl
        {...args}
        aria-label="Easing"
        defaultValue="curve"
        className="w-full"
      >
        <SegmentedControlItem value="curve">Curve</SegmentedControlItem>
        <SegmentedControlItem value="spring">Spring</SegmentedControlItem>
      </SegmentedControl>
      <Example {...args} disabled />
    </div>
  ),
};
