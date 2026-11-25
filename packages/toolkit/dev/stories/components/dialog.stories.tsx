import {
  type DialogPopupOwnProps,
  dialogPopupProps,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, waitFor, within } from "storybook/test";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Dialog,
  DialogPopup,
  DialogBody,
  DialogMedia,
  DialogTrigger,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogMotion,
} from "../../../src/ui/base-ui/dialog.js";
import { Input } from "../../../src/ui/base-ui/input.js";
import { propControls } from "../prop-controls.js";
import guide from "./dialog.docs.md?raw";

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
  const field = React.useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3 p-4">
      <Dialog>
        <DialogTrigger render={<Button variant="surface" color="gray" />}>
          Open outer dialog
        </DialogTrigger>
        <DialogPopup>
          <DialogTitle>Outer</DialogTitle>
          <DialogDescription>Opens a second dialog on top.</DialogDescription>
          <Dialog>
            <DialogTrigger render={<Button />}>Open inner dialog</DialogTrigger>
            <DialogPopup initialFocus={field}>
              <DialogTitle>Inner</DialogTitle>
              <DialogDescription>The field takes focus.</DialogDescription>
              <Input ref={field} aria-label="Inner field" />
            </DialogPopup>
          </Dialog>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

const meta = {
  title: "Components/Dialog",
  component: DialogPopup,
  parameters: {
    docs: { description: { component: guide } },
    layout: "fullscreen",
  },
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
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body);
    const launch = canvas.getByRole("button", { name: "Open outer dialog" });
    await userEvent.click(launch);
    const outer = await page.findByRole("dialog", { name: "Outer" });
    const openInner = within(outer).getByRole("button", {
      name: "Open inner dialog",
    });
    await waitFor(() => expect(openInner).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    const inner = await page.findByRole("dialog", { name: "Inner" });
    const field = within(inner).getByRole("textbox", { name: "Inner field" });
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.tab();
    await expect(
      within(inner).getByRole("button", { name: "Close" }),
    ).toHaveFocus();
    await userEvent.tab();
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(openInner).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(launch).toHaveFocus());
  },
};

/** A media-led tutorial built entirely from Dialog parts. */
export const Tutorial: Story = {
  render: function TutorialExample(args) {
    const portal = React.useRef<HTMLDivElement>(null);
    return (
      <div ref={portal}>
        <Dialog>
          <DialogTrigger render={<Button />}>View tutorial</DialogTrigger>
          <DialogPopup
            {...args}
            container={portal}
            closeLabel="Close tutorial"
            closeVariant="solid"
          >
            <DialogMedia>
              <img
                src={
                  new URL(
                    "../../../../../templates/assets/public/library-presets/prismatic-paper-cut/kirigami.webp",
                    import.meta.url,
                  ).href
                }
                alt="Stepped shapes folded from a single sheet of paper"
                width={800}
                height={400}
              />
            </DialogMedia>
            <DialogBody>
              <DialogTitle>Build a paper study</DialogTitle>
              <DialogDescription>
                Fold a sheet into alternating peaks and valleys. Light the folds
                from one side to bring out their depth.
              </DialogDescription>
              <DialogFooter>
                <DialogClose render={<Button />}>Got it</DialogClose>
              </DialogFooter>
            </DialogBody>
          </DialogPopup>
        </Dialog>
      </div>
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "View tutorial" }),
    );
  },
};

export const ShortTutorial: Story = {
  render: Tutorial.render,
  decorators: [
    (Story) => (
      <div className="[&_.dialog-popup]:[max-block-size:16rem]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "View tutorial" });
    await userEvent.click(trigger);
    const dialog = await canvas.findByRole("dialog");
    const image = within(dialog).getByRole("img");
    const heading = within(dialog).getByRole("heading");
    await expect(dialog.scrollHeight).toBeGreaterThan(dialog.clientHeight);
    await expect(heading.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      image.getBoundingClientRect().bottom - 1,
    );
    const done = within(dialog).getByRole("button", { name: "Got it" });
    done.focus();
    await expect(done).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

/** A long project name stays readable beside the close control in a narrow popup. */
export const LongTitle: Story = {
  render: (args) => (
    <Dialog>
      <DialogTrigger render={<Button variant="surface" />}>
        View project
      </DialogTrigger>
      <DialogPopup {...args} style={{ maxInlineSize: "20rem" }}>
        <DialogHeader>
          <DialogTitle>ComponentLibraryAnnouncementPreview</DialogTitle>
          <DialogDescription>Project details</DialogDescription>
        </DialogHeader>
      </DialogPopup>
    </Dialog>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "View project" }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole(
      "dialog",
      { name: "ComponentLibraryAnnouncementPreview" },
    );
    const heading = within(dialog).getByRole("heading");
    const close = within(dialog)
      .getByRole("button", { name: "Close" })
      .getBoundingClientRect();
    const range = heading.ownerDocument.createRange();
    range.selectNodeContents(heading);
    await expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
    for (const line of range.getClientRects()) {
      const intersects =
        line.left < close.right &&
        line.right > close.left &&
        line.top < close.bottom &&
        line.bottom > close.top;
      await expect(intersects).toBe(false);
    }
  },
};

export const KeepMounted: Story = {
  render: (args) => (
    <Dialog>
      <DialogTrigger render={<Button />}>Edit name</DialogTrigger>
      <DialogPopup {...args} keepMounted aria-describedby={undefined}>
        <DialogTitle>Edit name</DialogTitle>
        <Input aria-label="Project name" />
      </DialogPopup>
    </Dialog>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: "Edit name" });
    await userEvent.click(trigger);
    const dialog = await body.findByRole("dialog", { name: "Edit name" });
    const field = within(dialog).getByRole("textbox", { name: "Project name" });
    await userEvent.type(field, "Paper studies");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog).not.toBeVisible());
    await expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await expect(await body.findByRole("dialog", { name: "Edit name" })).toBe(
      dialog,
    );
    await expect(field).toHaveValue("Paper studies");
  },
};
