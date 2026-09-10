import {
  AppSidebar as ToolkitAppSidebar,
  type AppSidebarLinkComponent,
  type AppSidebarProps as ToolkitAppSidebarProps,
} from "@agent-native/toolkit/app-shell";
import { forwardRef, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router";

import { AgentNativeIcon } from "../components/icons/AgentNativeIcon.js";
import { EnvironmentBadge } from "../EnvironmentBadge.js";

function RouterSidebarLink({
  to,
  href,
  className,
  onClick,
  children,
  "aria-label": ariaLabel,
}: {
  to?: string;
  href?: string;
  className?: string;
  onClick?: (event: MouseEvent) => void;
  children?: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <Link
      to={to ?? href ?? "/"}
      className={className}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}

export interface AppSidebarProps extends ToolkitAppSidebarProps {
  badgeText?: string;
  showBadge?: boolean;
}

export const AppSidebar = forwardRef<HTMLElement, AppSidebarProps>(
  (
    { brandIcon, badge, badgeText, showBadge = true, linkComponent, ...props },
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
        <EnvironmentBadge placement="inline" badgeText={badgeText} />
      ) : undefined);

    const resolvedLinkComponent: AppSidebarLinkComponent =
      linkComponent ?? RouterSidebarLink;

    return (
      <ToolkitAppSidebar
        ref={ref}
        brandIcon={resolvedBrandIcon}
        badge={resolvedBadge}
        linkComponent={resolvedLinkComponent}
        {...props}
      />
    );
  },
);
AppSidebar.displayName = "AppSidebar";

export {
  AppSidebarHeader,
  AppSidebarNavItem,
  AppSidebarNavGroup,
  AppSidebarSection,
  AppSidebarFeedbackButton,
  AppSidebarFooter,
  useAppSidebar,
  type AppSidebarHeaderProps,
  type AppSidebarNavItemProps,
  type AppSidebarNavGroupProps,
  type AppSidebarSectionProps,
  type AppSidebarFeedbackButtonProps,
  type AppSidebarFooterProps,
  type AppSidebarItemDefinition,
  type AppSidebarContextValue,
  type AppSidebarLinkComponent,
} from "@agent-native/toolkit/app-shell";
