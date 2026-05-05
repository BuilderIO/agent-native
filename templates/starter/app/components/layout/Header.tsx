import { useLocation } from "react-router";
import { IconMenu2 } from "@tabler/icons-react";
import { useHeaderTitle, useHeaderActions } from "./HeaderActions";
import { AgentToggleButton } from "@agent-native/core/client";

const pageTitles: Record<string, string> = {
  "/": "Home",
  "/observability": "Observability",
  "/settings": "Settings",
  "/team": "Team",
};

function resolveTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith("/extensions")) return "Tools";
  return "Starter";
}

interface HeaderProps {
  onOpenMobileSidebar?: () => void;
}

export function Header({ onOpenMobileSidebar }: HeaderProps) {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-background px-4 lg:px-6 shrink-0">
      {onOpenMobileSidebar && (
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          aria-label="Open navigation"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent md:hidden"
        >
          <IconMenu2 className="h-4 w-4" />
        </button>
      )}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {title ?? (
          <h1 className="text-lg font-semibold tracking-tight truncate">
            {resolveTitle(location.pathname)}
          </h1>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
      </div>
    </header>
  );
}
