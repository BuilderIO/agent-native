import { appPath } from "@agent-native/core/client/api-path";
import { DevDatabaseLink } from "@agent-native/core/client/db-admin";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { openCommandMenu } from "@agent-native/core/client/navigation";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { FeedbackButton } from "@agent-native/core/client/ui";
import { SidebarFooterActions } from "@agent-native/toolkit/app-shell";
import {
  IconPencil,
  IconTemplate,
  IconPalette,
  IconHierarchy2,
  IconSettings,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: IconPencil, labelKey: "navigation.designs", href: "/" },
  { icon: IconTemplate, labelKey: "navigation.templates", href: "/templates" },
  {
    icon: IconPalette,
    labelKey: "navigation.designSystems",
    href: "/design-systems",
  },
];

const bottomNavItems = [
  { icon: IconHierarchy2, labelKey: "settings.agentTitle", href: "/agent" },
  { icon: IconSettings, labelKey: "navigation.settings", href: "/settings" },
];

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

  const collapseButton = (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
          aria-label={
            collapsed
              ? t("navigation.expandSidebar")
              : t("navigation.collapseSidebar")
          }
        >
          {collapsed ? (
            <IconLayoutSidebarLeftExpand className="h-4 w-4 rtl:-scale-x-100" />
          ) : (
            <IconLayoutSidebarLeftCollapse className="h-4 w-4 rtl:-scale-x-100" />
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
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
          aria-label={t("sidebar.search")}
        >
          <IconSearch className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{t("sidebar.search")}</TooltipContent>
    </Tooltip>
  );
  const translateButton = (
    <LanguagePicker variant="ghost-icon" label={t("settings.languageLabel")} />
  );
  const feedbackButton = (
    <FeedbackButton
      variant={collapsed ? "icon" : "sidebar"}
      side="right"
      className={collapsed ? "h-8 w-8" : "min-w-0"}
    />
  );

  return (
    <aside
      className={cn(
        "flex h-full min-w-0 shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-2" : "justify-between px-4",
        )}
      >
        {!collapsed && (
          <div className="flex items-center gap-2">
            <img
              src={appPath("/agent-native-icon-light.svg")}
              alt=""
              aria-hidden="true"
              className="block h-4 w-auto dark:hidden"
            />
            <img
              src={appPath("/agent-native-icon-dark.svg")}
              alt=""
              aria-hidden="true"
              className="hidden h-4 w-auto dark:block"
            />
            <span className="text-sm font-semibold tracking-tight">
              {t("navigation.brand")}
            </span>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <nav className={cn("space-y-1 py-2", collapsed ? "px-1.5" : "px-2")}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? location.pathname === "/" ||
                  location.pathname.startsWith("/design/")
                : location.pathname.startsWith(item.href);
            const link = (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center rounded-lg text-sm",
                  collapsed ? "h-9 w-9 justify-center" : "gap-3 px-3 py-2",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && t(item.labelKey)}
              </Link>
            );
            if (collapsed) {
              return (
                <Tooltip key={item.href} delayDuration={0}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">
                    {t(item.labelKey)}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return link;
          })}
        </nav>

        <div className="mt-auto shrink-0">
          <nav
            className={cn(
              "grid gap-1",
              collapsed ? "justify-items-center px-1.5 py-1" : "px-2 py-1",
            )}
          >
            {bottomNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname.startsWith(item.href);
              const link = (
                <Link
                  to={item.href}
                  className={cn(
                    "flex items-center rounded-lg text-sm",
                    collapsed ? "h-9 w-9 justify-center" : "gap-3 px-3 py-2",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                  )}
                  aria-label={collapsed ? t(item.labelKey) : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && t(item.labelKey)}
                </Link>
              );
              return collapsed ? (
                <Tooltip key={item.href} delayDuration={0}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">
                    {t(item.labelKey)}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <div key={item.href}>{link}</div>
              );
            })}
          </nav>

          {!collapsed && (
            <div className="mt-auto shrink-0">
              <div className="px-3 py-2">
                <OrgSwitcher reserveSpace />
              </div>
              <div className="px-3 py-2">
                <DevDatabaseLink />
                <ThemeToggle className="h-8 w-8 shrink-0" />
              </div>
            </div>
          )}
        </div>
        <SidebarFooterActions
          collapsed={collapsed}
          feedback={feedbackButton}
          translate={translateButton}
          search={searchButton}
          collapse={collapseButton}
        />
      </div>
    </aside>
  );
}
