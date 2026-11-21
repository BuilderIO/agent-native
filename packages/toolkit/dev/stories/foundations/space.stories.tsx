import type { Meta, StoryObj } from "@storybook/react-vite";

import { SpacePage } from "../../foundations/space.js";

const meta = {
  title: "Foundations/Space and density",
  parameters: { layout: "fullscreen" },
  tags: ["!autodocs", "!manifest"],
} satisfies Meta;

export default meta;

/** The space scale and what each density changes, resolved live. */
export const Page: StoryObj = {
  name: "Space and density",
  render: () => <SpacePage />,
};
