import {
  DevDatabaseLink,
  FeedbackButton,
  appPath,
  useT,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  IconVideo,
  IconComponents,
  IconPalette,
  IconSettings,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from "@tabler/icons-react";
import { Link, useLocation } from "react-router";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: IconVideo, labelKey: "navigation.animations", href: "/" },
  {
    icon: IconComponents,
    labelKey: "navigation.components",
    href: "/components",
  },
  {
    icon: IconPalette,
    labelKey: "navigation.designSystems",
    href: "/design-systems",
  },
  { icon: IconSettings, labelKey: "navigation.settings", href: "/settings" },
];

interface NavSidebarProps {
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function NavSidebar({
  collapsed = false,
  collapsible = true,
  onCollapsedChange,
}: NavSidebarProps) {
  const location = useLocation();
  const t = useT();

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-e border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
        collapsed ? "w-12" : "w-56",
      )}
    >
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-1" : "gap-2 px-4",
        )}
      >
        {!collapsed && (
          <>
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
            <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
              {t("navigation.brand")}
            </span>
          </>
        )}
        {collapsible && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onCollapsedChange?.(!collapsed)}
                aria-label={
                  collapsed
                    ? t("sidebar.expandSidebar")
                    : t("sidebar.collapseSidebar")
                }
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
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
                ? t("sidebar.expandSidebar")
                : t("sidebar.collapseSidebar")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <nav
        className={cn(
          "flex-1 overflow-y-auto py-2",
          collapsed
            ? "flex flex-col items-center gap-1 px-1"
            : "space-y-1 px-2",
        )}
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? !location.pathname.startsWith("/components") &&
                !location.pathname.startsWith("/design-systems") &&
                !location.pathname.startsWith("/settings") &&
                !location.pathname.startsWith("/extensions")
              : location.pathname.startsWith(item.href);
          const link = (
            <Link
              key={item.href}
              to={item.href}
              aria-label={collapsed ? t(item.labelKey) : undefined}
              className={cn(
                "flex items-center rounded-lg text-sm transition-colors",
                collapsed ? "h-10 w-10 justify-center" : "gap-3 px-3 py-2",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {collapsed ? (
                <span className="sr-only">{t(item.labelKey)}</span>
              ) : (
                t(item.labelKey)
              )}
            </Link>
          );
          if (!collapsed) return link;
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{t(item.labelKey)}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="px-2 py-2">
          <ExtensionsSidebarSection />
        </div>
      )}

      {!collapsed && (
        <div className="space-y-2 px-3 py-2">
          <DevDatabaseLink />
          <FeedbackButton />
          <OrgSwitcher />
        </div>
      )}
    </aside>
  );
}
