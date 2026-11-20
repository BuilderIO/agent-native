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

/** Sizes 1 to 4, each fitting a control of the same size: 12, 12, 16 and 20px. The last one is announced. */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <Spinner size="1" />
      <Spinner size="2" />
      <Spinner size="3" />
      <Spinner size="4" label="Loading" />
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
