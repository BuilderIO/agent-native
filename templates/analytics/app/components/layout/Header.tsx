import { useAuth } from "@/components/auth/AuthProvider";
import { useLocation } from "react-router";
import { dashboards } from "@/pages/adhoc/registry";
import { useHeaderActions } from "./HeaderActions";

const pageTitles: Record<string, string> = {
  "/": "Overview",
  "/query": "Query Explorer",
  "/settings": "Settings",
};

function resolveTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];

  const adhocMatch = pathname.match(/^\/adhoc\/(.+)$/);
  if (adhocMatch) {
    const id = adhocMatch[1];
    const dash = dashboards.find((d) => d.id === id);
    return dash?.name || "Dashboard";
  }

  return "Dashboard";
}

export function Header() {
  const { auth } = useAuth();
  const location = useLocation();
  const title = resolveTitle(location.pathname);
  const { actions } = useHeaderActions();

  return (
    <header className="flex h-14 lg:h-[60px] items-center gap-4 border-b bg-background px-4 md:px-6">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <h1 className="font-semibold text-lg truncate">{title}</h1>
        <div className="hidden sm:flex items-center gap-2">{actions}</div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {auth && (
          <span className="text-sm text-muted-foreground hidden sm:inline truncate max-w-[200px]">
            {auth.email}
          </span>
        )}
      </div>
    </header>
  );
}
