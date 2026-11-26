import { toolbarProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconBold,
  IconItalic,
  IconLink,
  IconUnderline,
} from "@tabler/icons-react";

import { Toggle } from "../../../src/ui/base-ui/toggle.js";
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  type ToolbarProps,
  ToolbarSeparator,
} from "../../../src/ui/base-ui/toolbar.js";
import { propControls } from "../prop-controls.js";
import guide from "./toolbar.docs.md?raw";

const controls = propControls(toolbarProps);

const meta = {
  title: "Components/Toolbar",
  component: Toolbar,
  parameters: { docs: { description: { component: guide } }, layout: "padded" },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Meta<typeof Toolbar>;

export default meta;

type Story = StoryObj<typeof meta>;

function Format(props: ToolbarProps) {
  return (
    <Toolbar aria-label="Format" {...props}>
      <ToolbarGroup aria-label="Style">
        <ToolbarButton
          render={<Toggle color="gray" aria-label="Bold" defaultPressed />}
        >
          <IconBold />
        </ToolbarButton>
        <ToolbarButton render={<Toggle color="gray" aria-label="Italic" />}>
          <IconItalic />
        </ToolbarButton>
        <ToolbarButton render={<Toggle color="gray" aria-label="Underline" />}>
          <IconUnderline />
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarButton aria-label="Insert link">
        <IconLink />
      </ToolbarButton>
      <ToolbarButton disabled>Clear formatting</ToolbarButton>
    </Toolbar>
  );
}

/** The toolbar with the size from the controls. */
export const Playground: Story = {
  render: (args) => <Format {...args} />,
};

/** md and sm: every button and toggle in it takes the 24 or 20px height. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-4">
      {toolbarProps.size.values.map((size) => (
        <Format key={size} {...args} size={size} />
      ))}
    </div>
  ),
};

/** Toggles in a group, a separator, a button, a disabled button, and vertical. */
export const States: Story = {
  render: (args) => (
    <div className="flex items-start gap-8">
      <Format {...args} />
      <Format {...args} orientation="vertical" />
    </div>
  ),
};
