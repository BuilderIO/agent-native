import { DevDatabaseLink } from "@agent-native/core/client/db-admin";
import { useT } from "@agent-native/core/client/i18n";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  AppSidebar,
  FeedbackButton,
  type AppSidebarItemDefinition,
} from "@agent-native/core/client/ui";
import {
  IconComponents,
  IconPencil,
  IconSettings,
  IconTemplate,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";

const COLLAPSE_KEY = "design.sidebar.collapsed";

export function Sidebar() {
  const location = useLocation();
  const t = useT();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // localStorage unavailable / quota — ignore
    }
  }, [collapsed]);

  const items: AppSidebarItemDefinition[] = [
    {
      to: "/home",
      label: t("navigation.designs"),
      icon: IconPencil,
      active:
        location.pathname === "/home" || location.pathname.startsWith("/d/"),
    },
    {
      to: "/templates",
      label: t("navigation.templates"),
      icon: IconTemplate,
      active: location.pathname.startsWith("/templates"),
    },
    {
      to: "/design-systems",
      label: t("navigation.designSystems"),
      icon: IconComponents,
      active: location.pathname.startsWith("/design-systems"),
    },
  ];

  const secondaryItems: AppSidebarItemDefinition[] = [
    {
      to: "/settings",
      label: t("navigation.settings"),
      icon: IconSettings,
      active: location.pathname.startsWith("/settings"),
    },
  ];

  const feedbackButton = (
    <FeedbackButton variant={collapsed ? "icon" : "sidebar"} side="right" />
  );

  const orgSwitcher = <OrgSwitcher compact={collapsed} />;

  return (
    <AppSidebar
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
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
