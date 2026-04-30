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

  if (pathname.startsWith("/tools")) return "Tools";

  return "Dispatch";
}

export function Header({ onOpenMobile }: { onOpenMobile?: () => void }) {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-4 lg:px-6">
      {onOpenMobile ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 md:hidden cursor-pointer"
          onClick={onOpenMobile}
        >
          <IconLayoutSidebar />
        </Button>
      ) : null}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <img
          src="/agent-native-icon-light.svg"
          alt=""
          aria-hidden="true"
          className="block h-4 w-auto shrink-0 dark:hidden"
        />
        <img
          src="/agent-native-icon-dark.svg"
          alt=""
          aria-hidden="true"
          className="hidden h-4 w-auto shrink-0 dark:block"
        />
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
