import {
  AppSidebar as ToolkitAppSidebar,
  AppSidebarHeader as ToolkitAppSidebarHeader,
  AppSidebarFooter as ToolkitAppSidebarFooter,
  useAppSidebar,
  type AppSidebarLinkComponent,
  type AppSidebarLinkProps,
  type AppSidebarProps as ToolkitAppSidebarProps,
  type AppSidebarHeaderProps as ToolkitAppSidebarHeaderProps,
  type AppSidebarFooterProps as ToolkitAppSidebarFooterProps,
} from "@agent-native/toolkit/app-shell";
import { forwardRef } from "react";
import { Link } from "react-router";

import { AgentNativeIcon } from "../components/icons/AgentNativeIcon.js";
import { EnvironmentBadge } from "../EnvironmentBadge.js";
import { FeedbackButton } from "../FeedbackButton.js";

const RouterSidebarLink = forwardRef<HTMLAnchorElement, AppSidebarLinkProps>(
  ({ to, href, children, ...props }, ref) => (
    <Link ref={ref} to={to ?? href ?? "/"} {...props}>
      {children}
    </Link>
  ),
);
RouterSidebarLink.displayName = "RouterSidebarLink";

export interface AppSidebarHeaderProps extends ToolkitAppSidebarHeaderProps {
  appId?: string;
  badgeText?: string;
  showBadge?: boolean;
}

export const AppSidebarHeader = forwardRef<
  HTMLDivElement,
  AppSidebarHeaderProps
>(
  (
    {
      brandIcon,
      badge,
      appId,
      badgeText,
      showBadge = true,
      brandLink,
      brandHref = "/",
      collapsed: propCollapsed,
      ...props
    },
    ref,
  ) => {
    const context = useAppSidebar();
    const collapsed = propCollapsed ?? context.collapsed;
    const resolvedBrandIcon = brandIcon ?? (
      <AgentNativeIcon
        aria-hidden="true"
        className="h-3.5 w-6 shrink-0 text-primary"
      />
    );

    const resolvedBadge =
      badge ??
      (showBadge ? (
        <EnvironmentBadge
          placement="inline"
          appId={appId}
          badgeText={badgeText}
          collapsed={collapsed}
        />
      ) : undefined);

    return (
      <ToolkitAppSidebarHeader
        ref={ref}
        brandIcon={resolvedBrandIcon}
        badge={resolvedBadge}
        collapsed={collapsed}
        brandHref={brandHref}
        {...props}
      />
    );
  },
);
AppSidebarHeader.displayName = "AppSidebarHeader";

export interface AppSidebarFooterProps extends ToolkitAppSidebarFooterProps {}

export const AppSidebarFooter = forwardRef<
  HTMLDivElement,
  AppSidebarFooterProps
>(({ feedback, collapsed: propCollapsed, ...props }, ref) => {
  const context = useAppSidebar();
  const collapsed = propCollapsed ?? context.collapsed;
  const resolvedFeedback =
    feedback !== undefined ? (
      feedback
    ) : (
      <FeedbackButton variant={collapsed ? "icon" : "sidebar"} side="right" />
    );

  return (
    <ToolkitAppSidebarFooter
      ref={ref}
      collapsed={collapsed}
      feedback={resolvedFeedback}
      {...props}
    />
  );
});
AppSidebarFooter.displayName = "AppSidebarFooter";

export interface AppSidebarProps extends ToolkitAppSidebarProps {
  appId?: string;
  badgeText?: string;
  showBadge?: boolean;
}

export const AppSidebar = forwardRef<HTMLElement, AppSidebarProps>(
  (
    {
      brandIcon,
      badge,
      appId,
      badgeText,
      showBadge = true,
      linkComponent,
      ...props
    },
    ref,
  ) => {
    const resolvedBrandIcon = brandIcon ?? (
      <AgentNativeIcon
        aria-hidden="true"
        className="h-3.5 w-6 shrink-0 text-primary"
      />
    );

    const resolvedBadge =
      badge ??
      (showBadge ? (
        <EnvironmentBadge
          placement="inline"
          appId={appId}
          badgeText={badgeText}
        />
      ) : undefined);

    const resolvedLinkComponent: AppSidebarLinkComponent =
      linkComponent ?? RouterSidebarLink;

    const resolvedFeedback =
      props.feedback !== undefined ? (
        props.feedback
      ) : (
        <FeedbackButton variant={props.collapsed ? "icon" : "sidebar"} />
      );

    return (
      <ToolkitAppSidebar
        ref={ref}
        brandIcon={resolvedBrandIcon}
        badge={resolvedBadge}
        linkComponent={resolvedLinkComponent}
        {...props}
        feedback={resolvedFeedback}
      />
    );
  },
);
AppSidebar.displayName = "AppSidebar";

export {
  AppSidebarNavItem,
  AppSidebarNavGroup,
  AppSidebarSection,
  AppSidebarFeedbackButton,
  useAppSidebar,
  type AppSidebarNavItemProps,
  type AppSidebarNavGroupProps,
  type AppSidebarSectionProps,
  type AppSidebarFeedbackButtonProps,
  type AppSidebarItemDefinition,
  type AppSidebarContextValue,
  type AppSidebarLinkComponent,
  type AppSidebarLinkProps,
} from "@agent-native/toolkit/app-shell";
