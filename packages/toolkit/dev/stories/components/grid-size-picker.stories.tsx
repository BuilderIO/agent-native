import { COLORS, gridSizePickerProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import {
  type GridSize,
  GridSizePicker,
  type GridSizePickerProps,
} from "../../../src/ui/base-ui/grid-size-picker.js";
import { propControls } from "../prop-controls.js";

const controls = propControls(gridSizePickerProps);

const meta = {
  title: "Components/Grid Size Picker",
  component: GridSizePicker,
  parameters: { layout: "padded" },
  args: {
    ...controls.args,
    defaultValue: { columns: 4, rows: "auto" },
    disabled: false,
  },
  argTypes: controls.argTypes,
} satisfies Meta<typeof GridSizePicker>;

export default meta;

type Story = StoryObj<typeof meta>;

function Live(props: GridSizePickerProps) {
  const [value, setValue] = React.useState<GridSize>({
    columns: 4,
    rows: "auto",
  });
  const [settings, setSettings] = React.useState(0);
  return (
    <div className="flex flex-col items-start gap-2">
      <GridSizePicker
        {...props}
        value={value}
        onValueChange={setValue}
        onOpenSettings={() => setSettings((count) => count + 1)}
      />
      <code className="text-xs text-fg-muted">
        grid-template-columns: repeat({value.columns}, 1fr);{" "}
        {value.rows === "auto"
          ? "grid-auto-rows: auto;"
          : `grid-template-rows: repeat(${value.rows}, 1fr);`}{" "}
        settings opened {settings}×
      </code>
    </div>
  );
}

/** The picker with the props from the controls. */
export const Playground: Story = {
  render: (args) => <Live {...args} />,
};

/** Open: the fields, the matrix to size by pointer or arrow keys, the readout. */
export const Open: Story = {
  render: (args) => <Live {...args} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "4 × Auto" }));
  },
};

/** Surface and soft in each color. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      {gridSizePickerProps.variant.values.map((variant) => (
        <div key={variant} className="flex items-start gap-3">
          {COLORS.map((color) => (
            <GridSizePicker
              key={color}
              {...args}
              variant={variant}
              color={color}
            />
          ))}
        </div>
      ))}
    </div>
  ),
};

/** The tile draws the grid: auto rows run past the bottom edge; past 12 × 8 it draws 12 × 8. */
export const States: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-start gap-3">
      <GridSizePicker {...args} defaultValue={{ columns: 1, rows: "auto" }} />
      <GridSizePicker {...args} defaultValue={{ columns: 4, rows: 4 }} />
      <GridSizePicker {...args} defaultValue={{ columns: 3, rows: 2 }} />
      <GridSizePicker {...args} defaultValue={{ columns: 12, rows: 8 }} />
      <GridSizePicker {...args} defaultValue={{ columns: 20, rows: 2 }} />
      <GridSizePicker {...args} disabled />
    </div>
  ),
};
