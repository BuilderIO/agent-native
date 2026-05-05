import { useLocation } from "react-router";
import { IconMenu2 } from "@tabler/icons-react";
import { AgentToggleButton } from "@agent-native/core/client";
import { useHeaderTitle, useHeaderActions } from "./HeaderActions";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/action-items": "Action Items",
  "/jobs": "Jobs",
  "/candidates": "Candidates",
  "/interviews": "Interviews",
  "/settings": "Settings",
  "/team": "Team",
  "/extensions": "Extensions",
};

function resolveTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith("/jobs")) return "Jobs";
  if (pathname.startsWith("/candidates")) return "Candidates";
  if (pathname.startsWith("/interviews")) return "Interviews";
  if (pathname.startsWith("/extensions")) return "Extensions";
  return "Recruiting";
}

interface HeaderProps {
  onOpenSidebar: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:px-4">
      <button
        onClick={onOpenSidebar}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
        aria-label="Open menu"
      >
        <IconMenu2 className="h-5 w-5" />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {title ?? (
          <h1 className="truncate text-sm font-semibold text-foreground">
            {resolveTitle(location.pathname)}
          </h1>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
      </div>
    </header>
  );
}
