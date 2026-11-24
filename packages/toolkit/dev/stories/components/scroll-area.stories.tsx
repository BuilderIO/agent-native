import { scrollAreaProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { ScrollArea } from "../../../src/ui/base-ui/scroll-area.js";
import { propControls } from "../prop-controls.js";
import guide from "./scroll-area.docs.md?raw";

const controls = propControls(scrollAreaProps);

const ROWS = Array.from({ length: 20 }, (_, index) => `Row ${index + 1}`);

const rows = (
  <div className="flex w-80 flex-col gap-2 p-3">
    {ROWS.map((row) => (
      <span key={row}>{row}, wider than its box when scrolled sideways</span>
    ))}
  </div>
);

const meta = {
  title: "Components/Scroll Area",
  component: ScrollArea,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, children: rows },
  argTypes: controls.argTypes,
  decorators: [
    (Story) => (
      <div className="flex h-40 w-48">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ScrollArea>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Content taller and wider than its box, with the props from the controls. */
export const Playground: Story = {};

/** Each choice of scrollbars. */
export const Scrollbars: Story = {
  decorators: [],
  render: () => (
    <div className="flex gap-4">
      {scrollAreaProps.scrollbars.values.map((scrollbars) => (
        <div key={scrollbars} className="flex h-40 w-48">
          <ScrollArea scrollbars={scrollbars}>{rows}</ScrollArea>
        </div>
      ))}
    </div>
  ),
};
