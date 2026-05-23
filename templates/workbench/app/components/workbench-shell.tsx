import { Link, useLocation } from "react-router";
import {
  IconInbox,
  IconGitPullRequest,
  IconActivity,
  IconCode,
  IconLayoutGrid,
  IconSettings,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Top-nav layout for Workbench. Renders a slim header with the room tabs and
 * a Settings overflow, with `children` rendered below.
 *
 * Tabs (left → right): Queue (/), PRs (/prs), Runs (/runs), Tools (/extensions).
 * The Settings link sits on the right with a gear icon.
 *
 * The agent sidebar is mounted by `app/root.tsx` via core's `AgentSidebar`,
 * so this shell only owns the top-level chrome and the route surface.
 */
export function WorkbenchShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <WorkbenchTopNav />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: typeof IconInbox;
  /** Match function for active state. Defaults to exact pathname match. */
  matchPrefix?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Queue", icon: IconInbox },
  { to: "/prs", label: "PRs", icon: IconGitPullRequest, matchPrefix: "/prs" },
  { to: "/runs", label: "Runs", icon: IconActivity, matchPrefix: "/runs" },
  { to: "/code", label: "Code", icon: IconCode, matchPrefix: "/code" },
  {
    to: "/extensions",
    label: "Tools",
    icon: IconLayoutGrid,
    matchPrefix: "/extensions",
  },
];

function WorkbenchTopNav() {
  const { pathname } = useLocation();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-6">
        <Link
          to="/"
          className="text-sm font-semibold tracking-tight"
          aria-label="Workbench home"
        >
          Workbench
        </Link>
        <nav aria-label="Main">
          <ul className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={cn(
                      "inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <Icon size={16} aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              asChild
              className={cn(
                "size-8",
                pathname.startsWith("/settings") &&
                  "bg-accent text-accent-foreground",
              )}
            >
              <Link to="/settings" aria-label="Settings">
                <IconSettings size={16} />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPrefix) {
    return pathname === item.to || pathname.startsWith(`${item.matchPrefix}/`);
  }
  return pathname === item.to;
}
