import {
  type PopoverPopupOwnProps,
  popoverPopupProps,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, waitFor, within } from "storybook/test";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../../../src/ui/base-ui/dialog.js";
import { Input } from "../../../src/ui/base-ui/input.js";
import {
  Popover,
  PopoverPopup,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "../../../src/ui/base-ui/popover.js";
import { propControls } from "../prop-controls.js";
import guide from "./popover.docs.md?raw";

type PopoverProps = PopoverPopupOwnProps;

const controls = propControls(popoverPopupProps);

function PopoverSample({
  container,
  label = "Open popover",
  ...props
}: PopoverProps & { container?: HTMLElement | null; label?: string }) {
  const [width, setWidth] = React.useState("100%");
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
        <label className="mt-2 grid gap-1">
          Width
          <Input
            value={width}
            onChange={(event) => setWidth(event.target.value)}
          />
        </label>
      </PopoverPopup>
    </Popover>
  );
}

function CustomContainer(props: PopoverProps) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  return (
    <div className="p-4">
      <PopoverSample {...props} container={container} />
      <div ref={setContainer} />
    </div>
  );
}

function NestedInDialog(props: PopoverProps) {
  return (
    <div className="p-4">
      <Dialog>
        <DialogTrigger render={<Button variant="surface" color="gray" />}>
          Edit layer
        </DialogTrigger>
        <DialogPopup aria-describedby={undefined}>
          <DialogTitle>Edit layer</DialogTitle>
          <PopoverSample label="Dimensions" {...props} />
        </DialogPopup>
      </Dialog>
    </div>
  );
}

const meta = {
  title: "Components/Popover",
  component: PopoverPopup,
  parameters: {
    docs: { description: { component: guide } },
    layout: "fullscreen",
  },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Meta<PopoverProps>;

export default meta;

type Story = StoryObj<PopoverProps>;

/** The popover with the props from the controls. */
export const Playground: Story = {
  render: (args) => <CustomContainer {...args} />,
};

/** Opened from inside a dialog, it paints above it and keeps Escape local. */
export const InsideDialog: Story = {
  render: (args) => <NestedInDialog {...args} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body);
    const opener = canvas.getByRole("button", { name: "Edit layer" });
    await userEvent.tab();
    await expect(opener).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    const dialog = await page.findByRole("dialog", { name: "Edit layer" });
    const trigger = within(dialog).getByRole("button", { name: "Dimensions" });
    await userEvent.click(trigger);
    const width = await page.findByRole("textbox", { name: "Width" });
    await userEvent.clear(width);
    await userEvent.type(width, "320px{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(dialog).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect(
      await page.findByRole("textbox", { name: "Width" }),
    ).toHaveValue("320px");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
  },
};
