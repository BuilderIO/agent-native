import {
  AppSidebar as ToolkitAppSidebar,
  type AppSidebarProps as ToolkitAppSidebarProps,
} from "@agent-native/toolkit/app-shell";
import { forwardRef } from "react";

import { AgentNativeIcon } from "../components/icons/AgentNativeIcon.js";
import { EnvironmentBadge } from "../EnvironmentBadge.js";

export interface AppSidebarProps extends ToolkitAppSidebarProps {
  badgeText?: string;
  showBadge?: boolean;
}

export const AppSidebar = forwardRef<HTMLElement, AppSidebarProps>(
  (
    {
      brandIcon,
      badge,
      badgeText,
      showBadge = true,
      ...props
    },
    ref,
  ) => {
    const resolvedBrandIcon =
      brandIcon ?? (
        <AgentNativeIcon
          aria-hidden="true"
          className="h-3.5 w-6 shrink-0 text-primary"
        />
      );

    const resolvedBadge =
      badge ?? (showBadge ? <EnvironmentBadge placement="inline" badgeText={badgeText} /> : undefined);

    return (
      <ToolkitAppSidebar
        ref={ref}
        brandIcon={resolvedBrandIcon}
        badge={resolvedBadge}
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
} from "@agent-native/toolkit/app-shell";
