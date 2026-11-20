import {
  COLORS,
  type MenuPopupOwnProps,
  menuPopupProps,
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
  Menu,
  MenuCheckboxItem,
  MenuPopup,
  MenuGroup,
  MenuItem,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSubmenuRoot,
  MenuSubmenuPopup,
  MenuSubmenuTrigger,
  MenuTrigger,
} from "../../../src/ui/base-ui/menu.js";
import { propControls } from "../prop-controls.js";

type MenuProps = MenuPopupOwnProps;

const controls = propControls(menuPopupProps);

const trigger = <Button variant="surface" color="gray" />;

function MenuSample({ pinned, ...props }: MenuProps & { pinned: boolean }) {
  const [checked, setChecked] = React.useState(true);
  const [sort, setSort] = React.useState("name");
  const root = pinned ? { open: true, modal: false } : {};
  const sub = pinned ? { open: true } : {};

  return (
    <Menu {...root}>
      <MenuTrigger render={trigger}>Open menu</MenuTrigger>
      <MenuPopup {...props} align="start" className="w-56">
        <MenuGroupLabel>Document</MenuGroupLabel>
        <MenuItem>Rename</MenuItem>
        <MenuItem
          leading={<IconCopy />}
          trailing={<MenuShortcut>⌘D</MenuShortcut>}
        >
          Duplicate
        </MenuItem>
        <MenuItem disabled leading={<IconPencil />}>
          Locked
        </MenuItem>
        <MenuSeparator />
        <MenuCheckboxItem
          checked={checked}
          onCheckedChange={setChecked}
          closeOnClick={false}
        >
          Show grid
        </MenuCheckboxItem>
        <MenuCheckboxItem checked={false} closeOnClick={false}>
          Snap to grid
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuRadioGroup value={sort} onValueChange={setSort}>
          <MenuRadioItem value="name" closeOnClick={false}>
            Name
          </MenuRadioItem>
          <MenuRadioItem value="date" closeOnClick={false}>
            Date
          </MenuRadioItem>
          <MenuRadioItem value="size" indicator="check" closeOnClick={false}>
            Size
          </MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuSubmenuRoot {...sub}>
          <MenuSubmenuTrigger leading={<IconDownload />}>
            Export
          </MenuSubmenuTrigger>
          <MenuSubmenuPopup>
            <MenuItem>PDF</MenuItem>
            <MenuItem>PNG</MenuItem>
          </MenuSubmenuPopup>
        </MenuSubmenuRoot>
        <MenuItem color="danger" leading={<IconTrash />}>
          Move to trash
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function SomeIconsSample() {
  return (
    <Menu open modal={false}>
      <MenuTrigger render={trigger}>Open menu</MenuTrigger>
      <MenuPopup align="start" className="w-56">
        <MenuGroup>
          <MenuGroupLabel>Share</MenuGroupLabel>
          <MenuItem
            leading={<IconShare />}
            trailing={<MenuShortcut>⌘⇧S</MenuShortcut>}
          >
            Share link
          </MenuItem>
          <MenuItem>Copy link</MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Manage</MenuGroupLabel>
          <MenuItem leading={<IconPencil />}>Rename</MenuItem>
          <MenuItem>Archive</MenuItem>
          <MenuSubmenuRoot>
            <MenuSubmenuTrigger>More</MenuSubmenuTrigger>
            <MenuSubmenuPopup>
              <MenuItem>Move</MenuItem>
              <MenuItem>History</MenuItem>
            </MenuSubmenuPopup>
          </MenuSubmenuRoot>
          <MenuItem color="danger" leading={<IconTrash />}>
            Delete
          </MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function TextOnlySample() {
  return (
    <Menu open modal={false}>
      <MenuTrigger render={trigger}>Open menu</MenuTrigger>
      <MenuPopup align="start" className="w-56">
        <MenuGroupLabel>Document</MenuGroupLabel>
        <MenuItem trailing={<MenuShortcut>⌘R</MenuShortcut>}>Rename</MenuItem>
        <MenuItem>Archive</MenuItem>
        <MenuSeparator />
        <MenuItem color="danger">Delete</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function HighlightSample(props: MenuProps) {
  return (
    <div className="menu-popup w-40" {...propAttributes(menuPopupProps, props)}>
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
  component: Menu,
  parameters: { layout: "fullscreen" },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Omit<Meta<MenuProps>, "component"> & {
  component: typeof Menu;
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
      {menuPopupProps.size.values.map((size) => (
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
        menuPopupProps.variant.values.map((variant) => (
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
