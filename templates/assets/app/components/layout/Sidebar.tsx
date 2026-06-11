import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  IconLayoutGrid,
  IconPhotoPlus,
  IconPalette,
  IconSettings,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconClipboardList,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  DevDatabaseLink,
  FeedbackButton,
  appPath,
  useActionQuery,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const baseNavItems = [
  { icon: IconPhotoPlus, label: "Create", href: "/" },
  { icon: IconLayoutGrid, label: "Library", href: "/library" },
  { icon: IconPalette, label: "Brand Kits", href: "/brand-kits" },
  { icon: IconSettings, label: "Settings", href: "/settings" },
];

const auditNavItem = {
  icon: IconClipboardList,
  label: "Audit log",
  href: "/audit",
};

const COLLAPSE_KEY = "assets.sidebar.collapsed";

export function Sidebar() {
  const location = useLocation();
  const { data: auditAdmin } = useActionQuery("is-audit-admin", {}, {
    refetchInterval: 30_000,
  } as any) as { data: { allowed?: boolean } | undefined };
  const navItems = auditAdmin?.allowed
    ? [...baseNavItems, auditNavItem]
    : baseNavItems;
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
        "flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground",
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
            <span className="text-sm font-semibold tracking-tight">Assets</span>
          </div>
        )}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <IconLayoutSidebarLeftExpand className="h-4 w-4" />
              ) : (
                <IconLayoutSidebarLeftCollapse className="h-4 w-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? "Expand sidebar" : "Collapse sidebar"}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <nav
          className={cn(
            "space-y-1 py-2",
            collapsed ? "flex flex-col items-center px-1.5" : "px-2",
          )}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? location.pathname === "/"
                : item.href === "/brand-kits"
                  ? location.pathname === "/brand-kits" ||
                    location.pathname.startsWith("/brand-kits/") ||
                    location.pathname.startsWith("/library/") ||
                    location.pathname.startsWith("/image/") ||
                    location.pathname.startsWith("/asset/")
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
                {!collapsed && item.label}
              </Link>
            );
            if (collapsed) {
              return (
                <Tooltip key={item.href} delayDuration={0}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            }
            return link;
          })}
        </nav>

        {!collapsed && (
          <div className="mt-auto shrink-0">
            <div className="border-t border-border px-2 py-1">
              <ExtensionsSidebarSection />
            </div>

            <div className="border-t border-border px-3 py-2">
              <OrgSwitcher />
            </div>

            <div className="border-t border-border px-3 py-2">
              <DevDatabaseLink />
              <FeedbackButton />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
