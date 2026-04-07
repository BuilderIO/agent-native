import { useState, useCallback, useEffect, useRef } from "react";
import { Link, useNavigate, useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { OnboardingScreen } from "@/components/recruiting/OnboardingScreen";
import { CommandPalette } from "./CommandPalette";
import { useGreenhouseStatus } from "@/hooks/use-greenhouse";
import { useOrg, useAcceptInvitation, useSwitchOrg } from "@/hooks/use-org";
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";
import {
  IconLayoutDashboard,
  IconBriefcase,
  IconUsers,
  IconCalendar,
  IconSettings,
  IconSearch,
  IconPlant2,
  IconAlertCircle,
  IconLoader2,
  IconBuilding,
  IconSelector,
  IconCheck,
  IconMenu2,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

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
  {
    id: "action-items",
    label: "Action Items",
    icon: IconAlertCircle,
    path: "/action-items",
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

function InvitationBanner() {
  const { data: org } = useOrg();
  const acceptInvitation = useAcceptInvitation();

  if (!org?.pendingInvitations?.length) return null;

  return (
    <div className="border-b border-border bg-blue-50 dark:bg-blue-950/30 px-3 py-2.5 sm:px-4">
      {org.pendingInvitations.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between gap-3 text-sm"
        >
          <span className="text-foreground">
            <span className="font-medium">{inv.invitedBy}</span> invited you to
            join <span className="font-medium">{inv.orgName}</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                try {
                  await acceptInvitation.mutateAsync(inv.id);
                  toast.success(`Joined ${inv.orgName}`);
                } catch (err: any) {
                  toast.error(err.message || "Failed to accept");
                }
              }}
              disabled={acceptInvitation.isPending}
              className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {acceptInvitation.isPending ? (
                <IconLoader2 className="h-3 w-3 animate-spin" />
              ) : (
                "Join"
              )}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function OrgSwitcher() {
  const { data: org } = useOrg();
  const switchOrg = useSwitchOrg();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!org?.orgId || !org.orgs || org.orgs.length < 2) return null;

  return (
    <div ref={ref} className="relative px-2 pb-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      >
        <IconBuilding className="h-4 w-4 flex-shrink-0" />
        <span className="truncate flex-1 text-left">{org.orgName}</span>
        <IconSelector className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
      </button>
      {open && (
        <div className="absolute left-2 right-2 bottom-full mb-1 z-50 rounded-md border border-border bg-popover shadow-md py-1">
          {org.orgs.map((o) => (
            <button
              key={o.orgId}
              onClick={async () => {
                if (o.orgId === org.orgId) {
                  setOpen(false);
                  return;
                }
                try {
                  await switchOrg.mutateAsync(o.orgId);
                  setOpen(false);
                  toast.success(`Switched to ${o.orgName}`);
                } catch (err: any) {
                  toast.error(err.message || "Failed to switch");
                }
              }}
              disabled={switchOrg.isPending}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[13px] text-foreground hover:bg-accent disabled:opacity-50"
            >
              <IconBuilding className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <span className="truncate flex-1 text-left">{o.orgName}</span>
              {o.orgId === org.orgId && (
                <IconCheck className="h-3.5 w-3.5 flex-shrink-0 text-green-600" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppLayout({ children }: AppLayoutProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { data: status, isLoading } = useGreenhouseStatus();

  const currentPath = location.pathname.split("/")[1] || "dashboard";

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

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
          a: "/action-items",
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
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-52 flex-col border-r border-border bg-sidebar-background md:static md:z-auto",
            sidebarOpen
              ? "translate-x-0"
              : "-translate-x-full md:translate-x-0",
          )}
        >
          <div className="flex h-14 items-center gap-2.5 px-4 border-b border-border">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-600/10">
              <IconPlant2 className="h-4 w-4 text-green-600" />
            </div>
            <span className="text-sm font-semibold text-foreground">
              Recruiting
            </span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:hidden"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>

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
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium",
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

          <OrgSwitcher />

          <div className="flex items-center gap-1 border-t border-border px-3 py-2">
            <ThemeToggle />
          </div>
        </aside>

        <main className="relative flex-1 overflow-auto">
          <InvitationBanner />
          <div className="absolute left-3 top-3 z-10 md:hidden">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
            >
              <IconMenu2 className="h-4 w-4" />
            </button>
          </div>
          <div className="absolute right-3 top-3 z-10">
            <AgentToggleButton />
          </div>
          {children}
        </main>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </AgentSidebar>
  );
}
