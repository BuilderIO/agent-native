import type { Meta, StoryObj } from "@storybook/react-vite";

import { TypographyPage } from "../../foundations/typography.js";

const meta = {
  title: "Foundations/Typography",
  parameters: { layout: "fullscreen" },
  tags: ["!autodocs", "!manifest"],
} satisfies Meta;

export default meta;

/** Font families, the type scale and weights, resolved live. */
export const Page: StoryObj = {
  name: "Typography",
  render: () => <TypographyPage />,
};
