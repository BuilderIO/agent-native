import {
  DevDatabaseLink,
  FeedbackButton,
  appPath,
  useT,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  IconPencil,
  IconPalette,
  IconSettings,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
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
  {
    icon: IconPalette,
    labelKey: "navigation.designSystems",
    href: "/design-systems",
  },
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
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
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

        {!collapsed && (
          <div className="mt-auto shrink-0">
            <div className="px-2 py-1">
              <ExtensionsSidebarSection />
            </div>

            <div className="px-3 py-2">
              <OrgSwitcher reserveSpace />
            </div>

            <div className="px-3 py-2">
              <DevDatabaseLink />
              <div className="flex items-center gap-1">
                <FeedbackButton className="min-w-0 flex-1" />
                <ThemeToggle className="h-8 w-8 shrink-0" />
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
