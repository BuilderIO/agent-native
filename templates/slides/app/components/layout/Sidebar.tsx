import { useT } from "@agent-native/core/client/i18n";
import { DevDatabaseLink } from "@agent-native/toolkit/app/db-admin";
import { FeedbackButton } from "@agent-native/toolkit/app/feedback";
import { OrgSwitcher } from "@agent-native/toolkit/app/org";
import { openCommandMenu } from "@agent-native/toolkit/app/shared";
import {
  AppSidebar,
  type AppSidebarItemDefinition,
} from "@agent-native/toolkit/app/shared";
import {
  IconLayoutGrid,
  IconComponents,
  IconSearch,
  IconTemplate,
} from "@tabler/icons-react";
import { useLocation } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
      to: "/templates",
      label: t("templatesPage.title"),
      icon: IconTemplate,
      active: isItemActive("/templates"),
    },
    {
      to: "/design-systems",
      label: t("navigation.designSystems"),
      icon: IconComponents,
      active: isItemActive("/design-systems"),
    },
  ];

  const feedbackButton = (
    <FeedbackButton variant={collapsed ? "icon" : "sidebar"} side="right" />
  );

  const orgSwitcher = <OrgSwitcher compact={collapsed} />;

  const searchButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-primary hover:bg-accent/60 hover:text-primary"
          onClick={openCommandMenu}
          aria-label={t("root.searchDecks")}
        >
          <IconSearch className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{t("root.searchDecks")}</TooltipContent>
    </Tooltip>
  );

  return (
    <AppSidebar
      collapsed={collapsed}
      collapsible={Boolean(onToggleCollapsed)}
      onCollapsedChange={onToggleCollapsed}
      brandName={t("navigation.brand")}
      appId="slides"
      brandHref="/home"
      items={items}
      feedback={feedbackButton}
      orgSwitcher={orgSwitcher}
      footerExtras={
        <>
          {searchButton}
          <DevDatabaseLink />
        </>
      }
    />
  );
}
