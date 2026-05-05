import { useLocation } from "react-router";
import { useHeaderTitle, useHeaderActions } from "./HeaderActions";
import {
  AgentToggleButton,
  NotificationsBell,
} from "@agent-native/core/client";

const pageTitles: Record<string, string> = {
  "/": "Content",
  "/team": "Team",
};

function resolveTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];

  if (pathname.startsWith("/page/")) return "Document";
  if (pathname.startsWith("/extensions")) return "Extensions";

  return "Content";
}

export function Header() {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-background px-4 lg:px-6 shrink-0">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {title ?? (
          <h1 className="text-lg font-semibold tracking-tight truncate">
            {resolveTitle(location.pathname)}
          </h1>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <NotificationsBell />
        <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
      </div>
    </header>
  );
}
