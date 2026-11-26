import type { Meta, StoryObj } from "@storybook/react-vite";

import { ThemesPage } from "../../foundations/themes.js";

const meta = {
  title: "Foundations/Themes",
  parameters: { layout: "fullscreen" },
  tags: ["!autodocs", "!manifest"],
} satisfies Meta;

export default meta;

/** Every theme with its brand scale and a few components. */
export const Page: StoryObj = {
  name: "Themes",
  render: () => <ThemesPage />,
};
