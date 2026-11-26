import {
  type ContextMenuPopupOwnProps,
  contextMenuPopupProps,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconCopy,
  IconDownload,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import * as React from "react";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuPopup,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuGroupLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSubmenuRoot,
  ContextMenuSubmenuPopup,
  ContextMenuSubmenuTrigger,
  ContextMenuTrigger,
} from "../../../src/ui/base-ui/context-menu.js";
import { propControls } from "../prop-controls.js";
import guide from "./context-menu.docs.md?raw";

type ContextMenuProps = ContextMenuPopupOwnProps;

const controls = propControls(contextMenuPopupProps);

function ContextMenuSample(props: ContextMenuProps) {
  const [checked, setChecked] = React.useState(true);
  const [sort, setSort] = React.useState("name");

  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-10 w-56 items-center justify-center rounded-md border border-dashed text-xs">
        Right click here
      </ContextMenuTrigger>
      <ContextMenuPopup {...props} className="w-56">
        <ContextMenuGroup>
          <ContextMenuGroupLabel>Document</ContextMenuGroupLabel>
          <ContextMenuItem>Rename</ContextMenuItem>
          <ContextMenuItem
            leading={<IconCopy />}
            trailing={<ContextMenuShortcut>⌘D</ContextMenuShortcut>}
          >
            Duplicate
          </ContextMenuItem>
          <ContextMenuItem disabled leading={<IconPencil />}>
            Locked
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuCheckboxItem
          checked={checked}
          onCheckedChange={setChecked}
          closeOnClick={false}
        >
          Show grid
        </ContextMenuCheckboxItem>
        <ContextMenuCheckboxItem checked={false} closeOnClick={false}>
          Snap to grid
        </ContextMenuCheckboxItem>
        <ContextMenuSeparator />
        <ContextMenuRadioGroup value={sort} onValueChange={setSort}>
          <ContextMenuRadioItem value="name" closeOnClick={false}>
            Name
          </ContextMenuRadioItem>
          <ContextMenuRadioItem value="date" closeOnClick={false}>
            Date
          </ContextMenuRadioItem>
        </ContextMenuRadioGroup>
        <ContextMenuSeparator />
        <ContextMenuSubmenuRoot>
          <ContextMenuSubmenuTrigger leading={<IconDownload />}>
            Export
          </ContextMenuSubmenuTrigger>
          <ContextMenuSubmenuPopup>
            <ContextMenuItem>PDF</ContextMenuItem>
            <ContextMenuItem>PNG</ContextMenuItem>
          </ContextMenuSubmenuPopup>
        </ContextMenuSubmenuRoot>
        <ContextMenuItem color="danger" leading={<IconTrash />}>
          Delete
        </ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
}

const meta = {
  title: "Components/Context Menu",
  component: ContextMenuPopup,
  parameters: {
    docs: { description: { component: guide } },
    layout: "fullscreen",
  },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Meta<ContextMenuProps>;

export default meta;

type Story = StoryObj<ContextMenuProps>;

/**
 * Every row kind, with the props from the controls; right click to open it.
 * The menu is modal, so this story holds only it. Its sizes and variants are
 * the Menu's: see Components/Menu.
 */
export const Playground: Story = {
  render: (args) => (
    <div className="h-[560px] p-8">
      <ContextMenuSample {...args} />
    </div>
  ),
};
