import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { FeedbackButton } from "@agent-native/core/client/ui";
import {
  IconCheckbox,
  IconForms,
  IconInbox,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSettings,
} from "@tabler/icons-react";
import { Link, useLocation } from "react-router";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { icon: IconInbox, labelKey: "sidebar.navInbox", href: "/inbox" },
  { icon: IconCheckbox, labelKey: "sidebar.navTasks", href: "/tasks" },
  { icon: IconForms, labelKey: "sidebar.navFields", href: "/fields" },
];

const BOTTOM_NAV_ITEMS = [
  { icon: IconSettings, labelKey: "header.pageSettings", href: "/settings" },
];

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
  const ToggleIcon = collapsed
    ? IconLayoutSidebarLeftExpand
    : IconLayoutSidebarLeftCollapse;
  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center text-sm transition-colors",
      collapsed
        ? "relative h-10 w-full justify-center rounded-none border-l-2 px-0"
        : "h-9 rounded-md gap-3 px-3",
      isActive
        ? collapsed
          ? "border-l-sidebar-accent-foreground/80 bg-sidebar-accent text-sidebar-accent-foreground"
          : "bg-sidebar-accent text-sidebar-accent-foreground"
        : collapsed
          ? "border-l-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
    );
  const collapseButton = collapsible ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onCollapsedChange?.(!collapsed)}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed ? "size-8" : "size-7",
          )}
          aria-label={
            collapsed
              ? t("sidebar.expandSidebar")
              : t("sidebar.collapseSidebar")
          }
        >
          <ToggleIcon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
      </TooltipContent>
    </Tooltip>
  ) : null;

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150",
        collapsed ? "w-12" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center border-b border-sidebar-border",
          collapsed ? "h-12 justify-center px-0" : "h-14 px-3",
        )}
      >
        <Link
          to="/tasks"
          className={cn(
            "flex min-w-0 items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed ? "size-7 justify-center" : "flex-1 gap-3",
          )}
          aria-label={collapsed ? APP_TITLE : undefined}
        >
          <img
            src={appPath("/agent-native-icon-light.svg")}
            alt=""
            aria-hidden="true"
            className="block h-4 w-auto shrink-0 dark:hidden"
          />
          <img
            src={appPath("/agent-native-icon-dark.svg")}
            alt=""
            aria-hidden="true"
            className="hidden h-4 w-auto shrink-0 dark:block"
          />
          <div className={cn("min-w-0", collapsed && "sr-only")}>
            <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">
              {APP_TITLE}
            </p>
          </div>
        </Link>
      </div>

      <nav
        className={cn(
          "flex-1 overflow-y-auto",
          collapsed ? "px-0 py-2" : "px-2 py-3",
        )}
      >
        <div className={cn("grid", collapsed ? "gap-0" : "gap-1")}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.href);
            const label = t(item.labelKey);
            const link = (
              <Link
                to={item.href}
                className={navClass({ isActive })}
                aria-current={isActive ? "page" : undefined}
                aria-label={collapsed ? label : undefined}
              >
                <Icon className="size-4 shrink-0" />
                <span className={collapsed ? "sr-only" : "truncate"}>
                  {label}
                </span>
              </Link>
            );
            return collapsed ? (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            ) : (
              <div key={item.href}>{link}</div>
            );
          })}
        </div>
      </nav>

      <div
        className={cn(
          "mt-auto shrink-0",
          collapsed && "border-t border-sidebar-border py-2",
        )}
      >
        <nav
          className={cn(
            "grid gap-1",
            collapsed
              ? "px-1 py-1"
              : "border-t border-sidebar-border px-3 py-2",
          )}
        >
          {BOTTOM_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                aria-label={collapsed ? t(item.labelKey) : undefined}
                className={cn(
                  "flex items-center rounded-md text-sm",
                  collapsed ? "h-9 justify-center px-0" : "gap-3 px-3 py-2",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className={collapsed ? "sr-only" : "truncate"}>
                  {t(item.labelKey)}
                </span>
              </Link>
            );
          })}
        </nav>

        <div
          className={cn(
            collapsed
              ? "px-1 py-1"
              : "border-t border-sidebar-border px-3 py-2",
          )}
        >
          <OrgSwitcher
            reserveSpace
            className={
              collapsed
                ? "h-8 justify-center px-0 [&>span]:sr-only [&>svg:last-child]:hidden"
                : undefined
            }
          />
        </div>

        {!collapsed ? (
          <div className="flex items-center justify-end gap-1 border-t border-sidebar-border px-3 py-2">
            <FeedbackButton className="min-w-0 flex-1" side="right" />
            {collapseButton}
          </div>
        ) : collapseButton ? (
          <div className="flex justify-center px-1 py-1">{collapseButton}</div>
        ) : null}
      </div>
    </aside>
  );
}
