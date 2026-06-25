import { AgentToggleButton, useT } from "@agent-native/core/client";
import { IconMenu2 } from "@tabler/icons-react";
import { useLocation } from "react-router";

import { useHeaderTitle, useHeaderActions } from "./HeaderActions";

const pageTitles: Record<string, string> = {
  "/": "header.entry",
  "/entry": "header.entry",
  "/analytics": "header.analytics",
  "/settings": "header.settings",
  "/extensions": "header.extensions",
};

function resolveTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith("/extensions")) return "header.extensions";
  return "header.macros";
}

interface HeaderProps {
  onOpenSidebar: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();
  const t = useT();

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:px-4">
      <button
        onClick={onOpenSidebar}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
        aria-label={t("sidebar.openMenu")}
      >
        <IconMenu2 className="h-5 w-5" />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {title ?? (
          <h1 className="truncate text-sm font-semibold text-foreground">
            {t(resolveTitle(location.pathname))}
          </h1>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <AgentToggleButton />
      </div>
    </header>
  );
}
