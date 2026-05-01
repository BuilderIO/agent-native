import { useLocation } from "react-router";
import type { ReactNode } from "react";
import { dashboards } from "@/pages/adhoc/registry";
import {
  DashboardTitleSkeleton,
  useHeaderTitle,
  useHeaderActions,
} from "./HeaderActions";
import { AgentToggleButton } from "@agent-native/core/client";

const pageTitles: Record<string, string> = {
  "/": "Overview",
  "/data-sources": "Data Sources",
  "/data-dictionary": "Data Dictionary",
  "/analyses": "Analyses",
  "/adhoc/explorer": "Explorer",
  "/team": "Team",
  "/settings": "Settings",
  "/about": "About",
};

function resolveTitle(pathname: string): ReactNode {
  if (pageTitles[pathname]) return pageTitles[pathname];

  const adhocMatch = pathname.match(/^\/adhoc\/(.+)$/);
  if (adhocMatch) {
    const id = adhocMatch[1];
    const dash = dashboards.find((d) => d.id === id);
    return dash?.name || <DashboardTitleSkeleton />;
  }

  if (pathname.startsWith("/analyses/")) return "Analyses";

  return "Analytics";
}

export function Header() {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();
  const fallbackTitle = resolveTitle(location.pathname);

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
        <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
      </div>
    </header>
  );
}
