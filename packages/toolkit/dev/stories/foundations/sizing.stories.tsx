import type { Meta, StoryObj } from "@storybook/react-vite";

import { SizingPage } from "../../foundations/sizing.js";

const meta = {
  title: "Foundations/Sizing",
  parameters: { layout: "fullscreen" },
  tags: ["!autodocs", "!manifest"],
} satisfies Meta;

export default meta;

/** Control heights, icon sizes, padding and the size prop, resolved live. */
export const Page: StoryObj = {
  name: "Sizing",
  render: () => <SizingPage />,
};
