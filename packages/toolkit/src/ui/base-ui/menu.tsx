import {
  menuPopupProps,
  menuItemProps,
  type PropsOf,
} from "@agent-native/design-system";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { IconCheck, IconChevronRight, IconCircle } from "@tabler/icons-react";
import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "../../utils.js";
import { scopePortal } from "./overlay-scope.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

type PositionerProps = Pick<
  BaseMenu.Positioner.Props,
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

type MenuPopupDefs = typeof menuPopupProps;
type MenuItemDefs = typeof menuItemProps;

export interface MenuPopupProps
  extends
    Omit<BaseMenu.Popup.Props, "color">,
    PositionerProps,
    PropsOf<MenuPopupDefs> {
  /** Portal target. */
  container?: BaseMenu.Portal.Props["container"];
  /** Keeps the popup mounted while closed. */
  keepMounted?: BaseMenu.Portal.Props["keepMounted"];
}

/** A submenu takes its size, variant and color from the menu it opens from. */
export type MenuSubmenuPopupProps = Omit<MenuPopupProps, keyof MenuPopupDefs>;

const MenuAttributesContext = React.createContext<
  Record<string, string | undefined>
>({});

const InsideMenuGroup = React.createContext(false);

const MenuPopupFrame = React.forwardRef<
  HTMLDivElement,
  MenuSubmenuPopupProps & {
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
    <MenuPortal container={container} keepMounted={keepMounted}>
      <BaseMenu.Positioner
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
        <InsideMenuGroup.Provider value={false}>
          <BaseMenu.Popup
            ref={ref}
            {...props}
            {...attributes}
            className={partClassName("menu-popup", className)}
          />
        </InsideMenuGroup.Provider>
      </BaseMenu.Positioner>
    </MenuPortal>
  ),
);
MenuPopupFrame.displayName = "MenuPopupFrame";

/** The content of a menu, a context menu or a menubar menu, from its definitions. */
export function createMenuPopup(defs: MenuPopupDefs, displayName: string) {
  const component = React.forwardRef<HTMLDivElement, MenuPopupProps>(
    (props, ref) => {
      const [attributes, rest] = splitProps(defs, props);
      return (
        <MenuAttributesContext.Provider value={attributes}>
          <MenuPopupFrame ref={ref} attributes={attributes} {...rest} />
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
 * @import import { MenuSubmenuPopup } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const MenuSubmenuPopup = React.forwardRef<
  HTMLDivElement,
  MenuSubmenuPopupProps
>((props, ref) => {
  const attributes = React.useContext(MenuAttributesContext);
  const marker = React.useRef<HTMLTemplateElement>(null);
  const [host, setHost] = React.useState<HTMLDivElement | null>();
  React.useLayoutEffect(() => {
    const source = marker.current;
    const menu =
      source?.closest(".menu-popup") ?? source?.closest('[role="menu"]');
    if (!menu) {
      setHost(null);
      return;
    }
    const node = menu.ownerDocument.createElement("div");
    node.style.display = "contents";
    menu.after(node);
    setHost(node);
    return () => node.remove();
  }, []);
  const popup = <MenuPopupFrame ref={ref} attributes={attributes} {...props} />;
  return (
    <>
      <template ref={marker} />
      {host ? createPortal(popup, host) : host === null ? popup : null}
    </>
  );
});
MenuSubmenuPopup.displayName = "MenuSubmenuPopup";

/**
 * A list of actions or options that opens from a button, on Base UI's Menu
 * with Radix Themes' Menu props. Root, Trigger, Portal, Group and
 * Radio Group are Base UI's own parts.
 *
 * @import import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "@agent-native/toolkit/ui/base-ui/menu";
 */
export const Menu = BaseMenu.Root;

/**
 * The button that opens the menu. Compose your own button with `render`.
 *
 * @import import { MenuTrigger } from "@agent-native/toolkit/ui/base-ui/menu";
 */
export const MenuTrigger = BaseMenu.Trigger;

/**
 * Moves the menu into the body, or into `container`. MenuPopup
 * renders one already.
 *
 * @import import { MenuPortal } from "@agent-native/toolkit/ui/base-ui/menu";
 */
export const MenuPortal = scopePortal(BaseMenu.Portal);

/**
 * Groups related items under a MenuGroupLabel.
 *
 * @import import { MenuGroup } from "@agent-native/toolkit/ui/base-ui/menu";
 */
export const MenuGroup = React.forwardRef<HTMLDivElement, BaseMenu.Group.Props>(
  (props, ref) => (
    <InsideMenuGroup.Provider value>
      <BaseMenu.Group {...props} ref={ref} />
    </InsideMenuGroup.Provider>
  ),
);
MenuGroup.displayName = "MenuGroup";

/**
 * Holds radio items of which only one is chosen, and owns their value.
 *
 * @import import { MenuRadioGroup } from "@agent-native/toolkit/ui/base-ui/menu";
 */
export const MenuRadioGroup = React.forwardRef<
  HTMLDivElement,
  BaseMenu.RadioGroup.Props
>((props, ref) => (
  <InsideMenuGroup.Provider value>
    <BaseMenu.RadioGroup {...props} ref={ref} />
  </InsideMenuGroup.Provider>
));
MenuRadioGroup.displayName = "MenuRadioGroup";

/**
 * A submenu: wraps a MenuSubmenuTrigger and the MenuSubmenuPopup it
 * opens.
 *
 * @import import { MenuSubmenuRoot } from "@agent-native/toolkit/ui/base-ui/menu";
 */
export const MenuSubmenuRoot = BaseMenu.SubmenuRoot;

/**
 * The menu's popup, positioned beside its trigger. It holds the items and
 * sets the size, variant and color they inherit.
 *
 * @import import { MenuPopup } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const MenuPopup = createMenuPopup(menuPopupProps, "MenuPopup");

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

export interface MenuItemProps
  extends
    Omit<BaseMenu.Item.Props, "color">,
    MenuItemSlots,
    PropsOf<MenuItemDefs> {}

/** A menu item from its definitions: `color` marks a destructive or status row. */
export function createMenuItem(defs: MenuItemDefs, displayName: string) {
  const component = React.forwardRef<HTMLDivElement, MenuItemProps>(
    (props, ref) => {
      const [attributes, { leading, trailing, className, children, ...rest }] =
        splitProps(defs, props);
      return (
        <BaseMenu.Item
          ref={ref}
          {...rest}
          {...attributes}
          className={partClassName("menu-item", className)}
        >
          <MenuItemSlot slot="leading">{leading}</MenuItemSlot>
          {children}
          <MenuItemSlot slot="trailing">{trailing}</MenuItemSlot>
        </BaseMenu.Item>
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
 * @import import { MenuItem } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const MenuItem = createMenuItem(menuItemProps, "MenuItem");

export interface MenuLinkItemProps
  extends
    Omit<BaseMenu.LinkItem.Props, "color">,
    MenuItemSlots,
    PropsOf<MenuItemDefs> {}

/** A menu row that navigates to its href. Use render for a router link.
 * @import import { MenuLinkItem } from "@agent-native/toolkit/ui/base-ui/menu";
 */
export const MenuLinkItem = React.forwardRef<
  HTMLAnchorElement,
  MenuLinkItemProps
>((props, ref) => {
  const [attributes, { leading, trailing, className, children, ...rest }] =
    splitProps(menuItemProps, props);
  return (
    <BaseMenu.LinkItem
      ref={ref}
      {...rest}
      {...attributes}
      className={partClassName("menu-item", className)}
    >
      <MenuItemSlot slot="leading">{leading}</MenuItemSlot>
      {children}
      <MenuItemSlot slot="trailing">{trailing}</MenuItemSlot>
    </BaseMenu.LinkItem>
  );
});
MenuLinkItem.displayName = "MenuLinkItem";

export interface MenuCheckboxItemProps
  extends BaseMenu.CheckboxItem.Props, Pick<MenuItemSlots, "trailing"> {}

/**
 * A row that toggles a setting on and off. Its check sits in the leading slot,
 * which keeps its column when unchecked.
 *
 * @import import { MenuCheckboxItem } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const MenuCheckboxItem = React.forwardRef<
  HTMLDivElement,
  MenuCheckboxItemProps
>(({ className, children, trailing, ...props }, ref) => (
  <BaseMenu.CheckboxItem
    ref={ref}
    className={partClassName("menu-checkbox-item", className)}
    {...props}
  >
    <span className="menu-item-leading">
      <BaseMenu.CheckboxItemIndicator>
        <IconCheck />
      </BaseMenu.CheckboxItemIndicator>
    </span>
    {children}
    <MenuItemSlot slot="trailing">{trailing}</MenuItemSlot>
  </BaseMenu.CheckboxItem>
));
MenuCheckboxItem.displayName = "MenuCheckboxItem";

export interface MenuRadioItemProps
  extends BaseMenu.RadioItem.Props, Pick<MenuItemSlots, "trailing"> {
  indicator?: "circle" | "check";
}

/**
 * A row in a MenuRadioGroup, for picking one of several options. Its
 * dot or check sits in the leading slot, like the checkbox item's.
 *
 * @import import { MenuRadioItem } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const MenuRadioItem = React.forwardRef<HTMLDivElement, MenuRadioItemProps>(
  ({ className, children, trailing, indicator = "circle", ...props }, ref) => (
    <BaseMenu.RadioItem
      ref={ref}
      data-indicator={indicator}
      className={partClassName("menu-radio-item", className)}
      {...props}
    >
      <span className="menu-item-leading">
        <BaseMenu.RadioItemIndicator>
          {indicator === "check" ? <IconCheck /> : <IconCircle />}
        </BaseMenu.RadioItemIndicator>
      </span>
      {children}
      <MenuItemSlot slot="trailing">{trailing}</MenuItemSlot>
    </BaseMenu.RadioItem>
  ),
);
MenuRadioItem.displayName = "MenuRadioItem";

export type MenuGroupLabelProps = React.ComponentPropsWithRef<"div">;

/**
 * Labels its enclosing MenuGroup or MenuRadioGroup. Outside a group it renders a standalone heading.
 *
 * @import import { MenuGroupLabel } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const MenuGroupLabel = React.forwardRef<HTMLDivElement, MenuGroupLabelProps>(
  ({ className, ...props }, ref) => {
    const Label = React.useContext(InsideMenuGroup)
      ? BaseMenu.GroupLabel
      : "div";
    return (
      <Label
        ref={ref}
        className={cn("menu-group-label", className)}
        {...props}
      />
    );
  },
);
MenuGroupLabel.displayName = "MenuGroupLabel";

/**
 * A line between groups of items.
 *
 * @import import { MenuSeparator } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const MenuSeparator = React.forwardRef<
  HTMLDivElement,
  BaseMenu.Separator.Props
>(({ className, ...props }, ref) => (
  <BaseMenu.Separator
    ref={ref}
    className={partClassName("menu-separator", className)}
    {...props}
  />
));
MenuSeparator.displayName = "MenuSeparator";

/**
 * The keyboard shortcut for an item, set in its `trailing` slot.
 *
 * @import import { MenuShortcut } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const MenuShortcut = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span className={cn("menu-shortcut", className)} {...props} />
);
MenuShortcut.displayName = "MenuShortcut";

/**
 * A check or icon at the end of a row, aligned with shortcuts and chevrons.
 *
 * @import import { MenuTrailing } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const MenuTrailing = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span className={cn("menu-item-trailing", className)} {...props} />
);
MenuTrailing.displayName = "MenuTrailing";

export interface MenuSubmenuTriggerProps
  extends BaseMenu.SubmenuTrigger.Props, MenuItemSlots {}

/**
 * The row that opens a submenu. It has an item's anatomy, with a chevron in
 * the trailing slot unless replaced.
 *
 * @import import { MenuSubmenuTrigger } from "@agent-native/toolkit/ui/base-ui/menu";
 */
const MenuSubmenuTrigger = React.forwardRef<
  HTMLDivElement,
  MenuSubmenuTriggerProps
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
    <BaseMenu.SubmenuTrigger
      ref={ref}
      className={partClassName("menu-submenu-trigger", className)}
      {...props}
    >
      <MenuItemSlot slot="leading">{leading}</MenuItemSlot>
      {children}
      <MenuItemSlot slot="trailing">{trailing}</MenuItemSlot>
    </BaseMenu.SubmenuTrigger>
  ),
);
MenuSubmenuTrigger.displayName = "MenuSubmenuTrigger";

export {
  MenuPopup,
  MenuItem,
  MenuCheckboxItem,
  MenuRadioItem,
  MenuGroupLabel,
  MenuSeparator,
  MenuShortcut,
  MenuTrailing,
  MenuSubmenuPopup,
  MenuSubmenuTrigger,
};
