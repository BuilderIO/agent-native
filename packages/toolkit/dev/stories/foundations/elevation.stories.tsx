import type { Meta, StoryObj } from "@storybook/react-vite";

import { ElevationPage } from "../../foundations/elevation.js";

const meta = {
  title: "Foundations/Elevation",
  parameters: { layout: "fullscreen" },
  tags: ["!autodocs", "!manifest"],
} satisfies Meta;

export default meta;

/** The shadow levels, resolved live. */
export const Page: StoryObj = {
  name: "Elevation",
  render: () => <ElevationPage />,
};
