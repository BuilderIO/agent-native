import { AgentToggleButton, useT } from "@agent-native/core/client";
import { IconMenu2 } from "@tabler/icons-react";
import { useLocation } from "react-router";

import { compositions } from "@/remotion/registry";

import { useHeaderTitle, useHeaderActions } from "./HeaderActions";

const pageTitleKeys: Record<string, string> = {
  "/": "header.videos",
  "/components": "header.components",
  "/design-systems": "header.designSystems",
  "/settings": "header.settings",
};

function resolveTitle(pathname: string, t: ReturnType<typeof useT>): string {
  if (pageTitleKeys[pathname]) return t(pageTitleKeys[pathname]);
  if (pathname.startsWith("/extensions")) return t("header.extensions");
  const studioMatch = pathname.match(/^\/c\/(.+)$/);
  if (studioMatch) {
    const id = studioMatch[1];
    if (id === "new") return t("header.newComposition");
    const comp = compositions.find((c) => c.id === id);
    return comp?.title || t("header.studio");
  }
  return t("header.videos");
}

interface HeaderProps {
  onOpenMobileSidebar?: () => void;
}

export function Header({ onOpenMobileSidebar }: HeaderProps) {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();
  const t = useT();

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
            {resolveTitle(location.pathname, t)}
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
