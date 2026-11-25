import {
  contextMenuPopupProps,
  contextMenuItemProps,
} from "@agent-native/design-system";
import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import * as React from "react";

import {
  createMenuPopup,
  createMenuItem,
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
} from "./menu.js";
import { partClassName } from "./part-class.js";

/** A menu row that navigates to its href.
 * @import import { ContextMenuLinkItem } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuLinkItem = MenuLinkItem;

/**
 * A menu that opens at the pointer when its area is right-clicked or
 * long-pressed, on Base UI's Context Menu. Its content, items and submenus
 * are the menu's, with Radix Themes' ContextMenu props.
 *
 * @import import { ContextMenu, ContextMenuTrigger, ContextMenuPopup, ContextMenuItem, ContextMenuSeparator } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenu = BaseContextMenu.Root;

/**
 * The area that opens the context menu when right-clicked or long-pressed.
 *
 * @import import { ContextMenuTrigger } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuTrigger = React.forwardRef<
  HTMLDivElement,
  BaseContextMenu.Trigger.Props
>(({ className, ...props }, ref) => (
  <BaseContextMenu.Trigger
    ref={ref}
    className={partClassName("context-menu-trigger", className)}
    {...props}
  />
));
ContextMenuTrigger.displayName = "ContextMenuTrigger";

/**
 * The context menu's popup, opened at the pointer. It holds the items and
 * sets the size, variant and color they inherit.
 *
 * @import import { ContextMenuPopup } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuPopup = createMenuPopup(
  contextMenuPopupProps,
  "ContextMenuPopup",
);

/**
 * A row that runs an action when chosen, with an optional icon before the
 * label and a shortcut or other content after it.
 *
 * @import import { ContextMenuItem } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuItem = createMenuItem(
  contextMenuItemProps,
  "ContextMenuItem",
);

/**
 * A row that toggles a setting on and off, with its check in the leading
 * slot.
 *
 * @import import { ContextMenuCheckboxItem } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuCheckboxItem = MenuCheckboxItem;

/**
 * A row in a ContextMenuRadioGroup, for picking one of several options.
 *
 * @import import { ContextMenuRadioItem } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuRadioItem = MenuRadioItem;

/**
 * Holds radio items of which only one is chosen, and owns their value.
 *
 * @import import { ContextMenuRadioGroup } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuRadioGroup = MenuRadioGroup;

/**
 * Labels its enclosing ContextMenuGroup or ContextMenuRadioGroup.
 *
 * @import import { ContextMenuGroupLabel } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuGroupLabel = MenuGroupLabel;

/**
 * A line between groups of items.
 *
 * @import import { ContextMenuSeparator } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuSeparator = MenuSeparator;

/**
 * The keyboard shortcut for an item, set in its `trailing` slot.
 *
 * @import import { ContextMenuShortcut } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuShortcut = MenuShortcut;

/**
 * Groups related items under a ContextMenuGroupLabel.
 *
 * @import import { ContextMenuGroup } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuGroup = MenuGroup;

/**
 * Moves the menu into the body, or into `container`. ContextMenuPopup
 * renders one already.
 *
 * @import import { ContextMenuPortal } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuPortal = MenuPortal;

/**
 * A submenu: wraps a ContextMenuSubmenuTrigger and the ContextMenuSubmenuPopup it
 * opens.
 *
 * @import import { ContextMenuSubmenuRoot } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuSubmenuRoot = MenuSubmenuRoot;

/**
 * The row that opens a submenu, with a chevron in the trailing slot.
 *
 * @import import { ContextMenuSubmenuTrigger } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuSubmenuTrigger = MenuSubmenuTrigger;

/**
 * The popup a submenu opens, styled like the menu it opens from.
 *
 * @import import { ContextMenuSubmenuPopup } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuSubmenuPopup = MenuSubmenuPopup;
