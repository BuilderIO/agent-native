import { spinnerProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../../../src/ui/base-ui/button.js";
import { Spinner } from "../../../src/ui/base-ui/spinner.js";
import { propControls } from "../prop-controls.js";

const controls = propControls(spinnerProps);

const meta = {
  title: "Components/Spinner",
  component: Spinner,
  parameters: { layout: "padded" },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Meta<typeof Spinner>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The spinner with the props from the controls. */
export const Playground: Story = {};

/** md and sm, each fitting a control of the same size: 16 and 12px. The last one is announced. */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <Spinner size="sm" />
      <Spinner size="md" />
      <Spinner size="md" label="Loading" />
    </div>
  ),
};

/** Not loading, it renders its children in its place. */
export const WithChildren: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Spinner loading>
        <Button>Ready</Button>
      </Spinner>
      <Spinner loading={false}>
        <Button>Ready</Button>
      </Spinner>
    </div>
  ),
};
