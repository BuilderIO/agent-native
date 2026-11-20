import {
  type AlertDialogPopupOwnProps,
  alertDialogPopupProps,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogPopup,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../../src/ui/base-ui/alert-dialog.js";
import { Button } from "../../../src/ui/base-ui/button.js";
import { propControls } from "../prop-controls.js";

type AlertDialogProps = AlertDialogPopupOwnProps;

const controls = propControls(alertDialogPopupProps);

function AlertDialogSection(props: AlertDialogProps) {
  const [box, setBox] = React.useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setBox}
      className="relative h-[360px] overflow-hidden rounded-card border border-line [transform:translateZ(0)]"
    >
      {box ? (
        <AlertDialog open>
          <AlertDialogPopup {...props} container={box} initialFocus={false}>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this project?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the project and everything in it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction color="danger">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      ) : null}
    </div>
  );
}

const meta = {
  title: "Components/Alert Dialog",
  parameters: { layout: "fullscreen" },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Meta<AlertDialogProps>;

export default meta;

type Story = StoryObj<AlertDialogProps>;

/** The alert dialog with the props from the controls. */
export const Playground: Story = {
  render: (args) => (
    <div className="p-4">
      <AlertDialogSection {...args} />
    </div>
  ),
};

/** Sizes 1 to 4 step the padding, the gap and the type together. */
export const Sizes: Story = {
  parameters: { a11y: { test: "todo" } },
  render: () => (
    <div className="flex flex-col gap-4 p-4">
      {alertDialogPopupProps.size.values.map((size) => (
        <AlertDialogSection key={size} size={size} />
      ))}
    </div>
  ),
};

/** Opened from a trigger: an outside press does not dismiss it. */
export const Interactive: Story = {
  render: (args) => (
    <div className="p-4">
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="surface" color="gray" />}>
          Delete project
        </AlertDialogTrigger>
        <AlertDialogPopup {...args}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              Escape and the buttons close it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction color="danger">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  ),
};
