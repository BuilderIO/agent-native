import {
  menuContentProps,
  menuItemProps,
  type PropsOf,
} from "@agent-native/design-system";
import { Menu } from "@base-ui/react/menu";
import { IconCheck, IconChevronRight, IconCircle } from "@tabler/icons-react";
import * as React from "react";

import { cn } from "../../utils.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

type PositionerProps = Pick<
  Menu.Positioner.Props,
  | "side"
  | "align"
  | "sideOffset"
  | "alignOffset"
  | "collisionPadding"
  | "collisionAvoidance"
  | "collisionBoundary"
  | "arrowPadding"
  | "anchor"
  | "sticky"
  | "positionMethod"
  | "disableAnchorTracking"
>;

type MenuContentDefs = typeof menuContentProps;
type MenuItemDefs = typeof menuItemProps;

export interface DropdownMenuContentProps
  extends
    Omit<Menu.Popup.Props, "color">,
    PositionerProps,
    PropsOf<MenuContentDefs> {
  /** Portal target. */
  container?: Menu.Portal.Props["container"];
  /** Keeps the popup mounted while closed. */
  keepMounted?: Menu.Portal.Props["keepMounted"];
}

/** A submenu takes its size, variant and color from the menu it opens from. */
export type DropdownMenuSubContentProps = Omit<
  DropdownMenuContentProps,
  keyof MenuContentDefs
>;

/** The content's attributes, which its submenus' popups repeat. */
const MenuAttributesContext = React.createContext<
  Record<string, string | undefined>
>({});

/** Portal, positioner and popup, shared by top-level and submenu content. */
const MenuPopup = React.forwardRef<
  HTMLDivElement,
  DropdownMenuSubContentProps & {
    attributes: Record<string, string | undefined>;
  }
>(
  (
    {
      attributes,
      container,
      keepMounted,
      side,
      align,
      sideOffset = 4,
      alignOffset,
      collisionPadding,
      collisionAvoidance,
      collisionBoundary,
      arrowPadding,
      anchor,
      sticky,
      positionMethod,
      disableAnchorTracking,
      className,
      ...props
    },
    ref,
  ) => (
    <Menu.Portal container={container} keepMounted={keepMounted}>
      <Menu.Positioner
        className="menu-positioner"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        collisionAvoidance={collisionAvoidance}
        collisionBoundary={collisionBoundary}
        arrowPadding={arrowPadding}
        anchor={anchor}
        sticky={sticky}
        positionMethod={positionMethod}
        disableAnchorTracking={disableAnchorTracking}
      >
        <Menu.Popup
          ref={ref}
          {...props}
          {...attributes}
          className={partClassName("menu-popup", className)}
        />
      </Menu.Positioner>
    </Menu.Portal>
  ),
);
MenuPopup.displayName = "MenuPopup";

/** The content of a menu, a context menu or a menubar menu, from its definitions. */
export function createMenuContent(defs: MenuContentDefs, displayName: string) {
  const component = React.forwardRef<HTMLDivElement, DropdownMenuContentProps>(
    (props, ref) => {
      const [attributes, rest] = splitProps(defs, props);
      return (
        <MenuAttributesContext.Provider value={attributes}>
          <MenuPopup ref={ref} attributes={attributes} {...rest} />
        </MenuAttributesContext.Provider>
      );
    },
  );
  component.displayName = displayName;
  return component;
}

/**
 * The popup a submenu opens. Its size, variant and color come from the menu
 * it opens from.
 *
 * @import import { DropdownMenuSubContent } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const DropdownMenuSubContent = React.forwardRef<
  HTMLDivElement,
  DropdownMenuSubContentProps
>((props, ref) => (
  <MenuPopup
    ref={ref}
    attributes={React.useContext(MenuAttributesContext)}
    {...props}
  />
));
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";

// Base UI's parts are exported where they are declared: through the export
// list, docgen documents Base UI's own component and drops these comments.

/**
 * A list of actions or options that opens from a button, on Base UI's Menu
 * with Radix Themes' DropdownMenu props. Root, Trigger, Portal, Group and
 * Radio Group are Base UI's own parts.
 *
 * @import import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@agent-native/toolkit/ui/base-ui/menu";
 */
export const DropdownMenu = Menu.Root;

/**
 * The button that opens the menu. Compose your own button with `render`.
 *
 * @import import { DropdownMenuTrigger } from "@agent-native/toolkit/ui/base-ui/menu";
 */
export const DropdownMenuTrigger = Menu.Trigger;

/**
 * Moves the menu into the body, or into `container`. DropdownMenuContent
 * renders one already.
 *
 * @import import { DropdownMenuPortal } from "@agent-native/toolkit/ui/base-ui/menu";
 */
export const DropdownMenuPortal = Menu.Portal;

/**
 * Groups related items, labelled by a `Menu.GroupLabel` inside it.
 *
 * @import import { DropdownMenuGroup } from "@agent-native/toolkit/ui/base-ui/menu";
 */
export const DropdownMenuGroup = Menu.Group;

/**
 * Holds radio items of which only one is chosen, and owns their value.
 *
 * @import import { DropdownMenuRadioGroup } from "@agent-native/toolkit/ui/base-ui/menu";
 */
export const DropdownMenuRadioGroup = Menu.RadioGroup;

/**
 * A submenu: wraps a DropdownMenuSubTrigger and the DropdownMenuSubContent it
 * opens.
 *
 * @import import { DropdownMenuSub } from "@agent-native/toolkit/ui/base-ui/menu";
 */
export const DropdownMenuSub = Menu.SubmenuRoot;

/**
 * The menu's popup, positioned beside its trigger. It holds the items and
 * sets the size, variant and color they inherit.
 *
 * @import import { DropdownMenuContent } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const DropdownMenuContent = createMenuContent(
  menuContentProps,
  "DropdownMenuContent",
);

/**
 * Every row has three slots: `leading` (an icon, or the check or dot of a
 * checkbox and radio item), the label (`children`), and `trailing` (a
 * shortcut, a chevron, or other trailing content). The menu part aligns the
 * labels, so rows never position themselves.
 */
export interface MenuItemSlots {
  /** An icon, sized once by the slot. Never put the icon in `children`. */
  leading?: React.ReactNode;
  /** A shortcut, chevron or other trailing content. */
  trailing?: React.ReactNode;
}

function MenuItemSlot({
  slot,
  children,
}: {
  slot: "leading" | "trailing";
  children: React.ReactNode;
}) {
  if (children == null || children === false) return null;
  return <span className={`menu-item-${slot}`}>{children}</span>;
}

export interface DropdownMenuItemProps
  extends
    Omit<Menu.Item.Props, "color">,
    MenuItemSlots,
    PropsOf<MenuItemDefs> {}

/** A menu item from its definitions: `color` marks a destructive or status row. */
export function createMenuItem(defs: MenuItemDefs, displayName: string) {
  const component = React.forwardRef<HTMLDivElement, DropdownMenuItemProps>(
    (props, ref) => {
      const [attributes, { leading, trailing, className, children, ...rest }] =
        splitProps(defs, props);
      return (
        <Menu.Item
          ref={ref}
          {...rest}
          {...attributes}
          className={partClassName("menu-item", className)}
        >
          <MenuItemSlot slot="leading">{leading}</MenuItemSlot>
          {children}
          <MenuItemSlot slot="trailing">{trailing}</MenuItemSlot>
        </Menu.Item>
      );
    },
  );
  component.displayName = displayName;
  return component;
}

/**
 * A row that runs an action when chosen, with an optional icon before the
 * label and a shortcut or other content after it.
 *
 * @import import { DropdownMenuItem } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const DropdownMenuItem = createMenuItem(menuItemProps, "DropdownMenuItem");

export interface DropdownMenuCheckboxItemProps
  extends Menu.CheckboxItem.Props, Pick<MenuItemSlots, "trailing"> {}

/**
 * A row that toggles a setting on and off. Its check sits in the leading slot,
 * which keeps its column when unchecked.
 *
 * @import import { DropdownMenuCheckboxItem } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const DropdownMenuCheckboxItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuCheckboxItemProps
>(({ className, children, trailing, ...props }, ref) => (
  <Menu.CheckboxItem
    ref={ref}
    className={partClassName("menu-checkbox-item", className)}
    {...props}
  >
    <span className="menu-item-leading">
      <Menu.CheckboxItemIndicator>
        <IconCheck />
      </Menu.CheckboxItemIndicator>
    </span>
    {children}
    <MenuItemSlot slot="trailing">{trailing}</MenuItemSlot>
  </Menu.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export interface DropdownMenuRadioItemProps
  extends Menu.RadioItem.Props, Pick<MenuItemSlots, "trailing"> {
  indicator?: "circle" | "check";
}

/**
 * A row in a DropdownMenuRadioGroup, for picking one of several options. Its
 * dot or check sits in the leading slot, like the checkbox item's.
 *
 * @import import { DropdownMenuRadioItem } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const DropdownMenuRadioItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuRadioItemProps
>(({ className, children, trailing, indicator = "circle", ...props }, ref) => (
  <Menu.RadioItem
    ref={ref}
    data-indicator={indicator}
    className={partClassName("menu-radio-item", className)}
    {...props}
  >
    <span className="menu-item-leading">
      <Menu.RadioItemIndicator>
        {indicator === "check" ? <IconCheck /> : <IconCircle />}
      </Menu.RadioItemIndicator>
    </span>
    {children}
    <MenuItemSlot slot="trailing">{trailing}</MenuItemSlot>
  </Menu.RadioItem>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

export type DropdownMenuLabelProps = React.ComponentPropsWithRef<"div">;

/**
 * A heading between items. It is a plain element, so it goes anywhere in the
 * menu; to label a group, use `Menu.GroupLabel` inside it.
 *
 * @import import { DropdownMenuLabel } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  DropdownMenuLabelProps
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("menu-group-label", className)} {...props} />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

/**
 * A line between groups of items.
 *
 * @import import { DropdownMenuSeparator } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const DropdownMenuSeparator = React.forwardRef<
  HTMLDivElement,
  Menu.Separator.Props
>(({ className, ...props }, ref) => (
  <Menu.Separator
    ref={ref}
    className={partClassName("menu-separator", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

// Shortcuts, checks, and submenu chevrons share one trailing slot, so every
// row's trailing content ends on the same edge.
/**
 * The keyboard shortcut for an item, set in its `trailing` slot.
 *
 * @import import { DropdownMenuShortcut } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const DropdownMenuShortcut = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span className={cn("menu-shortcut", className)} {...props} />
);
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

/**
 * A check or icon at the end of a row, aligned with shortcuts and chevrons.
 *
 * @import import { DropdownMenuTrailing } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const DropdownMenuTrailing = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span className={cn("menu-item-trailing", className)} {...props} />
);
DropdownMenuTrailing.displayName = "DropdownMenuTrailing";

export interface DropdownMenuSubTriggerProps
  extends Menu.SubmenuTrigger.Props, MenuItemSlots {}

/**
 * The row that opens a submenu. It has an item's anatomy, with a chevron in
 * the trailing slot unless replaced.
 *
 * @import import { DropdownMenuSubTrigger } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const DropdownMenuSubTrigger = React.forwardRef<
  HTMLDivElement,
  DropdownMenuSubTriggerProps
>(
  (
    {
      className,
      leading,
      trailing = <IconChevronRight data-direction-aware="" />,
      children,
      ...props
    },
    ref,
  ) => (
    <Menu.SubmenuTrigger
      ref={ref}
      className={partClassName("menu-submenu-trigger", className)}
      {...props}
    >
      <MenuItemSlot slot="leading">{leading}</MenuItemSlot>
      {children}
      <MenuItemSlot slot="trailing">{trailing}</MenuItemSlot>
    </Menu.SubmenuTrigger>
  ),
);
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";

export {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrailing,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
};
