import { alignmentPickerProps, COLORS } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import {
  AlignmentPicker,
  type AlignmentPickerProps,
  type AlignmentValue,
} from "../../../src/ui/base-ui/alignment-picker.js";
import { propControls } from "../prop-controls.js";

const controls = propControls(alignmentPickerProps);

const meta = {
  title: "Components/Alignment Picker",
  component: AlignmentPicker,
  parameters: { layout: "padded" },
  args: {
    ...controls.args,
    "aria-label": "Alignment",
    defaultValue: { justify: "center", align: "center" },
    disabled: false,
  },
  argTypes: controls.argTypes,
} satisfies Meta<typeof AlignmentPicker>;

export default meta;

type Story = StoryObj<typeof meta>;

function Labelled({
  label,
  ...props
}: AlignmentPickerProps & { label: string }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <AlignmentPicker {...props} aria-label={label} />
      <span className="text-xs text-fg-muted">{label}</span>
    </div>
  );
}

function Live(props: AlignmentPickerProps) {
  const [value, setValue] = React.useState<AlignmentValue>({
    justify: "start",
    align: "center",
  });
  return (
    <div className="flex flex-col items-start gap-2">
      <AlignmentPicker {...props} value={value} onValueChange={setValue} />
      <code className="text-xs text-fg-muted">
        justify-content: {value.justify}; align-items: {value.align}
      </code>
    </div>
  );
}

/** The picker with the props from the controls: arrow keys move in two dimensions; double-click or Enter switches a cell to space-between and back. */
export const Playground: Story = {
  render: (args) => <Live {...args} />,
};

/** Sizes 1 to 4: matrix cells of 16, 20, 24 and 32px on a 4px gap. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-start gap-6">
      {alignmentPickerProps.size.values.map((size) => (
        <Labelled key={size} {...args} size={size} label={`Size ${size}`} />
      ))}
    </div>
  ),
};

/** Surface and soft, with the selection in each color. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      {alignmentPickerProps.variant.values.map((variant) => (
        <div key={variant} className="flex items-start gap-4">
          {COLORS.map((color) => (
            <Labelled
              key={color}
              {...args}
              variant={variant}
              color={color}
              label={`${variant} ${color}`}
            />
          ))}
        </div>
      ))}
    </div>
  ),
};

/** A row layout draws vertical bars; a column layout horizontal ones. */
export const Directions: Story = {
  render: (args) => (
    <div className="flex items-start gap-6">
      {alignmentPickerProps.direction.values.map((direction) => (
        <Labelled
          key={direction}
          {...args}
          size="2"
          direction={direction}
          defaultValue={{ justify: "start", align: "end" }}
          label={direction}
        />
      ))}
    </div>
  ),
};

/** Space-between spreads the bars across the main axis; stretch draws them full length; baseline; disabled. */
export const States: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-start gap-6">
      <Labelled
        {...args}
        size="2"
        defaultValue={{ justify: "space-between", align: "center" }}
        label="Row, space-between"
      />
      <Labelled
        {...args}
        size="2"
        direction="column"
        defaultValue={{ justify: "space-between", align: "start" }}
        label="Column, space-between"
      />
      <Labelled
        {...args}
        size="2"
        defaultValue={{ justify: "center", align: "stretch" }}
        label="Row, stretch"
      />
      <Labelled
        {...args}
        size="2"
        direction="column"
        defaultValue={{ justify: "space-between", align: "stretch" }}
        label="Space-between and stretch"
      />
      <Labelled
        {...args}
        size="2"
        defaultValue={{ justify: "start", align: "baseline" }}
        label="Baseline"
      />
      <Labelled {...args} size="2" disabled label="Disabled" />
    </div>
  ),
};
