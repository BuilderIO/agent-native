import type { Meta, StoryObj } from "@storybook/react-vite";

import { MotionPage } from "../../foundations/motion.js";

const meta = {
  title: "Foundations/Motion",
  parameters: { layout: "fullscreen" },
  tags: ["!autodocs", "!manifest"],
} satisfies Meta;

export default meta;

/** Durations and easings with a live demo. */
export const Page: StoryObj = {
  name: "Motion",
  render: () => <MotionPage />,
};
