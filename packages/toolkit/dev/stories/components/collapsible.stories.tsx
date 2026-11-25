import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconChevronDown } from "@tabler/icons-react";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "../../../src/ui/base-ui/collapsible.js";
import guide from "./collapsible.docs.md?raw";

const meta = {
  title: "Components/Collapsible",
  component: Collapsible,
  parameters: { docs: { description: { component: guide } }, layout: "padded" },
  args: {
    defaultOpen: false,
    disabled: false,
    children: (
      <>
        <CollapsibleTrigger
          render={<Button variant="ghost" color="gray" size="md" />}
        >
          Recent
          <IconChevronDown className="collapsible-chevron" aria-hidden />
        </CollapsibleTrigger>
        <CollapsiblePanel>Three files changed today.</CollapsiblePanel>
      </>
    ),
  },
  argTypes: {
    defaultOpen: {
      control: "boolean",
      description: "Base UI's: whether the panel starts open.",
    },
    disabled: {
      control: "boolean",
      description: "Base UI's: whether the trigger ignores presses.",
    },
  },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Collapsible>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Behavior only, with Base UI's props: the trigger takes the look of the
 * Button it renders as, and its chevron turns as the panel opens.
 */
export const Playground: Story = {};

/** Closed and open. */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {[false, true].map((open) => (
        <Collapsible key={String(open)} defaultOpen={open}>
          <CollapsibleTrigger
            render={<Button variant="ghost" color="gray" size="md" />}
          >
            {open ? "Library" : "Recent"}
            <IconChevronDown className="collapsible-chevron" aria-hidden />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            {open
              ? "Twelve clips across four folders."
              : "Three files changed today."}
          </CollapsiblePanel>
        </Collapsible>
      ))}
    </div>
  ),
};
