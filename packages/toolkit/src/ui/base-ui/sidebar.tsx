import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import * as React from "react";

import { SidebarDrawer, useAppShell } from "./app-shell.js";
import { IconOnlyProvider, IconOnlyTooltip, useIconOnly } from "./icon-only.js";

export type SidebarProps = useRender.ComponentProps<"div">;

/**
 * An app's navigation column, in regions: a brand row, the content and a
 * footer, filled with real parts such as NavigationMenu, Collapsible and
 * Menu. Inside an AppShell it collapses to an icon rail, where the parts name
 * themselves in tooltips, and it is a drawer at the mobile width.
 *
 * @import import { Sidebar, SidebarHeader, SidebarBrand, SidebarContent, SidebarFooter } from "@agent-native/toolkit/ui/base-ui/sidebar";
 */
function Sidebar({ render, ref, ...props }: SidebarProps) {
  const shell = useAppShell("Sidebar");
  const rail = shell.collapsed && !shell.mobile;
  const navigation = React.useRef<HTMLDivElement>(null);
  const wasOpen = React.useRef(false);
  React.useLayoutEffect(() => {
    const node = navigation.current;
    if (
      wasOpen.current &&
      !shell.mobile &&
      node &&
      node.ownerDocument.activeElement === node.ownerDocument.body
    )
      node.focus({ preventScroll: true });
    wasOpen.current = shell.mobile && shell.drawerOpen;
  }, [shell.mobile, shell.drawerOpen]);
  const own: React.ComponentProps<"div"> &
    Record<`data-${string}`, string | undefined> = {
    className: "sidebar",
    tabIndex: -1,
    "data-collapsed": rail ? "" : undefined,
  };
  const sidebar = useRender<Record<string, never>, HTMLDivElement>({
    ref: ref ? [navigation, ref] : navigation,
    defaultTagName: "div",
    render,
    props: mergeProps<"div">(own, props),
  });
  const element = <IconOnlyProvider value={rail}>{sidebar}</IconOnlyProvider>;
  if (!shell.mobile) return element;
  const name = React.isValidElement<React.AriaAttributes>(sidebar)
    ? sidebar.props
    : props;
  return (
    <SidebarDrawer
      {...(name["aria-label"] === undefined
        ? {}
        : { label: name["aria-label"] })}
      {...(name["aria-labelledby"] === undefined
        ? {}
        : { "aria-labelledby": name["aria-labelledby"] })}
    >
      {element}
    </SidebarDrawer>
  );
}

export type SidebarHeaderProps = useRender.ComponentProps<"div">;

/**
 * The brand row along the top of the sidebar.
 *
 * @import import { SidebarHeader } from "@agent-native/toolkit/ui/base-ui/sidebar";
 */
function SidebarHeader({ render, ...props }: SidebarHeaderProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "sidebar-header" }, props),
  });
}

export interface SidebarBrandProps extends useRender.ComponentProps<"a"> {
  /** The app's mark; on the rail it is all that shows. */
  logo: React.ReactNode;
  /** A Badge after the name, such as the release stage. */
  badge?: React.ReactNode;
}

/**
 * The app's mark and name, linking home; render it as a router link through
 * `render`. On the rail only the mark shows and the name is its tooltip.
 *
 * @import import { SidebarBrand } from "@agent-native/toolkit/ui/base-ui/sidebar";
 */
function SidebarBrand({
  render,
  logo,
  badge,
  children,
  ...props
}: SidebarBrandProps) {
  const iconOnly = useIconOnly();
  const own: React.ComponentProps<"a"> = {
    className: "sidebar-brand",
    children: (
      <>
        <span className="sidebar-brand-logo" aria-hidden>
          {logo}
        </span>
        <span className="sidebar-brand-name">{children}</span>
        {badge === undefined ? null : (
          <span className="sidebar-brand-badge">{badge}</span>
        )}
      </>
    ),
  };
  const brand = useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(own, props),
  });
  return iconOnly ? (
    <IconOnlyTooltip trigger={brand}>{children}</IconOnlyTooltip>
  ) : (
    brand
  );
}

export type SidebarContentProps = useRender.ComponentProps<"div">;

/**
 * The sidebar's scrolling middle, for search and the navigation.
 *
 * @import import { SidebarContent } from "@agent-native/toolkit/ui/base-ui/sidebar";
 */
function SidebarContent({ render, ...props }: SidebarContentProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "sidebar-content" }, props),
  });
}

export type SidebarFooterProps = useRender.ComponentProps<"div">;

/**
 * The row along the bottom of the sidebar, for the account and the collapse
 * toggle.
 *
 * @import import { SidebarFooter } from "@agent-native/toolkit/ui/base-ui/sidebar";
 */
function SidebarFooter({ render, ...props }: SidebarFooterProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "sidebar-footer" }, props),
  });
}

export { Sidebar, SidebarHeader, SidebarBrand, SidebarContent, SidebarFooter };
