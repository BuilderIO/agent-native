import { AgentToggleButton } from "@agent-native/core/client";
import { useT } from "@agent-native/core/client";
import { RunsTray } from "@agent-native/core/client/progress";
import type { ReactNode } from "react";
import { useLocation } from "react-router";

import { dashboards } from "@/pages/adhoc/registry";

import {
  DashboardTitleSkeleton,
  useHeaderTitle,
  useHeaderActions,
} from "./HeaderActions";

const pageTitleKeys: Record<string, string> = {
  "/": "navigation.overview",
  "/data-sources": "navigation.dataSources",
  "/data-dictionary": "navigation.dataDictionary",
  "/catalog": "navigation.templateCatalog",
  "/analyses": "navigation.analyses",
  "/dashboards/explorer": "navigation.explorer",
  "/team": "navigation.team",
  "/settings": "navigation.settings",
};

function resolveTitle(pathname: string, t: (key: string) => string): ReactNode {
  if (pageTitleKeys[pathname]) return t(pageTitleKeys[pathname]);

  const adhocMatch = pathname.match(/^\/(?:adhoc|dashboards)\/(.+)$/);
  if (adhocMatch) {
    const id = adhocMatch[1];
    const dash = dashboards.find((d) => d.id === id);
    return dash?.name || <DashboardTitleSkeleton />;
  }

  if (pathname.startsWith("/analyses/")) return t("navigation.analyses");

  return t("navigation.brand");
}

export function Header() {
  const location = useLocation();
  const t = useT();
  const title = useHeaderTitle();
  const actions = useHeaderActions();
  const fallbackTitle = resolveTitle(location.pathname, t);

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-background px-4 lg:px-6 shrink-0">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {title ??
          (typeof fallbackTitle === "string" ? (
            <h1 className="text-lg font-semibold tracking-tight truncate">
              {fallbackTitle}
            </h1>
          ) : (
            fallbackTitle
          ))}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <RunsTray pollMs={1500} />
        <AgentToggleButton />
      </div>
    </header>
  );
}
