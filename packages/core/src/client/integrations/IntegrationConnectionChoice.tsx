import { IconLoader2, IconUser, IconUsersGroup } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { useT } from "../i18n.js";

export interface IntegrationConnectionChoiceProps {
  name: string;
  logo?: ReactNode;
  showWorkspaceOption: boolean;
  workspaceOptionDisabled?: boolean;
  workspaceOptionDisabledReason?: string;
  personalOnlyReason?: string;
  busy?: boolean;
  onPersonal: () => void;
  onWorkspace: () => void;
}

/** The one small decision before an integration's advanced setup surface. */
export function IntegrationConnectionChoice({
  name,
  logo,
  showWorkspaceOption,
  workspaceOptionDisabled = false,
  workspaceOptionDisabledReason,
  personalOnlyReason,
  busy = false,
  onPersonal,
  onWorkspace,
}: IntegrationConnectionChoiceProps) {
  const t = useT();

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header className="flex min-h-16 items-center border-b border-border px-6 sm:px-10">
        <div className="flex min-w-0 items-center gap-3">
          {logo ? (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50 text-foreground">
              {logo}
            </span>
          ) : null}
          <span className="truncate text-sm font-medium text-foreground">
            {t("mcpIntegrations.connect")} {name}
          </span>
        </div>
      </header>

      <main className="flex flex-1 justify-center overflow-y-auto px-6 py-12 sm:px-10 sm:py-[12vh]">
        <div className="w-full max-w-[420px] self-start">
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-[28px]">
            {t("mcpIntegrations.scopeChoiceTitle")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("mcpIntegrations.scopeChoiceDescription")}
          </p>

          <div className="mt-8 grid gap-2.5">
            <button
              type="button"
              onClick={onPersonal}
              disabled={busy}
              aria-busy={busy}
              className="flex min-h-12 items-center gap-3 rounded-lg bg-primary px-4 py-3 text-left text-primary-foreground transition-[background-color,opacity] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-wait disabled:opacity-60"
            >
              <IconUser className="size-4 shrink-0 opacity-75" />
              <span className="min-w-0 flex-1 text-sm font-medium">
                {t("mcpIntegrations.connectForMe")}
              </span>
              {busy ? (
                <IconLoader2 className="size-4 shrink-0 animate-spin" />
              ) : null}
            </button>

            {showWorkspaceOption ? (
              <button
                type="button"
                onClick={onWorkspace}
                disabled={busy || workspaceOptionDisabled}
                aria-describedby={
                  workspaceOptionDisabledReason
                    ? "integration-workspace-scope-restriction"
                    : undefined
                }
                className="flex min-h-12 items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 text-left text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
              >
                <IconUsersGroup className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {t("mcpIntegrations.setUpForWorkspace")}
                </span>
                {workspaceOptionDisabledReason ? (
                  <span
                    id="integration-workspace-scope-restriction"
                    className="shrink-0 text-[11px] font-normal text-muted-foreground"
                  >
                    {workspaceOptionDisabledReason}
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
          {personalOnlyReason ? (
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              {personalOnlyReason}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
