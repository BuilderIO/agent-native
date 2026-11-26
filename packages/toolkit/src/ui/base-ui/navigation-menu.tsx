import { mergeProps } from "@base-ui/react/merge-props";
import { NavigationMenu as BaseNavigationMenu } from "@base-ui/react/navigation-menu";
import { useRender } from "@base-ui/react/use-render";
import * as React from "react";

import { IconOnlyTooltip, useIconOnly } from "./icon-only.js";
import { partClassName } from "./part-class.js";

export type NavigationMenuProps = BaseNavigationMenu.Root.Props;

/**
 * Lists of links to an app's places with the current one marked, on Base
 * UI's Navigation Menu. Lists nest, and inside a collapsed sidebar links
 * show only their icon and name themselves in a tooltip.
 *
 * @import import { NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuLink } from "@agent-native/toolkit/ui/base-ui/navigation-menu";
 */
const NavigationMenu = React.forwardRef<HTMLElement, NavigationMenuProps>(
  ({ className, ...props }, ref) => (
    <BaseNavigationMenu.Root
      ref={ref}
      className={partClassName("navigation-menu", className)}
      {...props}
    />
  ),
);
NavigationMenu.displayName = "NavigationMenu";

export type NavigationMenuListProps = BaseNavigationMenu.List.Props;

/**
 * A list of places. Inside an item it nests, hanging from a guide line under
 * its parent's icon.
 *
 * @import import { NavigationMenuList } from "@agent-native/toolkit/ui/base-ui/navigation-menu";
 */
const NavigationMenuList = React.forwardRef<
  HTMLUListElement,
  NavigationMenuListProps
>(({ className, ...props }, ref) => (
  <BaseNavigationMenu.List
    ref={ref}
    className={partClassName("navigation-menu-list", className)}
    {...props}
  />
));
NavigationMenuList.displayName = "NavigationMenuList";

export type NavigationMenuGroupLabelProps = useRender.ComponentProps<"div">;

/**
 * Names the list of places under it, such as a settings group.
 *
 * @import import { NavigationMenuGroupLabel } from "@agent-native/toolkit/ui/base-ui/navigation-menu";
 */
function NavigationMenuGroupLabel({
  render,
  ...props
}: NavigationMenuGroupLabelProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">(
      { className: "navigation-menu-group-label" },
      props,
    ),
  });
}

export type NavigationMenuItemProps = BaseNavigationMenu.Item.Props;

/**
 * One place in a list, holding its link and any list nested under it.
 *
 * @import import { NavigationMenuItem } from "@agent-native/toolkit/ui/base-ui/navigation-menu";
 */
const NavigationMenuItem = React.forwardRef<
  HTMLLIElement,
  NavigationMenuItemProps
>(({ className, ...props }, ref) => (
  <BaseNavigationMenu.Item
    ref={ref}
    className={partClassName("navigation-menu-item", className)}
    {...props}
  />
));
NavigationMenuItem.displayName = "NavigationMenuItem";

export interface NavigationMenuLinkProps extends BaseNavigationMenu.Link.Props {
  /** Before the label: the place's icon. */
  leading?: React.ReactNode;
  /** A count, badge or other detail after the label. */
  trailing?: React.ReactNode;
}

/**
 * The link to a place, with its icon before the label and a count or badge
 * after it. Mark the current place `active`.
 *
 * @import import { NavigationMenuLink } from "@agent-native/toolkit/ui/base-ui/navigation-menu";
 */
const NavigationMenuLink = React.forwardRef<
  HTMLAnchorElement,
  NavigationMenuLinkProps
>(({ className, leading, trailing, children, ...props }, ref) => {
  const iconOnly = useIconOnly();
  const link = (
    <BaseNavigationMenu.Link
      ref={ref}
      data-icon-only={iconOnly ? "" : undefined}
      className={partClassName("navigation-menu-link", className)}
      {...props}
    >
      {leading === undefined ? null : (
        <span className="navigation-menu-link-leading" aria-hidden>
          {leading}
        </span>
      )}
      <span className="navigation-menu-link-label">{children}</span>
      {trailing === undefined ? null : (
        <span className="navigation-menu-link-trailing">{trailing}</span>
      )}
    </BaseNavigationMenu.Link>
  );
  return iconOnly ? (
    <IconOnlyTooltip trigger={link}>{children}</IconOnlyTooltip>
  ) : (
    link
  );
});
NavigationMenuLink.displayName = "NavigationMenuLink";

export {
  NavigationMenu,
  NavigationMenuGroupLabel,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
};
