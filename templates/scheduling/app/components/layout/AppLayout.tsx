import { Link, NavLink, useLocation } from "react-router";
import { useEffect } from "react";
import { writeAppState } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  IconCalendarEvent,
  IconCalendarTime,
  IconClock,
  IconUsersGroup,
  IconRoute,
  IconBolt,
  IconApps,
  IconSettings,
} from "@tabler/icons-react";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { ToolsSidebarSection } from "@agent-native/core/client/tools";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { to: "/event-types", label: "Event Types", icon: IconCalendarEvent },
  { to: "/bookings/upcoming", label: "Bookings", icon: IconCalendarTime },
  { to: "/availability", label: "Availability", icon: IconClock },
  { to: "/teams", label: "Teams", icon: IconUsersGroup },
  { to: "/routing-forms", label: "Routing Forms", icon: IconRoute },
  { to: "/workflows", label: "Workflows", icon: IconBolt },
  { to: "/apps", label: "Integrations", icon: IconApps },
  { to: "/settings/my-account/profile", label: "Settings", icon: IconSettings },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  useEffect(() => {
    const view = inferView(location.pathname);
    writeAppState("navigation", { view, path: location.pathname });
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar-background/50 px-2 py-3">
        <Link
          to="/"
          className="mx-1 mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold hover:bg-muted/60"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-background">
            <IconCalendarTime className="h-3.5 w-3.5" />
          </span>
          Scheduling
        </Link>
        <div className="mx-1 mb-3">
          <OrgSwitcher />
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm",
                    isActive
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-border/60 mx-1 pt-1">
          <ToolsSidebarSection />
        </div>
        <div className="mt-auto border-t border-border/60 pt-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

function inferView(pathname: string): string {
  if (pathname.startsWith("/event-types")) return "event-types";
  if (pathname.startsWith("/bookings")) return "bookings";
  if (pathname.startsWith("/availability")) return "availability";
  if (pathname.startsWith("/teams")) return "teams";
  if (pathname.startsWith("/routing-forms")) return "routing-forms";
  if (pathname.startsWith("/workflows")) return "workflows";
  if (pathname.startsWith("/apps")) return "apps";
  if (pathname.startsWith("/settings")) return "settings";
  return "home";
}
