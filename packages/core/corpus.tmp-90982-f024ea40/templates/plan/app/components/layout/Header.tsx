import { AgentToggleButton, useT } from "@agent-native/core/client";
import {
  useHeaderTitle,
  useHeaderActions,
} from "@agent-native/toolkit/app-shell";
import { IconMenu2 } from "@tabler/icons-react";
import { useLocation } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

const pageTitleKeys: Record<string, string> = {
  "/": "header.plan",
  "/plans": "header.plan",
  "/settings": "header.settings",
};

function resolveTitle(pathname: string): string {
  if (pageTitleKeys[pathname]) return pageTitleKeys[pathname];
  if (pathname.startsWith("/plans")) return "header.plan";
  if (pathname.startsWith("/extensions")) return "header.extensions";
  return "header.appTitle";
}

interface HeaderProps {
  onOpenMobileSidebar?: () => void;
}

export function Header({ onOpenMobileSidebar }: HeaderProps) {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();
  const t = useT();
  const resolvedTitle = resolveTitle(location.pathname);

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-background px-4 lg:px-6 shrink-0">
      {onOpenMobileSidebar && (
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          aria-label={t("sidebar.openNavigation")}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent md:hidden"
        >
          <IconMenu2 className="h-4 w-4" />
        </button>
      )}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {title ?? (
          <h1 className="text-lg font-semibold tracking-tight truncate">
            {resolvedTitle === "header.appTitle" ? APP_TITLE : t(resolvedTitle)}
          </h1>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <AgentToggleButton />
      </div>
    </header>
  );
}
