import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  IconPencil,
  IconPalette,
  IconLayoutGrid,
  IconSettings,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { ToolsSidebarSection } from "@agent-native/core/client/tools";
import { FeedbackButton } from "@agent-native/core/client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navItems = [
  { icon: IconPencil, label: "Designs", href: "/" },
  { icon: IconLayoutGrid, label: "Examples", href: "/examples" },
  { icon: IconPalette, label: "Design Systems", href: "/design-systems" },
  { icon: IconSettings, label: "Settings", href: "/settings" },
];

const COLLAPSE_KEY = "design.sidebar.collapsed";

export function Sidebar() {
  const location = useLocation();
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
        "flex h-full shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div
        className={cn(
          "flex h-12 items-center border-b border-border",
          collapsed ? "justify-center px-2" : "justify-between px-4",
        )}
      >
        {!collapsed && (
          <span className="text-sm font-semibold tracking-tight">Design</span>
        )}
        <Tooltip>
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

      <nav
        className={cn(
          "flex-1 overflow-y-auto py-2 space-y-1",
          collapsed ? "px-1.5" : "px-2",
        )}
      >
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
                collapsed
                  ? "h-9 w-9 justify-center"
                  : "gap-3 px-3 py-2",
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
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          }
          return link;
        })}
      </nav>

      {!collapsed && (
        <>
          <div className="border-t border-border px-2 py-2">
            <ToolsSidebarSection />
          </div>

          <div className="border-t border-border px-3 py-2">
            <FeedbackButton />
          </div>
        </>
      )}
    </aside>
  );
}
