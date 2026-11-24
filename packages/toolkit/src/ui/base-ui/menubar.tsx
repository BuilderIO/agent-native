import {
  menubarPopupProps,
  menubarItemProps,
} from "@agent-native/design-system";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Menubar as BaseMenubar } from "@base-ui/react/menubar";
import * as React from "react";

import {
  createMenuPopup,
  createMenuItem,
  Menu,
  MenuCheckboxItem,
  MenuLinkItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPortal,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSubmenuRoot,
  MenuSubmenuPopup,
  MenuSubmenuTrigger,
  type MenuPopupProps,
} from "./menu.js";
import { partClassName } from "./part-class.js";

/** A menu row that navigates to its href.
 * @import import { MenubarLinkItem } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarLinkItem = MenuLinkItem;

/**
 * A row of menus along the top of an app or window, on Base UI's Menubar,
 * which moves focus between its triggers. Each menu inside it is the menu's
 * own popup, items and submenus.
 *
 * @import import { Menubar, MenubarMenu, MenubarTrigger, MenubarPopup, MenubarItem, MenubarSeparator } from "@agent-native/toolkit/ui/base-ui/menubar";
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
const MenubarTrigger = React.forwardRef<
  HTMLButtonElement,
  BaseMenu.Trigger.Props
>(({ className, ...props }, ref) => (
  <BaseMenu.Trigger
    ref={ref}
    className={partClassName("menubar-trigger", className)}
    {...props}
  />
));
MenubarTrigger.displayName = "MenubarTrigger";

const MenuContent = createMenuPopup(menubarPopupProps, "MenuContent");

/**
 * A menu's popup, opened below its trigger. It holds the items and sets the
 * size, variant and color they inherit.
 *
 * @import import { MenubarPopup } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
const MenubarPopup = React.forwardRef<HTMLDivElement, MenuPopupProps>(
  ({ align = "start", alignOffset = -4, sideOffset = 8, ...props }, ref) => (
    <MenuContent
      ref={ref}
      align={align}
      alignOffset={alignOffset}
      sideOffset={sideOffset}
      {...props}
    />
  ),
);
MenubarPopup.displayName = "MenubarPopup";

/**
 * A row that runs an action when chosen, with an optional icon before the
 * label and a shortcut or other content after it.
 *
 * @import import { MenubarItem } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarItem = createMenuItem(menubarItemProps, "MenubarItem");

/**
 * One menu in the bar: wraps a MenubarTrigger and the MenubarPopup it
 * opens.
 *
 * @import import { MenubarMenu } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarMenu = Menu;

/**
 * A line between groups of items.
 *
 * @import import { MenubarSeparator } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarSeparator = MenuSeparator;

/**
 * Labels its enclosing MenubarGroup or MenubarRadioGroup.
 *
 * @import import { MenubarGroupLabel } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarGroupLabel = MenuGroupLabel;

/**
 * A row that toggles a setting on and off, with its check in the leading
 * slot.
 *
 * @import import { MenubarCheckboxItem } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarCheckboxItem = MenuCheckboxItem;

/**
 * Holds radio items of which only one is chosen, and owns their value.
 *
 * @import import { MenubarRadioGroup } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarRadioGroup = MenuRadioGroup;

/**
 * A row in a MenubarRadioGroup, for picking one of several options.
 *
 * @import import { MenubarRadioItem } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarRadioItem = MenuRadioItem;

/**
 * Moves the menu into the body, or into `container`. MenubarPopup renders
 * one already.
 *
 * @import import { MenubarPortal } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarPortal = MenuPortal;

/**
 * The popup a submenu opens, styled like the menu it opens from.
 *
 * @import import { MenubarSubmenuPopup } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarSubmenuPopup = MenuSubmenuPopup;

/**
 * The row that opens a submenu, with a chevron in the trailing slot.
 *
 * @import import { MenubarSubmenuTrigger } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarSubmenuTrigger = MenuSubmenuTrigger;

/**
 * Groups related items under a MenubarGroupLabel.
 *
 * @import import { MenubarGroup } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarGroup = MenuGroup;

/**
 * A submenu: wraps a MenubarSubmenuTrigger and the MenubarSubmenuPopup it opens.
 *
 * @import import { MenubarSubmenuRoot } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarSubmenuRoot = MenuSubmenuRoot;

/**
 * The keyboard shortcut for an item, set in its `trailing` slot.
 *
 * @import import { MenubarShortcut } from "@agent-native/toolkit/ui/base-ui/menubar";
 */
export const MenubarShortcut = MenuShortcut;

export { Menubar, MenubarTrigger, MenubarPopup };
