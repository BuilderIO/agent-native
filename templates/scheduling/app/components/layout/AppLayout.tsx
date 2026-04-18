import { Link, NavLink, useLocation } from "react-router";
import { useEffect } from "react";
import { writeAppState } from "@agent-native/core/application-state";
import { cn } from "@/lib/utils";
import {
  IconCalendarTime,
  IconCalendarEvent,
  IconClock,
  IconUsersGroup,
  IconRoute,
  IconRobot,
  IconApps,
  IconSettings,
} from "@tabler/icons-react";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { to: "/event-types", label: "Event Types", icon: IconCalendarEvent },
  { to: "/bookings/upcoming", label: "Bookings", icon: IconCalendarTime },
  { to: "/availability", label: "Availability", icon: IconClock },
  { to: "/teams", label: "Teams", icon: IconUsersGroup },
  { to: "/routing-forms", label: "Routing Forms", icon: IconRoute },
  { to: "/workflows", label: "Workflows", icon: IconRobot },
  { to: "/apps", label: "Apps", icon: IconApps },
  { to: "/settings/my-account/profile", label: "Settings", icon: IconSettings },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  useEffect(() => {
    // Mirror route → application_state.navigation so the agent can see the view.
    const view = inferView(location.pathname);
    writeAppState("navigation", { view, path: location.pathname });
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-60 flex-col border-r border-border bg-card/30 p-3">
        <Link to="/" className="mb-4 flex items-center gap-2 px-2 py-1">
          <IconCalendarTime className="h-5 w-5 text-[color:var(--brand-accent,#7c3aed)]" />
          <span className="text-sm font-semibold">Scheduling</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    isActive
                      ? "bg-muted font-medium"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center justify-between border-t border-border/60 pt-2">
          <ThemeToggle />
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
