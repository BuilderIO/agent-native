import { IconArrowRight, IconUser, IconUsersGroup } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { cn } from "../utils.js";

export interface IntegrationConnectionChoiceProps {
  name: string;
  description?: string;
  logo?: ReactNode;
  showWorkspaceOption: boolean;
  busy?: boolean;
  onPersonal: () => void;
  onWorkspace: () => void;
}

/** The one small decision before an integration's advanced setup surface. */
export function IntegrationConnectionChoice({
  name,
  description,
  logo,
  showWorkspaceOption,
  busy = false,
  onPersonal,
  onWorkspace,
}: IntegrationConnectionChoiceProps) {
  return (
    <div className="space-y-5 px-6 py-6">
      <div className="flex items-center gap-3">
        {logo ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-foreground">
            {logo}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-[-0.02em] text-foreground">
            Connect {name}
          </h2>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        <button
          type="button"
          onClick={onPersonal}
          disabled={busy}
          className="group flex min-h-14 items-center gap-3 rounded-lg border border-border bg-background px-3.5 py-3 text-left transition-colors hover:border-foreground/25 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
        >
          <IconUser className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">
              Connect for me
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Only you can use this connection.
            </span>
          </span>
          <IconArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" />
        </button>

        {showWorkspaceOption ? (
          <button
            type="button"
            onClick={onWorkspace}
            disabled={busy}
            className={cn(
              "group flex min-h-14 items-center gap-3 rounded-lg border border-border bg-background px-3.5 py-3 text-left transition-colors hover:border-foreground/25 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60",
            )}
          >
            <IconUsersGroup className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">
                Set up for workspace
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Share it with the apps you choose.
              </span>
            </span>
            <IconArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
