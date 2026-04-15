import { useLocation } from "react-router";
import { dashboards } from "@/pages/adhoc/registry";
import { useHeaderTitle, useHeaderActions } from "./HeaderActions";
import { AgentToggleButton } from "@agent-native/core/client";

const pageTitles: Record<string, string> = {
  "/": "Overview",
  "/data-sources": "Data Sources",
  "/data-dictionary": "Data Dictionary",
  "/query": "Query Explorer",
  "/analyses": "Analyses",
  "/team": "Team",
  "/settings": "Settings",
  "/about": "About",
};

function resolveTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];

  const adhocMatch = pathname.match(/^\/adhoc\/(.+)$/);
  if (adhocMatch) {
    const id = adhocMatch[1];
    const dash = dashboards.find((d) => d.id === id);
    return dash?.name || "Dashboard";
  }

  if (pathname.startsWith("/analyses/")) return "Analyses";

  return "Analytics";
}

export function Header() {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <header className="hidden md:flex h-14 items-center gap-3 border-b border-border bg-background px-4 lg:h-[60px] lg:px-6 shrink-0">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {title ?? (
          <h1 className="text-lg font-semibold tracking-tight truncate">
            {resolveTitle(location.pathname)}
          </h1>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
      </div>
    </header>
  );
}
