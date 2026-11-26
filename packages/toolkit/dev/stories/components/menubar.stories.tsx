import {
  type MenubarPopupOwnProps,
  menubarPopupProps,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import {
  Menubar,
  MenubarCheckboxItem,
  MenubarPopup,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSubmenuRoot,
  MenubarSubmenuPopup,
  MenubarSubmenuTrigger,
  MenubarTrigger,
} from "../../../src/ui/base-ui/menubar.js";
import { propControls } from "../prop-controls.js";
import guide from "./menubar.docs.md?raw";

type MenubarMenuProps = MenubarPopupOwnProps;

const controls = propControls(menubarPopupProps);

function MenubarSample(props: MenubarMenuProps) {
  const [grid, setGrid] = React.useState(true);
  const [zoom, setZoom] = React.useState("fit");
  return (
    <Menubar aria-label="Editor">
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarPopup {...props}>
          <MenubarItem trailing={<MenubarShortcut>⌘N</MenubarShortcut>}>
            New
          </MenubarItem>
          <MenubarItem trailing={<MenubarShortcut>⌘O</MenubarShortcut>}>
            Open
          </MenubarItem>
          <MenubarSeparator />
          <MenubarSubmenuRoot>
            <MenubarSubmenuTrigger>Export</MenubarSubmenuTrigger>
            <MenubarSubmenuPopup>
              <MenubarItem>PDF</MenubarItem>
              <MenubarItem>PNG</MenubarItem>
            </MenubarSubmenuPopup>
          </MenubarSubmenuRoot>
        </MenubarPopup>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarPopup {...props}>
          <MenubarCheckboxItem checked={grid} onCheckedChange={setGrid}>
            Show grid
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarRadioGroup value={zoom} onValueChange={setZoom}>
            <MenubarRadioItem value="fit">Fit</MenubarRadioItem>
            <MenubarRadioItem value="100">100%</MenubarRadioItem>
          </MenubarRadioGroup>
        </MenubarPopup>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger disabled>Help</MenubarTrigger>
        <MenubarPopup {...props}>
          <MenubarItem>Docs</MenubarItem>
        </MenubarPopup>
      </MenubarMenu>
    </Menubar>
  );
}

const meta = {
  title: "Components/Menubar",
  component: MenubarPopup,
  parameters: {
    docs: { description: { component: guide } },
    layout: "fullscreen",
  },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Meta<MenubarMenuProps>;

export default meta;

type Story = StoryObj<MenubarMenuProps>;

/**
 * The bar with an enabled, a checked and a disabled trigger, its menus drawn
 * with the props from the controls. Press File to open it. The menus' sizes
 * and variants are the Menu's: see Components/Menu.
 */
export const Playground: Story = {
  render: (args) => (
    <div className="h-[320px] p-8">
      <MenubarSample {...args} />
    </div>
  ),
};
