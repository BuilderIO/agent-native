import { useLocation } from "react-router";
import { IconLayoutSidebar } from "@tabler/icons-react";
import { AgentToggleButton } from "@agent-native/core/client";
import { useHeaderTitle, useHeaderActions } from "./HeaderActions";

const pageTitles: Record<string, string> = {
  "/team": "Team",
  "/settings": "Settings",
  "/extensions": "Tools",
};

function resolveTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith("/extensions")) return "Tools";
  if (pathname.startsWith("/my-issues")) return "My Issues";
  if (pathname.startsWith("/projects")) return "Projects";
  if (pathname.startsWith("/board")) return "Board";
  if (pathname.startsWith("/sprint")) return "Sprint";
  return "Issues";
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
        <IconLayoutSidebar className="h-5 w-5" />
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
