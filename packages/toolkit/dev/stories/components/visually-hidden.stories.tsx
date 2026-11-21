import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconTrash } from "@tabler/icons-react";

import { IconButton } from "../../../src/ui/base-ui/button.js";
import { VisuallyHidden } from "../../../src/ui/base-ui/visually-hidden.js";

const meta = {
  title: "Components/Visually Hidden",
  component: VisuallyHidden,
  parameters: { layout: "padded" },
} satisfies Meta<typeof VisuallyHidden>;

export default meta;

/** A name assistive technology reads and the page doesn't show. */
export const Default: StoryObj<typeof meta> = {
  render: () => (
    <IconButton variant="soft" color="danger">
      <IconTrash aria-hidden />
      <VisuallyHidden>Delete draft</VisuallyHidden>
    </IconButton>
  ),
};
