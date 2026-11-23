import { aspectRatioProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { AspectRatio } from "../../../src/ui/base-ui/aspect-ratio.js";
import { propControls } from "../prop-controls.js";
import guide from "./aspect-ratio.docs.md?raw";

const controls = propControls(aspectRatioProps);

function Media() {
  return (
    <div
      className="h-full w-full rounded-lg"
      style={{ background: "var(--gradient-brand)" }}
    />
  );
}

const meta = {
  title: "Components/Aspect Ratio",
  component: AspectRatio,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ratio: 16 / 9, children: <Media /> },
  argTypes: {
    ...controls.argTypes,
    ratio: {
      ...controls.argTypes.ratio,
      control: { type: "number", min: 0.1, step: 0.1 },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AspectRatio>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The box with the ratio from the controls. */
export const Playground: Story = {};

/** Common ratios at one width. */
export const Ratios: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {[
        { label: "1", ratio: 1 },
        { label: "4 / 3", ratio: 4 / 3 },
        { label: "16 / 9", ratio: 16 / 9 },
        { label: "21 / 9", ratio: 21 / 9 },
      ].map(({ label, ratio }) => (
        <div key={label} className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">{label}</span>
          <AspectRatio ratio={ratio}>
            <Media />
          </AspectRatio>
        </div>
      ))}
    </div>
  ),
};
