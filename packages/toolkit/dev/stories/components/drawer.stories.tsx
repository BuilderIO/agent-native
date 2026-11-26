import { type DrawerOwnProps, drawerProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, waitFor, within } from "storybook/test";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Drawer,
  DrawerPopup,
  DrawerClose,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  type DrawerSide,
} from "../../../src/ui/base-ui/drawer.js";
import { Input } from "../../../src/ui/base-ui/input.js";
import { propControls } from "../prop-controls.js";
import guide from "./drawer.docs.md?raw";

type DrawerProps = DrawerOwnProps;

const controls = propControls(drawerProps);

function DrawerExample({ side = "bottom" }: { side?: DrawerSide | undefined }) {
  const [open, setOpen] = React.useState(false);
  const [folder, setFolder] = React.useState("Assets");
  const formId = React.useId();
  return (
    <Drawer side={side} open={open} onOpenChange={setOpen}>
      <DrawerTrigger render={<Button variant="surface" color="gray" />}>
        Open {side} drawer
      </DrawerTrigger>
      <DrawerPopup aria-describedby={undefined}>
        <DrawerHeader render={<header />}>
          <DrawerTitle>Rename folder</DrawerTitle>
        </DrawerHeader>
        <form
          id={formId}
          className={side === "bottom" ? "px-4" : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("name");
            if (typeof value !== "string")
              throw new Error("Missing folder name");
            setFolder(value);
            setOpen(false);
          }}
        >
          <label className="grid gap-1">
            Folder name
            <Input name="name" defaultValue={folder} required />
          </label>
        </form>
        <DrawerFooter render={<footer />}>
          <DrawerClose render={<Button variant="surface" />}>
            Cancel
          </DrawerClose>
          <Button type="submit" form={formId}>
            Save
          </Button>
        </DrawerFooter>
      </DrawerPopup>
    </Drawer>
  );
}

const meta = {
  title: "Components/Drawer",
  component: Drawer,
  parameters: {
    docs: { description: { component: guide } },
    layout: "fullscreen",
  },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Meta<DrawerProps>;

export default meta;

type Story = StoryObj<DrawerProps>;

/** The drawer on the side from the controls. */
export const Playground: Story = {
  render: (args) => (
    <div className="p-4">
      <DrawerExample side={args.side} />
    </div>
  ),
  play: async ({ canvas, canvasElement, userEvent, args }) => {
    const page = within(canvasElement.ownerDocument.body);
    const opener = canvas.getByRole("button", {
      name: `Open ${args.side ?? "bottom"} drawer`,
    });
    await userEvent.click(opener);
    const dialog = await page.findByRole("dialog", { name: "Rename folder" });
    const field = within(dialog).getByRole("textbox", { name: "Folder name" });
    await expect(dialog.querySelector("header.drawer-header")).not.toBeNull();
    await expect(dialog.querySelector("footer.drawer-footer")).not.toBeNull();
    await userEvent.clear(field);
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await expect(field).toBeInvalid();
    await expect(dialog).toBeVisible();
    await userEvent.type(field, "Components");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(opener).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    const saved = await page.findByRole("textbox", { name: "Folder name" });
    await expect(saved).toHaveValue("Components");
    await userEvent.type(saved, " draft");
    await userEvent.click(page.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await expect(
      await page.findByRole("textbox", { name: "Folder name" }),
    ).toHaveValue("Components");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
  },
};

/** A drawer for each side: side panels carry a close button, the bottom drawer a handle. */
export const Sides: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3 p-4">
      {drawerProps.side.values.map((side) => (
        <DrawerExample key={side} side={side} />
      ))}
    </div>
  ),
};
