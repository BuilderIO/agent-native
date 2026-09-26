import { IconAlertTriangle, IconExternalLink } from "@tabler/icons-react";
import { useState } from "react";

import {
  isLocalDevelopmentOrigin,
  shouldOfferWorkspace,
} from "../../org/workspace-url.js";
import { useOrg } from "./hooks.js";
import { isWorkspaceAppEnvironment } from "./workspace-app-links.js";

const DISMISS_KEY_PREFIX = "agent-native:workspace-notice-dismissed:";

function dismissKey(workspaceUrl: string): string {
  return `${DISMISS_KEY_PREFIX}${workspaceUrl}`;
}

function readDismissed(workspaceUrl: string): boolean {
  try {
    return localStorage.getItem(dismissKey(workspaceUrl)) === "1";
  } catch {
    return false;
  }
}

export function WorkspaceNotice({ className }: { className?: string }) {
  const { data: org } = useOrg();
  const [dismissedNow, setDismissedNow] = useState(false);
  const workspaceUrl = org?.workspaceUrl ?? null;

  if (typeof window === "undefined") return null;
  if (
    isLocalDevelopmentOrigin(window.location.href) ||
    isWorkspaceAppEnvironment()
  ) {
    return null;
  }
  if (!workspaceUrl || dismissedNow || readDismissed(workspaceUrl)) return null;
  if (!shouldOfferWorkspace(window.location.href, workspaceUrl)) return null;

  const workspaceHost = new URL(workspaceUrl).host;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`border-b border-amber-500/30 bg-amber-500/10 px-3 py-3 text-amber-900 dark:text-amber-200 sm:px-4 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 text-sm">
        <IconAlertTriangle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <span className="min-w-0 flex-1 leading-5">
          <span className="font-medium">{org?.orgName}</span> has its own
          workspace at <span className="font-medium">{workspaceHost}</span>.
          Your team&apos;s apps live there, not here.
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={workspaceUrl}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-600 bg-amber-600 px-3 py-1.5 text-xs font-medium text-primary-foreground no-underline hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <IconExternalLink className="h-3 w-3" />
            Go there
          </a>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem(dismissKey(workspaceUrl), "1");
              } catch {
                // Private-mode storage failure only costs a repeat banner.
              }
              setDismissedNow(true);
            }}
            className="cursor-pointer rounded-md border border-amber-500/40 bg-background/60 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100 dark:hover:bg-amber-900/40"
          >
            Stay here
          </button>
        </div>
      </div>
    </div>
  );
}
