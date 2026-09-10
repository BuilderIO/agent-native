import { useT } from "@agent-native/core/client/i18n";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  AppSidebar,
  FeedbackButton,
  type AppSidebarItemDefinition,
} from "@agent-native/core/client/ui";
import {
  IconCheckbox,
  IconForms,
  IconInbox,
  IconSettings,
} from "@tabler/icons-react";
import { useLocation } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

interface SidebarProps {
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function Sidebar({
  collapsed = false,
  collapsible = true,
  onCollapsedChange,
}: SidebarProps) {
  const t = useT();
  const location = useLocation();

  const items: AppSidebarItemDefinition[] = [
    {
      to: "/inbox",
      label: t("sidebar.navInbox"),
      icon: IconInbox,
      active: location.pathname.startsWith("/inbox"),
    },
    {
      to: "/tasks",
      label: t("sidebar.navTasks"),
      icon: IconCheckbox,
      active: location.pathname.startsWith("/tasks"),
    },
    {
      to: "/fields",
      label: t("sidebar.navFields"),
      icon: IconForms,
      active: location.pathname.startsWith("/fields"),
    },
  ];

  const secondaryItems: AppSidebarItemDefinition[] = [
    {
      to: "/settings",
      label: t("header.pageSettings"),
      icon: IconSettings,
      active: location.pathname.startsWith("/settings"),
    },
  ];

  const feedbackButton = (
    <FeedbackButton
      variant={collapsed ? "icon" : "sidebar"}
      className={collapsed ? "!size-9 !p-0" : "w-full"}
      side="right"
    />
  );

  const orgSwitcher = (
    <OrgSwitcher
      compact={collapsed}
      reserveSpace
      // Tasks does not mount /agent, so the default link would 404.
      agentPath={null}
      className={
        collapsed
          ? "!size-9 !p-0 [&>svg]:!size-4 !bg-transparent !text-primary hover:!bg-accent/60 hover:!text-primary"
          : "min-w-0 flex-1 !bg-transparent !text-primary hover:!bg-accent/60 hover:!text-primary"
      }
    />
  );

  return (
    <AppSidebar
      collapsed={collapsed}
      collapsible={collapsible}
      onCollapsedChange={onCollapsedChange}
      brandName={APP_TITLE}
      brandHref="/tasks"
      items={items}
      secondaryItems={secondaryItems}
      feedback={feedbackButton}
      orgSwitcher={orgSwitcher}
    />
  );
}
