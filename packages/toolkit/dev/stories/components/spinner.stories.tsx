import { spinnerProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../../../src/ui/base-ui/button.js";
import { Spinner } from "../../../src/ui/base-ui/spinner.js";
import { propControls } from "../prop-controls.js";
import guide from "./spinner.docs.md?raw";

const controls = propControls(spinnerProps);

const meta = {
  title: "Components/Spinner",
  component: Spinner,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Meta<typeof Spinner>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The spinner with the props from the controls. */
export const Playground: Story = {};

/** Decorative by default; a label announces it. */
export const Announced: Story = {
  render: () => <Spinner label="Loading" />,
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
