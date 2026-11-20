import {
  menubarContentProps,
  menubarItemProps,
} from "@agent-native/design-system";
import { Menu } from "@base-ui/react/menu";
import { Menubar as BaseMenubar } from "@base-ui/react/menubar";
import * as React from "react";

import {
  createMenuContent,
  createMenuItem,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  type DropdownMenuContentProps,
} from "./menu.js";
import { partClassName } from "./part-class.js";

/**
 * A row of menus along the top of an app or window, on Base UI's Menubar,
 * which moves focus between its triggers. Each menu inside it is the menu's
 * own popup, items and submenus.
 *
 * @import import { Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
const Menubar = React.forwardRef<HTMLDivElement, BaseMenubar.Props>(
  ({ className, ...props }, ref) => (
    <BaseMenubar
      ref={ref}
      className={partClassName("menubar", className)}
      {...props}
    />
  ),
);
Menubar.displayName = "Menubar";

/**
 * The button in the bar that opens its menu.
 *
 * @import import { MenubarTrigger } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
const MenubarTrigger = React.forwardRef<HTMLButtonElement, Menu.Trigger.Props>(
  ({ className, ...props }, ref) => (
    <Menu.Trigger
      ref={ref}
      className={partClassName("menubar-trigger", className)}
      {...props}
    />
  ),
);
MenubarTrigger.displayName = "MenubarTrigger";

const MenuContent = createMenuContent(menubarContentProps, "MenuContent");

/**
 * A menu's popup, opened below its trigger. It holds the items and sets the
 * size, variant and color they inherit.
 *
 * @import import { MenubarContent } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
const MenubarContent = React.forwardRef<
  HTMLDivElement,
  DropdownMenuContentProps
>(({ align = "start", alignOffset = -4, sideOffset = 8, ...props }, ref) => (
  <MenuContent
    ref={ref}
    align={align}
    alignOffset={alignOffset}
    sideOffset={sideOffset}
    {...props}
  />
));
MenubarContent.displayName = "MenubarContent";

/**
 * A row that runs an action when chosen, with an optional icon before the
 * label and a shortcut or other content after it.
 *
 * @import import { MenubarItem } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarItem = createMenuItem(menubarItemProps, "MenubarItem");

/**
 * One menu in the bar: wraps a MenubarTrigger and the MenubarContent it
 * opens.
 *
 * @import import { MenubarMenu } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarMenu = DropdownMenu;

/**
 * A line between groups of items.
 *
 * @import import { MenubarSeparator } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarSeparator = DropdownMenuSeparator;

/**
 * A heading between items. To label a group, use `Menu.GroupLabel` inside
 * it.
 *
 * @import import { MenubarLabel } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarLabel = DropdownMenuLabel;

/**
 * A row that toggles a setting on and off, with its check in the leading
 * slot.
 *
 * @import import { MenubarCheckboxItem } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarCheckboxItem = DropdownMenuCheckboxItem;

/**
 * Holds radio items of which only one is chosen, and owns their value.
 *
 * @import import { MenubarRadioGroup } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarRadioGroup = DropdownMenuRadioGroup;

/**
 * A row in a MenubarRadioGroup, for picking one of several options.
 *
 * @import import { MenubarRadioItem } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarRadioItem = DropdownMenuRadioItem;

/**
 * Moves the menu into the body, or into `container`. MenubarContent renders
 * one already.
 *
 * @import import { MenubarPortal } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarPortal = DropdownMenuPortal;

/**
 * The popup a submenu opens, styled like the menu it opens from.
 *
 * @import import { MenubarSubContent } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarSubContent = DropdownMenuSubContent;

/**
 * The row that opens a submenu, with a chevron in the trailing slot.
 *
 * @import import { MenubarSubTrigger } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarSubTrigger = DropdownMenuSubTrigger;

/**
 * Groups related items, labelled by a `Menu.GroupLabel` inside it.
 *
 * @import import { MenubarGroup } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarGroup = DropdownMenuGroup;

/**
 * A submenu: wraps a MenubarSubTrigger and the MenubarSubContent it opens.
 *
 * @import import { MenubarSub } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarSub = DropdownMenuSub;

/**
 * The keyboard shortcut for an item, set in its `trailing` slot.
 *
 * @import import { MenubarShortcut } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarShortcut = DropdownMenuShortcut;

export { Menubar, MenubarTrigger, MenubarContent };
