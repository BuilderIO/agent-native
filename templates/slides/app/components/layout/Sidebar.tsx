import { DevDatabaseLink } from "@agent-native/core/client/db-admin";
import { useT } from "@agent-native/core/client/i18n";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  AppSidebar,
  FeedbackButton,
  type AppSidebarItemDefinition,
} from "@agent-native/core/client/ui";
import {
  IconLayoutGrid,
  IconComponents,
  IconSettings,
} from "@tabler/icons-react";
import { useLocation } from "react-router";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
}

export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const location = useLocation();
  const t = useT();

  const isItemActive = (href: string) =>
    href === "/home"
      ? location.pathname === "/home"
      : location.pathname.startsWith(href);

  const items: AppSidebarItemDefinition[] = [
    {
      to: "/home",
      label: t("navigation.decks"),
      icon: IconLayoutGrid,
      active: isItemActive("/home"),
    },
    {
      to: "/design-systems",
      label: t("navigation.designSystems"),
      icon: IconComponents,
      active: isItemActive("/design-systems"),
    },
  ];

  const secondaryItems: AppSidebarItemDefinition[] = [
    {
      to: "/settings",
      label: t("navigation.settings"),
      icon: IconSettings,
      active: isItemActive("/settings"),
    },
  ];

  const feedbackButton = (
    <FeedbackButton variant={collapsed ? "icon" : "sidebar"} side="right" />
  );

  const orgSwitcher = <OrgSwitcher compact={collapsed} />;

  return (
    <AppSidebar
      collapsed={collapsed}
      collapsible={Boolean(onToggleCollapsed)}
      onCollapsedChange={onToggleCollapsed}
      brandName={t("navigation.brand")}
      brandHref="/home"
      items={items}
      secondaryItems={secondaryItems}
      feedback={feedbackButton}
      orgSwitcher={orgSwitcher}
      footerExtras={<DevDatabaseLink />}
    />
  );
}
