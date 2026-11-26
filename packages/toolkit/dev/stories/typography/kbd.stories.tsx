import { kbdProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Kbd } from "../../../src/ui/base-ui/kbd.js";
import { propControls } from "../prop-controls.js";
import guide from "./kbd.docs.md?raw";

const controls = propControls(kbdProps);

const meta = {
  title: "Typography/Kbd",
  component: Kbd,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, children: "⇧⌘P" },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Kbd>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The shortcut with the props from the controls. */
export const Playground: Story = {};

/** Surface and soft. */
export const Variants: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {kbdProps.variant.values.map((variant) => (
        <Kbd key={variant} variant={variant}>
          ⇧⌘P
        </Kbd>
      ))}
    </div>
  ),
};

/** A single key, a whole shortcut, and a Kbd that is a button. */
export const States: Story = {
  render: () => (
    <div className="flex items-center gap-3 text-sm">
      <Kbd>/</Kbd>
      <Kbd>⇧⌘Z</Kbd>
      {kbdProps.variant.values.map((variant) => (
        <Kbd
          key={variant}
          variant={variant}
          render={<button type="button" aria-label="Change shortcut" />}
        >
          ⌘S
        </Kbd>
      ))}
    </div>
  ),
};
