import { AgentToggleButton, useT } from "@agent-native/core/client";
import { useLocation } from "react-router";

import { useHeaderTitle, useHeaderActions } from "./HeaderActions";

const pageTitles: Record<string, string> = {
  "/": "header.forms",
  "/forms": "header.forms",
  "/settings": "header.settings",
};

function resolveTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];

  if (pathname.startsWith("/forms/") && pathname.endsWith("/responses")) {
    return "header.responses";
  }
  if (pathname.startsWith("/forms/")) return "header.form";
  if (pathname.startsWith("/extensions")) return "header.extensions";

  return "header.forms";
}

export function Header() {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();
  const t = useT();

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-background px-4 lg:px-6 shrink-0">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {title ?? (
          <h1 className="text-lg font-semibold tracking-tight truncate">
            {t(resolveTitle(location.pathname))}
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
