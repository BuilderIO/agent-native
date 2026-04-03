import { useState, useCallback, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { OnboardingScreen } from "@/components/recruiting/OnboardingScreen";
import { CommandPalette } from "./CommandPalette";
import { useGreenhouseStatus } from "@/hooks/use-greenhouse";
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";
import {
  IconLayoutDashboard,
  IconBriefcase,
  IconUsers,
  IconCalendar,
  IconSettings,
  IconSearch,
  IconPlant2,
} from "@tabler/icons-react";

interface AppLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: IconLayoutDashboard,
    path: "/dashboard",
  },
  { id: "jobs", label: "Jobs", icon: IconBriefcase, path: "/jobs" },
  {
    id: "candidates",
    label: "Candidates",
    icon: IconUsers,
    path: "/candidates",
  },
  {
    id: "interviews",
    label: "Interviews",
    icon: IconCalendar,
    path: "/interviews",
  },
  { id: "settings", label: "Settings", icon: IconSettings, path: "/settings" },
];

export function AppLayout({ children }: AppLayoutProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { data: status, isLoading } = useGreenhouseStatus();

  const currentPath = location.pathname.split("/")[1] || "dashboard";

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+K always works, even in inputs
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      // Ignore other shortcuts if in input
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;

      if (e.key === "/") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // G+key sequence shortcuts
  useEffect(() => {
    let gPressed = false;
    let timeout: ReturnType<typeof setTimeout>;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;

      if (e.key === "g" && !gPressed) {
        gPressed = true;
        timeout = setTimeout(() => (gPressed = false), 500);
        return;
      }

      if (gPressed) {
        gPressed = false;
        clearTimeout(timeout);
        const map: Record<string, string> = {
          d: "/dashboard",
          j: "/jobs",
          c: "/candidates",
          i: "/interviews",
          s: "/settings",
        };
        if (map[e.key]) {
          e.preventDefault();
          navigate(map[e.key]);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      clearTimeout(timeout);
    };
  }, [navigate]);

  if (isLoading) return null;
  if (!status?.connected) return <OnboardingScreen />;

  return (
    <AgentSidebar
      position="right"
      defaultOpen={false}
      emptyStateText="Ask me anything about your recruiting pipeline"
      suggestions={[
        "Show me open jobs",
        "Who's in the pipeline?",
        "Summarize my dashboard",
      ]}
    >
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Sidebar */}
        <aside className="flex w-52 flex-col border-r border-border bg-sidebar-background">
          {/* Logo */}
          <div className="flex h-14 items-center gap-2.5 px-4 border-b border-border">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-600/10">
              <IconPlant2 className="h-4 w-4 text-green-600" />
            </div>
            <span className="text-sm font-semibold text-foreground">
              Recruiting
            </span>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-2 py-3 space-y-0.5">
            {navItems.map((item) => {
              const isActive =
                currentPath === item.id ||
                (item.id === "jobs" && currentPath === "jobs");
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Bottom */}
          <div className="flex items-center gap-1 border-t border-border px-3 py-2">
            <ThemeToggle />
          </div>
        </aside>

        {/* Main */}
        <main className="relative flex-1 overflow-auto">
          <div className="absolute right-3 top-3 z-10">
            <AgentToggleButton />
          </div>
          {children}
        </main>

        {/* Command palette */}
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </AgentSidebar>
  );
}
