import { useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router";
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
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { AgentSidebar, appPath } from "@agent-native/core/client";
import { ThemeToggle } from "./ThemeToggle";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";

// Routes whose page renders its own custom toolbar (with AgentToggleButton).
// Layout still mounts Sidebar + AgentSidebar, but skips its own Header so
// there's no double-header.
function isDetailRoute(pathname: string): boolean {
  if (/^\/event-types\/[^/]+/.test(pathname)) return true;
  if (/^\/availability\/[^/]+/.test(pathname)) return true;
  if (/^\/routing-forms\/[^/]+/.test(pathname)) return true;
  if (/^\/workflows\/[^/]+/.test(pathname)) return true;
  if (pathname === "/extensions" || pathname.startsWith("/extensions/"))
    return true;
  return false;
}

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

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  useEffect(() => {
    const view = inferView(location.pathname);
    writeAppState("navigation", { view, path: location.pathname });
  }, [location.pathname]);

  const showHeader = !isDetailRoute(location.pathname);

  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar-background/50 px-2 py-3">
          <Link
            to="/"
            className="mx-1 mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold hover:bg-muted/60"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-background">
              <img
                src={appPath("/agent-native-icon-light.svg")}
                alt=""
                aria-hidden="true"
                className="block h-3.5 w-auto shrink-0 dark:hidden"
              />
              <img
                src={appPath("/agent-native-icon-dark.svg")}
                alt=""
                aria-hidden="true"
                className="hidden h-3.5 w-auto shrink-0 dark:block"
              />
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
            <ExtensionsSidebarSection />
          </div>
          <div className="mt-auto border-t border-border/60 pt-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>
          </div>
        </aside>
        <AgentSidebar
          position="right"
          defaultOpen
          emptyStateText="Ask me anything about your scheduling"
          suggestions={[
            "Create a 30-minute intro call",
            "What's my availability tomorrow?",
            "Show my upcoming bookings",
          ]}
        >
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            {showHeader ? <Header /> : null}
            <main className="flex-1 overflow-auto">{children}</main>
          </div>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
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
