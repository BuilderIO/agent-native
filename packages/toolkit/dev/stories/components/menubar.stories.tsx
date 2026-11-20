import {
  type MenubarContentOwnProps,
  menubarContentProps,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "../../../src/ui/base-ui/menubar.js";
import { propControls } from "../prop-controls.js";

type MenubarMenuProps = MenubarContentOwnProps;

const controls = propControls(menubarContentProps);

function MenubarSample(props: MenubarMenuProps) {
  const [grid, setGrid] = React.useState(true);
  const [zoom, setZoom] = React.useState("fit");
  return (
    <Menubar aria-label="Editor">
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent {...props}>
          <MenubarItem trailing={<MenubarShortcut>⌘N</MenubarShortcut>}>
            New
          </MenubarItem>
          <MenubarItem trailing={<MenubarShortcut>⌘O</MenubarShortcut>}>
            Open
          </MenubarItem>
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>Export</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarItem>PDF</MenubarItem>
              <MenubarItem>PNG</MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarContent {...props}>
          <MenubarCheckboxItem checked={grid} onCheckedChange={setGrid}>
            Show grid
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarRadioGroup value={zoom} onValueChange={setZoom}>
            <MenubarRadioItem value="fit">Fit</MenubarRadioItem>
            <MenubarRadioItem value="100">100%</MenubarRadioItem>
          </MenubarRadioGroup>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger disabled>Help</MenubarTrigger>
        <MenubarContent {...props}>
          <MenubarItem>Docs</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}

const meta = {
  title: "Components/Menubar",
  parameters: { layout: "fullscreen" },
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
