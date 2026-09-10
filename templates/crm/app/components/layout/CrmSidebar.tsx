import { DevDatabaseLink } from "@agent-native/core/client/db-admin";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  AppSidebar,
  AppSidebarNavItem,
  AppSidebarSection,
  FeedbackButton,
  type AppSidebarItemDefinition,
} from "@agent-native/core/client/ui";
import {
  IconAlertTriangle,
  IconBuilding,
  IconChartBar,
  IconChecklist,
  IconLayoutBoard,
  IconLayoutDashboard,
  IconList,
  IconMessageCircle,
  IconPencilCheck,
  IconRoute,
  IconSettings,
  IconStar,
  IconTable,
  IconUsers,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  getCollapseStorage,
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from "./sidebar-collapse";
import {
  normalizeCrmLists,
  normalizeCrmSavedViews,
  savedViewHref,
  type CrmSidebarList,
  type CrmSidebarSavedView,
} from "./sidebar-lists";

const primaryNav = [
  {
    to: "/home",
    labelKey: "navigation.overview",
    icon: IconLayoutDashboard,
    end: true,
  },
  { to: "/accounts", labelKey: "navigation.accounts", icon: IconBuilding },
  { to: "/people", labelKey: "navigation.people", icon: IconUsers },
  {
    to: "/opportunities",
    labelKey: "navigation.opportunities",
    icon: IconRoute,
  },
  { to: "/lists", labelKey: "navigation.lists", icon: IconList },
  { to: "/tasks", labelKey: "navigation.tasks", icon: IconChecklist },
  { to: "/proposals", labelKey: "navigation.proposals", icon: IconPencilCheck },
  { to: "/dashboard", labelKey: "navigation.dashboard", icon: IconChartBar },
];

const footerNav = [
  { to: "/ask", labelKey: "navigation.askCrm", icon: IconMessageCircle },
  {
    to: "/settings/connections",
    labelKey: "navigation.connections",
    icon: IconSettings,
  },
];

export function CrmSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() =>
    readSidebarCollapsed(getCollapseStorage()),
  );

  useEffect(() => {
    writeSidebarCollapsed(getCollapseStorage(), collapsed);
  }, [collapsed]);

  const listsQuery = useActionQuery<unknown>(
    "list-crm-lists" as never,
    { limit: 50 } as never,
    { staleTime: 30_000, retry: false } as never,
  );
  const viewsQuery = useActionQuery<unknown>(
    "list-crm-saved-views" as never,
    { limit: 50 } as never,
    { staleTime: 30_000, retry: false } as never,
  );

  const lists: CrmSidebarList[] = normalizeCrmLists(listsQuery.data);
  const views: CrmSidebarSavedView[] = normalizeCrmSavedViews(viewsQuery.data);
  const favorites = views.filter((view) => view.pinned);
  const unpinnedViews = views.filter((view) => !view.pinned);
  const loadFailed = listsQuery.isError || viewsQuery.isError;
  const settled = !listsQuery.isPending && !viewsQuery.isPending;

  const items: AppSidebarItemDefinition[] = primaryNav.map((item) => ({
    to: item.to,
    label: t(item.labelKey),
    icon: item.icon,
    active: item.end
      ? location.pathname === "/home"
      : location.pathname.startsWith(item.to),
    onClick: onNavigate,
  }));

  const secondaryItems: AppSidebarItemDefinition[] = footerNav.map((item) => ({
    to: item.to,
    label: t(item.labelKey),
    icon: item.icon,
    active: location.pathname.startsWith(item.to),
    onClick: onNavigate,
  }));

  const feedbackButton = (
    <FeedbackButton variant={collapsed ? "icon" : "sidebar"} side="right" />
  );

  const orgSwitcher = <OrgSwitcher compact={collapsed} reserveSpace />;

  return (
    <AppSidebar
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      brandName="CRM"
      brandHref="/home"
      items={items}
      secondaryItems={secondaryItems}
      feedback={feedbackButton}
      orgSwitcher={orgSwitcher}
      footerExtras={<DevDatabaseLink />}
    >
      {favorites.length > 0 && (
        <AppSidebarSection title={t("navigation.favorites")}>
          {favorites.map((view) => (
            <AppSidebarNavItem
              key={`favorite-${view.id}`}
              to={savedViewHref(view)}
              label={view.name}
              icon={IconStar}
              onClick={onNavigate}
            />
          ))}
        </AppSidebarSection>
      )}

      <AppSidebarSection title={t("navigation.listsAndViews")}>
        {lists.map((list) => (
          <AppSidebarNavItem
            key={`list-${list.id}`}
            to={`/lists/${encodeURIComponent(list.id)}`}
            label={list.name}
            icon={IconList}
            onClick={onNavigate}
          />
        ))}
        {unpinnedViews.map((view) => (
          <AppSidebarNavItem
            key={`view-${view.id}`}
            to={savedViewHref(view)}
            label={view.name}
            icon={view.viewKind === "board" ? IconLayoutBoard : IconTable}
            onClick={onNavigate}
          />
        ))}
        {loadFailed ? (
          <div
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-destructive",
              collapsed && "justify-center px-0",
            )}
          >
            <IconAlertTriangle className="size-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  {t("navigation.listsLoadFailed")}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    void listsQuery.refetch();
                    void viewsQuery.refetch();
                  }}
                >
                  {t("navigation.retry")}
                </Button>
              </>
            )}
          </div>
        ) : settled &&
          lists.length === 0 &&
          unpinnedViews.length === 0 &&
          !collapsed ? (
          <p className="px-2 py-1 text-xs text-sidebar-foreground/50">
            {t("navigation.listsEmpty")}
          </p>
        ) : null}
      </AppSidebarSection>
    </AppSidebar>
  );
}
