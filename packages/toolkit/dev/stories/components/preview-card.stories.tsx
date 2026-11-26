import {
  type PreviewCardPopupOwnProps,
  previewCardPopupProps,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import {
  PreviewCard,
  PreviewCardArrow,
  PreviewCardPopup,
  PreviewCardTrigger,
} from "../../../src/ui/base-ui/preview-card.js";
import { propControls } from "../prop-controls.js";
import guide from "./preview-card.docs.md?raw";

type PreviewCardProps = PreviewCardPopupOwnProps;

const controls = propControls(previewCardPopupProps);

function Card({
  container,
  ...props
}: PreviewCardProps & { container: HTMLElement | null }) {
  return (
    <PreviewCard defaultOpen>
      <PreviewCardTrigger
        delay={0}
        href="#profile"
        className="text-fg-brand underline"
      >
        @agent-native
      </PreviewCardTrigger>
      <PreviewCardPopup {...props} container={container}>
        <PreviewCardArrow />
        <div className="text-sm font-medium">Agent-Native</div>
        <div className="text-sm text-fg-muted">
          Apps where the agent and the UI are equal partners.
        </div>
      </PreviewCardPopup>
    </PreviewCard>
  );
}

function Parts(props: PreviewCardProps) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  return (
    <div className="flex flex-col items-start gap-6 p-10 pb-48">
      <Card {...props} container={container} />
      <div ref={setContainer} />
    </div>
  );
}

const meta = {
  title: "Components/Preview Card",
  component: PreviewCardPopup,
  parameters: {
    docs: { description: { component: guide } },
    layout: "fullscreen",
  },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Meta<PreviewCardProps>;

export default meta;

type Story = StoryObj<PreviewCardProps>;

/** The card, open, with the props from the controls. */
export const Playground: Story = {
  render: (args) => <Parts {...args} />,
};
