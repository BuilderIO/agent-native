import { useLocation } from "react-router";
import { useHeaderTitle, useHeaderActions } from "./HeaderActions";
import { AgentToggleButton } from "@agent-native/core/client";

const pageTitles: Record<string, string> = {
  "/": "Library",
  "/library": "Library",
  "/archive": "Archive",
  "/trash": "Trash",
  "/trackers": "Trackers",
  "/notifications": "Notifications",
  "/settings": "Settings",
  "/upload": "Upload",
  "/search": "Search",
};

function resolveTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];

  if (pathname.startsWith("/calls/")) return "Call";
  if (pathname.startsWith("/library/folder/")) return "Folder";
  if (pathname.startsWith("/spaces/")) return "Space";
  if (pathname.startsWith("/views/")) return "Saved View";
  if (pathname.startsWith("/snippets/")) return "Snippet";
  if (pathname.startsWith("/tools")) return "Tools";

  return "Calls";
}

export function Header() {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-background px-4 lg:px-6 shrink-0">
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
