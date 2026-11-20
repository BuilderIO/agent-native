import {
  contextMenuContentProps,
  contextMenuItemProps,
} from "@agent-native/design-system";
import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import * as React from "react";

import {
  createMenuContent,
  createMenuItem,
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
} from "./menu.js";
import { partClassName } from "./part-class.js";

// The parts are exported where they are declared: through the export list,
// docgen documents the aliased component and drops these comments.

/**
 * A menu that opens at the pointer when its area is right-clicked or
 * long-pressed, on Base UI's Context Menu. Its content, items and submenus
 * are the menu's, with Radix Themes' ContextMenu props.
 *
 * @import import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@agent-native/toolkit/ui/base-ui/context-menu";
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
 * @import import { ContextMenuContent } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuContent = createMenuContent(
  contextMenuContentProps,
  "ContextMenuContent",
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
export const ContextMenuCheckboxItem = DropdownMenuCheckboxItem;

/**
 * A row in a ContextMenuRadioGroup, for picking one of several options.
 *
 * @import import { ContextMenuRadioItem } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuRadioItem = DropdownMenuRadioItem;

/**
 * Holds radio items of which only one is chosen, and owns their value.
 *
 * @import import { ContextMenuRadioGroup } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuRadioGroup = DropdownMenuRadioGroup;

/**
 * A heading between items. To label a group, use `Menu.GroupLabel` inside
 * it.
 *
 * @import import { ContextMenuLabel } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuLabel = DropdownMenuLabel;

/**
 * A line between groups of items.
 *
 * @import import { ContextMenuSeparator } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuSeparator = DropdownMenuSeparator;

/**
 * The keyboard shortcut for an item, set in its `trailing` slot.
 *
 * @import import { ContextMenuShortcut } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuShortcut = DropdownMenuShortcut;

/**
 * Groups related items, labelled by a `Menu.GroupLabel` inside it.
 *
 * @import import { ContextMenuGroup } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuGroup = DropdownMenuGroup;

/**
 * Moves the menu into the body, or into `container`. ContextMenuContent
 * renders one already.
 *
 * @import import { ContextMenuPortal } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuPortal = DropdownMenuPortal;

/**
 * A submenu: wraps a ContextMenuSubTrigger and the ContextMenuSubContent it
 * opens.
 *
 * @import import { ContextMenuSub } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuSub = DropdownMenuSub;

/**
 * The row that opens a submenu, with a chevron in the trailing slot.
 *
 * @import import { ContextMenuSubTrigger } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuSubTrigger = DropdownMenuSubTrigger;

/**
 * The popup a submenu opens, styled like the menu it opens from.
 *
 * @import import { ContextMenuSubContent } from "@agent-native/toolkit/ui/base-ui/context-menu";
 */
export const ContextMenuSubContent = DropdownMenuSubContent;
