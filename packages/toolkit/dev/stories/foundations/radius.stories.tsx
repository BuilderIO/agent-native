import type { Meta, StoryObj } from "@storybook/react-vite";

import { RadiusPage } from "../../foundations/radius.js";

const meta = {
  title: "Foundations/Radius and shape",
  parameters: { layout: "fullscreen" },
  tags: ["!autodocs", "!manifest"],
} satisfies Meta;

export default meta;

/** Radius steps, shape roles, presets and corners, resolved live. */
export const Page: StoryObj = {
  name: "Radius and shape",
  render: () => <RadiusPage />,
};
