import { DevDatabaseLink } from "@agent-native/core/client/db-admin";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { openCommandMenu } from "@agent-native/core/client/navigation";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { FeedbackButton } from "@agent-native/core/client/ui";
import { SidebarFooterActions } from "@agent-native/toolkit/app-shell";
import {
  IconAlertTriangle,
  IconBuilding,
  IconChartBar,
  IconChecklist,
  IconLayoutBoard,
  IconLayoutDashboard,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconList,
  IconMessageCircle,
  IconPencilCheck,
  IconRoute,
  IconSearch,
  IconSettings,
  IconStar,
  IconTable,
  IconUsers,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
    to: "/",
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

function itemClasses(isActive: boolean, collapsed: boolean) {
  return cn(
    "flex items-center rounded-md text-sm",
    collapsed ? "h-9 w-9 justify-center" : "h-8 gap-2 px-2",
    isActive
      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
  );
}

function CollapsibleTooltip({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean;
  label: string;
  children: React.ReactNode;
}) {
  if (!collapsed) return <>{children}</>;
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function SidebarSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 grid gap-0.5">
      <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/50">
        {heading}
      </p>
      {children}
    </div>
  );
}

function ListRow({
  to,
  label,
  icon: Icon,
  collapsed,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: typeof IconList;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <CollapsibleTooltip collapsed={collapsed} label={label}>
      <NavLink
        to={to}
        onClick={onNavigate}
        className={({ isActive }) => itemClasses(isActive, collapsed)}
      >
        <Icon className="size-4 shrink-0" />
        {!collapsed && <span className="truncate">{label}</span>}
      </NavLink>
    </CollapsibleTooltip>
  );
}

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
  // An action that has not shipped yet and one that failed are the same 404 to
  // the browser, so surface the failure instead of rendering an empty section.
  const loadFailed = listsQuery.isError || viewsQuery.isError;
  const settled = !listsQuery.isPending && !viewsQuery.isPending;

  const collapseButton = (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
          aria-label={
            collapsed
              ? t("navigation.expandSidebar")
              : t("navigation.collapseSidebar")
          }
        >
          {collapsed ? (
            <IconLayoutSidebarLeftExpand className="size-4 rtl:-scale-x-100" />
          ) : (
            <IconLayoutSidebarLeftCollapse className="size-4 rtl:-scale-x-100" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {collapsed
          ? t("navigation.expandSidebar")
          : t("navigation.collapseSidebar")}
      </TooltipContent>
    </Tooltip>
  );

  const searchButton = (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={openCommandMenu}
          className="flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
          aria-label={t("navigation.search")}
        >
          <IconSearch className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{t("navigation.search")}</TooltipContent>
    </Tooltip>
  );

  return (
    <TooltipProvider>
      <nav
        className={cn(
          "flex h-full shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar py-3 text-sidebar-foreground transition-[width] duration-200 ease-out",
          collapsed ? "w-14 px-1.5" : "w-60 px-2",
        )}
      >
        <div
          className={cn(
            "flex h-8 items-center text-sm font-semibold tracking-tight text-sidebar-primary",
            collapsed ? "justify-center" : "px-2",
          )}
        >
          {collapsed ? <IconLayoutBoard className="size-4" /> : "CRM"}
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-0.5">
            {primaryNav.map((item) => {
              const Icon = item.icon;
              const label = t(item.labelKey);
              const isActive = item.end
                ? location.pathname === "/"
                : location.pathname.startsWith(item.to);
              return (
                <CollapsibleTooltip
                  key={item.to}
                  collapsed={collapsed}
                  label={label}
                >
                  <Link
                    to={item.to}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={itemClasses(isActive, collapsed)}
                  >
                    <Icon className="size-4 shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </Link>
                </CollapsibleTooltip>
              );
            })}
          </div>

          {favorites.length > 0 && (
            <SidebarSection
              heading={collapsed ? "" : t("navigation.favorites")}
            >
              {favorites.map((view) => (
                <ListRow
                  key={`favorite-${view.id}`}
                  to={savedViewHref(view)}
                  label={view.name}
                  icon={IconStar}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              ))}
            </SidebarSection>
          )}

          <SidebarSection
            heading={collapsed ? "" : t("navigation.listsAndViews")}
          >
            {lists.map((list) => (
              <ListRow
                key={`list-${list.id}`}
                to={`/lists/${encodeURIComponent(list.id)}`}
                label={list.name}
                icon={IconList}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
            {unpinnedViews.map((view) => (
              <ListRow
                key={`view-${view.id}`}
                to={savedViewHref(view)}
                label={view.name}
                icon={view.viewKind === "board" ? IconLayoutBoard : IconTable}
                collapsed={collapsed}
                onNavigate={onNavigate}
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
          </SidebarSection>
        </div>

        <div className="mt-2 shrink-0 border-t border-sidebar-border pt-2">
          <div className="grid gap-0.5">
            {footerNav.map((item) => {
              const Icon = item.icon;
              const label = t(item.labelKey);
              const isActive = location.pathname.startsWith(item.to);
              return (
                <CollapsibleTooltip
                  key={item.to}
                  collapsed={collapsed}
                  label={label}
                >
                  <Link
                    to={item.to}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={itemClasses(isActive, collapsed)}
                  >
                    <Icon className="size-4 shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </Link>
                </CollapsibleTooltip>
              );
            })}
          </div>

          {!collapsed && (
            <div className="mt-2 grid gap-2 px-1">
              <OrgSwitcher reserveSpace />
              <DevDatabaseLink />
            </div>
          )}

          <SidebarFooterActions
            collapsed={collapsed}
            feedback={
              <FeedbackButton
                variant={collapsed ? "icon" : "sidebar"}
                side="right"
                className={collapsed ? "size-8" : "min-w-0"}
              />
            }
            search={searchButton}
            collapse={collapseButton}
          />
        </div>
      </nav>
    </TooltipProvider>
  );
}
