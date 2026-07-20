import { AgentToggleButton, useT } from "@agent-native/core/client";
import { IconMenu2 } from "@tabler/icons-react";
import { useLocation } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

import { useHeaderTitle, useHeaderActions } from "./HeaderActions";

type Translate = ReturnType<typeof useT>;

function resolveTitle(t: Translate, pathname: string): string {
  if (pathname === "/tasks") return t("header.pageTasks");
  if (pathname === "/settings") return t("header.pageSettings");
  if (pathname === "/team") return t("header.pageTeam");
  if (pathname.startsWith("/extensions")) return t("header.pageExtensions");
  return APP_TITLE;
}

interface HeaderProps {
  onOpenMobileSidebar?: () => void;
}

export function Header({ onOpenMobileSidebar }: HeaderProps) {
  const t = useT();
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-background px-4 lg:px-6 shrink-0">
      {onOpenMobileSidebar && (
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          aria-label={t("header.openNavigation")}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent md:hidden"
        >
          <IconMenu2 className="h-4 w-4" />
        </button>
      )}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {title ?? (
          <h1 className="text-lg font-semibold tracking-tight truncate">
            {resolveTitle(t, location.pathname)}
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
