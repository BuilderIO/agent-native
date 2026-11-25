import { COLORS, separatorProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Separator } from "../../../src/ui/base-ui/separator.js";
import { propControls } from "../prop-controls.js";
import guide from "./separator.docs.md?raw";

const controls = propControls(separatorProps);

const meta = {
  title: "Components/Separator",
  component: Separator,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: controls.args,
  argTypes: controls.argTypes,
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Separator>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The separator with the props from the controls. */
export const Playground: Story = {};

/** Every color; gray is the default. */
export const Colors: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {COLORS.map((color) => (
        <div key={color} className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">{color}</span>
          <Separator color={color} />
        </div>
      ))}
    </div>
  ),
};

/** Horizontal between blocks, vertical between inline items. */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <span>Profile</span>
      <Separator />
      <span>Security</span>
      <div className="flex h-5 items-center gap-3">
        <span>Docs</span>
        <Separator orientation="vertical" />
        <span>Changelog</span>
        <Separator orientation="vertical" />
        <span>Status</span>
      </div>
    </div>
  ),
};
