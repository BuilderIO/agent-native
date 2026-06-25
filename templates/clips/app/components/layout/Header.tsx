import { AgentToggleButton, useT } from "@agent-native/core/client";
import { useLocation } from "react-router";

import { useHeaderTitle, useHeaderActions } from "./HeaderActions";

const pageTitleKeys: Record<string, string> = {
  "/": "navigation.library",
  "/library": "navigation.library",
  "/spaces": "navigation.spaces",
  "/archive": "navigation.archive",
  "/trash": "navigation.trash",
  "/notifications": "navigation.notifications",
  "/insights": "navigation.insights",
};

function resolveTitle(pathname: string, t: ReturnType<typeof useT>): string {
  if (pageTitleKeys[pathname]) return t(pageTitleKeys[pathname]);

  if (pathname.startsWith("/spaces/")) return t("navigation.space");
  if (pathname.startsWith("/library/folder/")) return t("navigation.folder");
  if (pathname.startsWith("/settings")) return t("navigation.settings");
  if (pathname.startsWith("/extensions")) return t("navigation.extensions");

  return t("navigation.brand");
}

export function Header() {
  const location = useLocation();
  const t = useT();
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-background px-4 lg:px-6 shrink-0">
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
