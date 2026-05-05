import { useLocation } from "react-router";
import { useHeaderTitle, useHeaderActions } from "./HeaderActions";
import { AgentToggleButton } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { IconLayoutSidebar } from "@tabler/icons-react";

const pageTitles: Record<string, string> = {
  "/": "Overview",
  "/overview": "Overview",
  "/vault": "Vault",
  "/integrations": "Integrations",
  "/workspace": "Resources",
  "/messaging": "Messaging",
  "/agents": "Agents",
  "/destinations": "Destinations",
  "/identities": "Identities",
  "/approvals": "Approvals",
  "/audit": "Audit",
  "/team": "Team",
};

function resolveTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];

  if (pathname.startsWith("/extensions")) return "Extensions";

  return "Dispatch";
}

export function Header({
  onOpenMobile,
  showAgentToggle = true,
}: {
  onOpenMobile?: () => void;
  showAgentToggle?: boolean;
}) {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-4 lg:px-6">
      {onOpenMobile ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 2xl:hidden cursor-pointer"
          onClick={onOpenMobile}
          aria-label="Open navigation"
        >
          <IconLayoutSidebar />
        </Button>
      ) : null}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {title ?? (
          <h1 className="text-lg font-semibold tracking-tight truncate">
            {resolveTitle(location.pathname)}
          </h1>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {showAgentToggle ? (
          <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
        ) : null}
      </div>
    </header>
  );
}
