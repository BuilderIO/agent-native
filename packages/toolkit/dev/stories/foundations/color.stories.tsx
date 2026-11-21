import type { Meta, StoryObj } from "@storybook/react-vite";

import { ColorPage } from "../../foundations/color.js";

const meta = {
  title: "Foundations/Color",
  parameters: { layout: "fullscreen" },
  tags: ["!autodocs", "!manifest"],
} satisfies Meta;

export default meta;

/** Scales, readable steps, semantic roles and the color prop, resolved live. */
export const Page: StoryObj = {
  name: "Color",
  render: () => <ColorPage />,
};
