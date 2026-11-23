import { type TabNavOwnProps, tabNavProps } from "@agent-native/design-system";
import { NavigationMenu as BaseNavigationMenu } from "@base-ui/react/navigation-menu";
import * as React from "react";

import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface TabNavProps
  extends
    Omit<BaseNavigationMenu.Root.Props, "color" | "orientation">,
    TabNavOwnProps {}

/**
 * A row of links between pages drawn with Tabs' look, as Radix Themes' TabNav,
 * on Base UI's Navigation Menu. To switch panels on one page, use Tabs.
 *
 * @import import { TabNav, TabNavLink } from "@agent-native/toolkit/ui/base-ui/tab-nav";
 */
const TabNav = React.forwardRef<HTMLElement, TabNavProps>((props, ref) => {
  const [attributes, { className, children, ...rest }] = splitProps(
    tabNavProps,
    props,
  );
  return (
    <BaseNavigationMenu.Root
      ref={ref}
      {...rest}
      className={partClassName("tab-nav", className)}
    >
      <BaseNavigationMenu.List {...attributes} className="tab-nav-list">
        {children}
      </BaseNavigationMenu.List>
    </BaseNavigationMenu.Root>
  );
});
TabNav.displayName = "TabNav";

export type TabNavLinkProps = BaseNavigationMenu.Link.Props;

/**
 * One page's link in the row, underlined in the accent while it is the current
 * page.
 *
 * @import import { TabNavLink } from "@agent-native/toolkit/ui/base-ui/tab-nav";
 */
const TabNavLink = React.forwardRef<HTMLAnchorElement, TabNavLinkProps>(
  ({ className, ...props }, ref) => (
    <BaseNavigationMenu.Item className="tab-nav-item">
      <BaseNavigationMenu.Link
        ref={ref}
        {...props}
        className={partClassName("tab-nav-link", className)}
      />
    </BaseNavigationMenu.Item>
  ),
);
TabNavLink.displayName = "TabNavLink";

export { TabNav, TabNavLink };
