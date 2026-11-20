import {
  COLORS,
  type MenuContentOwnProps,
  menuContentProps,
  propAttributes,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconCopy,
  IconDownload,
  IconPencil,
  IconShare,
  IconTrash,
} from "@tabler/icons-react";
import * as React from "react";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../src/ui/base-ui/menu.js";
import { propControls } from "../prop-controls.js";

type MenuProps = MenuContentOwnProps;

const controls = propControls(menuContentProps);

const trigger = <Button variant="surface" color="gray" />;

function MenuSample({ pinned, ...props }: MenuProps & { pinned: boolean }) {
  const [checked, setChecked] = React.useState(true);
  const [sort, setSort] = React.useState("name");
  const root = pinned ? { open: true, modal: false } : {};
  const sub = pinned ? { open: true } : {};

  return (
    <DropdownMenu {...root}>
      <DropdownMenuTrigger render={trigger}>Open menu</DropdownMenuTrigger>
      <DropdownMenuContent {...props} align="start" className="w-56">
        <DropdownMenuLabel>Document</DropdownMenuLabel>
        <DropdownMenuItem>Rename</DropdownMenuItem>
        <DropdownMenuItem
          leading={<IconCopy />}
          trailing={<DropdownMenuShortcut>⌘D</DropdownMenuShortcut>}
        >
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem disabled leading={<IconPencil />}>
          Locked
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={checked}
          onCheckedChange={setChecked}
          closeOnClick={false}
        >
          Show grid
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={false} closeOnClick={false}>
          Snap to grid
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
          <DropdownMenuRadioItem value="name" closeOnClick={false}>
            Name
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="date" closeOnClick={false}>
            Date
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="size"
            indicator="check"
            closeOnClick={false}
          >
            Size
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub {...sub}>
          <DropdownMenuSubTrigger leading={<IconDownload />}>
            Export
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>PDF</DropdownMenuItem>
            <DropdownMenuItem>PNG</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem color="danger" leading={<IconTrash />}>
          Move to trash
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SomeIconsSample() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger render={trigger}>Open menu</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Share</DropdownMenuLabel>
          <DropdownMenuItem
            leading={<IconShare />}
            trailing={<DropdownMenuShortcut>⌘⇧S</DropdownMenuShortcut>}
          >
            Share link
          </DropdownMenuItem>
          <DropdownMenuItem>Copy link</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Manage</DropdownMenuLabel>
          <DropdownMenuItem leading={<IconPencil />}>Rename</DropdownMenuItem>
          <DropdownMenuItem>Archive</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Move</DropdownMenuItem>
              <DropdownMenuItem>History</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem color="danger" leading={<IconTrash />}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TextOnlySample() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger render={trigger}>Open menu</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Document</DropdownMenuLabel>
        <DropdownMenuItem
          trailing={<DropdownMenuShortcut>⌘R</DropdownMenuShortcut>}
        >
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem>Archive</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem color="danger">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HighlightSample(props: MenuProps) {
  return (
    <div
      className="menu-popup w-40"
      {...propAttributes(menuContentProps, props)}
    >
      <div className="menu-item">Rename</div>
      <div className="menu-item" data-highlighted="">
        Duplicate
        <span className="menu-item-trailing">
          <span className="menu-shortcut">⌘D</span>
        </span>
      </div>
      <div className="menu-item" data-color="danger">
        Delete
      </div>
      <div className="menu-item" data-color="danger" data-highlighted="">
        Delete forever
      </div>
    </div>
  );
}

const meta = {
  title: "Components/Menu",
  component: DropdownMenu,
  parameters: { layout: "fullscreen" },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Omit<Meta<MenuProps>, "component"> & {
  component: typeof DropdownMenu;
};

export default meta;

type Story = StoryObj<MenuProps>;

/** The menu with the props from the controls, open with its submenu. */
export const Playground: Story = {
  render: (args) => (
    <div className="h-[560px] p-8">
      <MenuSample pinned {...args} />
    </div>
  ),
};

/** Sizes 2 and 3: 20 and 24px rows. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex gap-6 p-8">
      {menuContentProps.size.values.map((size) => (
        <HighlightSample key={size} {...args} size={size} />
      ))}
    </div>
  ),
};

/** The highlighted row in each variant and color, then in high contrast. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-8">
      {[false, true].map((highContrast) =>
        menuContentProps.variant.values.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex flex-wrap items-start gap-4"
          >
            {COLORS.map((color) => (
              <HighlightSample
                key={color}
                variant={variant}
                color={color}
                highContrast={highContrast}
              />
            ))}
            <span className="text-xs text-fg-muted">
              {variant}
              {highContrast ? ", high contrast" : ""}
            </span>
          </div>
        )),
      )}
    </div>
  ),
};

/** Every row kind, open, with its submenu: disabled, checks, radios, danger. */
export const States: Story = {
  render: () => (
    <div className="h-[560px] p-8">
      <MenuSample pinned />
    </div>
  ),
};

/** Icons on some rows: the menu reserves the column for the rest. */
export const SomeIcons: Story = {
  render: () => (
    <div className="h-[400px] p-8">
      <SomeIconsSample />
    </div>
  ),
};

/** No icon, check or dot anywhere: no leading column is reserved. */
export const TextOnly: Story = {
  render: () => (
    <div className="h-[280px] p-8">
      <TextOnlySample />
    </div>
  ),
};

/** The menu as a user meets it: closed until the trigger is pressed. */
export const Interactive: Story = {
  render: (args) => (
    <div className="p-8">
      <MenuSample pinned={false} {...args} />
    </div>
  ),
};
