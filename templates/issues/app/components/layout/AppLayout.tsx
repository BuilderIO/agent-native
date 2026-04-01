import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router";
import {
  IconCircleDot,
  IconFolder,
  IconLayoutGrid,
  IconSettings,
  IconChevronDown,
  IconChevronRight,
  IconSearch,
  IconPlus,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebar,
} from "@tabler/icons-react";
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";
import { cn } from "@/lib/utils";
import { useProjects } from "@/hooks/use-projects";
import { useBoards } from "@/hooks/use-boards";
import { useJiraAuthStatus } from "@/hooks/use-jira-auth";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { JiraConnectBanner } from "@/components/JiraConnectBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CommandPalette } from "./CommandPalette";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [boardsOpen, setBoardsOpen] = useState(true);
  const [cmdOpen, setCmdOpen] = useState(false);
  const { data: authStatus } = useJiraAuthStatus();
  const { data: projectsData } = useProjects();
  const { data: boardsData } = useBoards();
  const isConnected = authStatus?.connected;

  useNavigationState();

  // Cmd+K handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const projects = projectsData?.values || [];
  const boards = boardsData?.values || [];

  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Left sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r border-border bg-sidebar-background",
          sidebarCollapsed ? "w-12" : "w-56",
        )}
      >
        {/* Header */}
        <div className="flex h-12 items-center justify-between border-b border-border px-3">
          {!sidebarCollapsed && (
            <span className="text-sm font-semibold text-foreground">
              Issues
            </span>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {sidebarCollapsed ? (
              <IconLayoutSidebar className="h-4 w-4" />
            ) : (
              <IconLayoutSidebarLeftCollapse className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {/* My Issues */}
          <NavItem
            to="/my-issues"
            icon={<IconCircleDot className="h-4 w-4" />}
            label="My Issues"
            active={isActive("/my-issues")}
            collapsed={sidebarCollapsed}
          />

          {/* Projects */}
          {!sidebarCollapsed && (
            <div className="mt-4">
              <button
                onClick={() => setProjectsOpen(!projectsOpen)}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                {projectsOpen ? (
                  <IconChevronDown className="h-3 w-3" />
                ) : (
                  <IconChevronRight className="h-3 w-3" />
                )}
                Projects
              </button>
              {projectsOpen &&
                [...projects]
                  .sort((a: any, b: any) =>
                    (a.name || "").localeCompare(b.name || ""),
                  )
                  .map((p: any) => (
                    <NavItem
                      key={p.key}
                      to={`/projects/${p.key}`}
                      icon={<IconFolder className="h-4 w-4" />}
                      label={p.name}
                      active={isActive(`/projects/${p.key}`)}
                      collapsed={false}
                    />
                  ))}
            </div>
          )}

          {/* Boards */}
          {!sidebarCollapsed && (
            <div className="mt-4">
              <button
                onClick={() => setBoardsOpen(!boardsOpen)}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                {boardsOpen ? (
                  <IconChevronDown className="h-3 w-3" />
                ) : (
                  <IconChevronRight className="h-3 w-3" />
                )}
                Boards
              </button>
              {boardsOpen &&
                [...boards]
                  .sort((a: any, b: any) =>
                    (a.name || "").localeCompare(b.name || ""),
                  )
                  .map((b: any) => (
                    <NavItem
                      key={b.id}
                      to={
                        b.type === "scrum"
                          ? `/sprint/${b.id}`
                          : `/board/${b.id}`
                      }
                      icon={<IconLayoutGrid className="h-4 w-4" />}
                      label={b.name}
                      active={
                        isActive(`/board/${b.id}`) ||
                        isActive(`/sprint/${b.id}`)
                      }
                      collapsed={false}
                    />
                  ))}
            </div>
          )}
        </nav>

        {/* Bottom */}
        <div className="border-t border-border p-2">
          <NavItem
            to="/settings"
            icon={<IconSettings className="h-4 w-4" />}
            label="Settings"
            active={isActive("/settings")}
            collapsed={sidebarCollapsed}
          />
          <div className={cn("mt-1", sidebarCollapsed ? "px-0.5" : "px-1")}>
            <ThemeToggle collapsed={sidebarCollapsed} />
          </div>
        </div>
      </aside>

      <AgentSidebar>
        {/* Main content */}
        <main className="flex min-w-0 flex-1 overflow-hidden">
          {isConnected || isActive("/settings") ? (
            children
          ) : (
            <JiraConnectBanner />
          )}
        </main>
      </AgentSidebar>

      {/* Command palette */}
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}

function NavItem({
  to,
  icon,
  label,
  active,
  collapsed,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
      title={collapsed ? label : undefined}
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}
