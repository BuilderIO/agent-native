import { appPath } from "@agent-native/core/client/api-path";
import { DevDatabaseLink } from "@agent-native/core/client/db-admin";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { openCommandMenu } from "@agent-native/core/client/navigation";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { FeedbackButton } from "@agent-native/core/client/ui";
import { SidebarFooterActions } from "@agent-native/toolkit/app-shell";
import {
  IconStack2,
  IconHierarchy2,
  IconPalette,
  IconSettings,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSearch,
} from "@tabler/icons-react";
import { Link, useLocation } from "react-router";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: IconStack2, labelKey: "navigation.decks", href: "/" },
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

interface SidebarProps {
  collapsed: boolean;
  /** Omit to hide the collapse/expand toggle (e.g. inside the mobile drawer,
   * where toggling the desktop preference is meaningless). */
  onToggleCollapsed?: () => void;
}

export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const location = useLocation();
  const t = useT();

  const isItemActive = (href: string) =>
    href === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(href);

  const collapseButton = onToggleCollapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={
            collapsed
              ? t("sidebar.expandSidebar")
              : t("sidebar.collapseSidebar")
          }
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
        >
          {collapsed ? (
            <IconLayoutSidebarLeftExpand className="h-4 w-4 rtl:-scale-x-100" />
          ) : (
            <IconLayoutSidebarLeftCollapse className="h-4 w-4 rtl:-scale-x-100" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
      </TooltipContent>
    </Tooltip>
  ) : null;
  const searchButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={openCommandMenu}
          aria-label={t("sidebar.search")}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
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
      className={collapsed ? "size-8" : "min-w-0"}
    />
  );

  if (collapsed) {
    return (
      <aside className="flex h-full w-12 shrink-0 flex-col items-center gap-1 overflow-hidden border-e border-border bg-sidebar py-2 text-sidebar-foreground transition-[width] duration-200 ease-out">
        <nav className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto pt-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = isItemActive(item.href);
            return (
              <Tooltip key={item.href} delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link
                    to={item.href}
                    aria-label={t(item.labelKey)}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-md transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{t(item.labelKey)}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
        <nav className="flex shrink-0 flex-col items-center gap-1 py-1">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <Tooltip key={item.href} delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link
                    to={item.href}
                    aria-label={t(item.labelKey)}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                      isItemActive(item.href) &&
                        "bg-sidebar-accent text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{t(item.labelKey)}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
        <SidebarFooterActions
          collapsed
          feedback={feedbackButton}
          translate={translateButton}
          search={searchButton}
          collapse={collapseButton}
        />
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-56 min-w-0 shrink-0 flex-col overflow-hidden border-e border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
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
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <nav className="space-y-1 px-2 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = isItemActive(item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto shrink-0">
          <nav className="space-y-1 px-2 py-1">
            {bottomNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = isItemActive(item.href);
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </nav>

          <div className="px-3 py-2">
            <OrgSwitcher />
          </div>

          <div className="px-3 py-2 empty:hidden">
            <DevDatabaseLink />
          </div>
          <SidebarFooterActions
            feedback={feedbackButton}
            translate={translateButton}
            search={searchButton}
            collapse={collapseButton}
            className="px-0 py-0"
          />
        </div>
      </div>
    </aside>
  );
}
