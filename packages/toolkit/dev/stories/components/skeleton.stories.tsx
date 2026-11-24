import { skeletonProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Avatar, AvatarFallback } from "../../../src/ui/base-ui/avatar.js";
import { Skeleton } from "../../../src/ui/base-ui/skeleton.js";
import { propControls } from "../prop-controls.js";
import guide from "./skeleton.docs.md?raw";

const controls = propControls(skeletonProps);

const meta = {
  title: "Components/Skeleton",
  component: Skeleton,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, children: "Ada Lovelace" },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Skeleton>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Around text, with `loading` from the controls. */
export const Playground: Story = {};

/**
 * Empty, it fills its box, one line tall without a height. Around text it
 * is as wide as the words; around an element it takes that element's
 * shape.
 */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <div className="size-10">
          <Skeleton />
        </div>
        <div className="flex w-64 flex-col gap-2">
          <Skeleton />
          <div className="w-40">
            <Skeleton />
          </div>
        </div>
      </div>
      <p className="m-0 text-sm">
        <Skeleton>Ada Lovelace joined the workspace.</Skeleton>
      </p>
      <div className="flex items-center gap-3">
        <Skeleton>
          <Avatar>
            <AvatarFallback>AL</AvatarFallback>
          </Avatar>
        </Skeleton>
        <Skeleton loading={false}>
          <Avatar>
            <AvatarFallback>AL</AvatarFallback>
          </Avatar>
        </Skeleton>
      </div>
    </div>
  ),
};

export const Image: Story = {
  render: ({ loading }) => (
    <Skeleton loading={loading}>
      <img
        width={300}
        height={239}
        alt="Layered cut-paper artwork"
        src={
          new URL(
            "../../../../../templates/assets/public/library-presets/prismatic-paper-cut/kirigami.webp",
            import.meta.url,
          ).href
        }
      />
    </Skeleton>
  ),
};
