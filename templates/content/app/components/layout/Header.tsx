import {
  AgentToggleButton,
  NotificationsBell,
} from "@agent-native/core/client";
import {
  useHeaderTitle,
  useHeaderActions,
} from "@agent-native/toolkit/app-shell";
import type { ReactNode } from "react";
import { useLocation } from "react-router";

const pageTitles: Record<string, string> = {
  "/": "Content",
};

function resolveTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];

  if (pathname.startsWith("/page/")) return "Document";
  if (pathname.startsWith("/extensions")) return "Extensions";

  return "Content";
}

interface HeaderProps {
  sidebarTrigger?: ReactNode;
}

export function Header({ sidebarTrigger }: HeaderProps) {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-4 lg:px-6">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {sidebarTrigger}
        {title ?? (
          <h1 className="text-lg font-semibold tracking-tight truncate">
            {resolveTitle(location.pathname)}
          </h1>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <NotificationsBell />
        <AgentToggleButton />
      </div>
    </header>
  );
}
