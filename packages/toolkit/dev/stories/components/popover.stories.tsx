import {
  type PopoverPopupOwnProps,
  popoverPopupProps,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogTitle,
} from "../../../src/ui/base-ui/dialog.js";
import {
  Popover,
  PopoverPopup,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "../../../src/ui/base-ui/popover.js";
import { propControls } from "../prop-controls.js";

type PopoverProps = PopoverPopupOwnProps;

const controls = propControls(popoverPopupProps);

function PopoverSample({
  container,
  label = "Open popover",
  ...props
}: PopoverProps & { container?: HTMLElement | null; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="surface" color="gray" />}>
        {label}
      </PopoverTrigger>
      <PopoverPopup {...props} container={container}>
        <PopoverTitle>Dimensions</PopoverTitle>
        <PopoverDescription>
          Set the dimensions for the layer.
        </PopoverDescription>
        <input
          aria-label="Width"
          defaultValue="100%"
          className="mt-2 h-control-md w-full rounded-control border border-line bg-fill-field px-2"
        />
      </PopoverPopup>
    </Popover>
  );
}

function Parts({ sizes }: { sizes: readonly PopoverProps[] }) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  return (
    <div className="flex flex-col items-start gap-6 p-4">
      <div className="flex items-center gap-3">
        {sizes.map((props) => (
          <PopoverSample
            key="default"
            {...props}
            label="Open popover"
            container={container}
          />
        ))}
      </div>
      <div ref={setContainer} />
    </div>
  );
}

function NestedInDialog() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex items-center gap-3 p-4">
      <Button variant="surface" color="gray" onClick={() => setOpen(true)}>
        Open dialog
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogTitle>Edit layer</DialogTitle>
          <DialogDescription>
            The popover opens above this dialog.
          </DialogDescription>
          <PopoverSample />
        </DialogPopup>
      </Dialog>
    </div>
  );
}

const meta = {
  title: "Components/Popover",
  parameters: { layout: "fullscreen" },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Meta<PopoverProps>;

export default meta;

type Story = StoryObj<PopoverProps>;

/** The popover with the props from the controls. */
export const Playground: Story = {
  render: (args) => <Parts sizes={[args]} />,
};

/** Opened from inside a dialog, it paints above it and keeps Escape local. */
export const InsideDialog: Story = {
  render: () => <NestedInDialog />,
};
