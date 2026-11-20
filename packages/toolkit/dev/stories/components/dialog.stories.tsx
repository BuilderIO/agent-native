import {
  type DialogPopupOwnProps,
  dialogPopupProps,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogMotion,
} from "../../../src/ui/base-ui/dialog.js";
import { propControls } from "../prop-controls.js";

type DialogProps = DialogPopupOwnProps;

const controls = propControls(dialogPopupProps);

function DialogSection({
  motion = "default",
  ...props
}: DialogProps & { motion?: DialogMotion }) {
  const [box, setBox] = React.useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setBox}
      className="relative h-[320px] overflow-hidden rounded-card border border-line [transform:translateZ(0)]"
    >
      {box ? (
        <Dialog open modal={false}>
          <DialogPopup
            {...props}
            container={box}
            motion={motion}
            initialFocus={false}
            aria-describedby={undefined}
          >
            <DialogHeader>
              <DialogTitle>Rename project</DialogTitle>
              <DialogDescription>
                Everyone with access sees the new name.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm">Names can be changed again at any time.</p>
            <DialogFooter>
              <Button variant="surface" color="gray">
                Cancel
              </Button>
              <Button>Rename</Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      ) : null}
    </div>
  );
}

function NestedDialogs() {
  const [outer, setOuter] = React.useState(false);
  const [inner, setInner] = React.useState(false);
  return (
    <div className="flex items-center gap-3 p-4">
      <Button variant="surface" color="gray" onClick={() => setOuter(true)}>
        Open outer dialog
      </Button>
      <Dialog open={outer} onOpenChange={setOuter}>
        <DialogPopup>
          <DialogTitle>Outer</DialogTitle>
          <DialogDescription>Opens a second dialog on top.</DialogDescription>
          <Button onClick={() => setInner(true)}>Open inner dialog</Button>
          <Dialog open={inner} onOpenChange={setInner}>
            <DialogPopup>
              <DialogTitle>Inner</DialogTitle>
              <DialogDescription>The field takes focus.</DialogDescription>
              <input
                aria-label="Inner field"
                autoFocus
                className="h-control-md rounded-control border border-line bg-fill-field px-2"
              />
            </DialogPopup>
          </Dialog>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

const meta = {
  title: "Components/Dialog",
  parameters: { layout: "fullscreen" },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Meta<DialogProps>;

export default meta;

type Story = StoryObj<DialogProps>;

/** The dialog with the props from the controls. */
export const Playground: Story = {
  render: (args) => (
    <div className="p-4">
      <DialogSection {...args} />
    </div>
  ),
};

/** Sizes 1 to 4 step the padding, the gap and the type together. */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4 p-4">
      {dialogPopupProps.size.values.map((size) => (
        <DialogSection key={size} size={size} />
      ))}
    </div>
  ),
};

/** The default motion, then the instant one, where only the blur eases in. */
export const Motion: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4 p-4">
      <DialogSection {...args} motion="default" />
      <DialogSection {...args} motion="instant" />
    </div>
  ),
};

/** A dialog opened from another stacks above it and takes focus. */
export const Nested: Story = {
  render: () => <NestedDialogs />,
};
