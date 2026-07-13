import { useActionQuery, useT } from "@agent-native/core/client";
import {
  IconApps,
  IconChevronDown,
  IconEyeOff,
  IconPlus,
} from "@tabler/icons-react";
import { useState } from "react";

import { ActionQueryError } from "../../components/action-query-error";
import { CreateAppPopover } from "../../components/create-app-popover";
import { DispatchShell } from "../../components/dispatch-shell";
import { Button } from "../../components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import { Skeleton } from "../../components/ui/skeleton";
import { WorkspaceAppCard } from "../../components/workspace-app-card";
import { cn } from "../../lib/utils";
import type { WorkspaceAppSummary } from "../../lib/workspace-apps";

export function meta() {
  return [{ title: "Apps — Dispatch" }];
}

interface WorkspaceInfo {
  name: string | null;
  displayName: string | null;
  appCount: number;
}

export default function AppsRoute() {
  const t = useT();
  const [showHidden, setShowHidden] = useState(false);
  const appsQuery = useActionQuery("list-workspace-apps", {
    includeAgentCards: false,
    includeArchived: true,
  });
  const { data: apps = [], isLoading: appsLoading } = appsQuery;
  const { data: workspace } = useActionQuery(
    "get-workspace-info",
    {},
    { staleTime: 60_000 },
  );
  const ws = workspace as WorkspaceInfo | undefined;
  const workspaceLabel = ws?.displayName ?? ws?.name ?? null;
  const allApps = (apps as WorkspaceAppSummary[]).filter(
    (app) => !app.isDispatch,
  );
  const visibleApps = allApps.filter((app) => !app.archived);
  const archivedApps = allApps.filter((app) => app.archived);
  const showAppSkeletons = appsLoading && allApps.length === 0;

  return (
    <DispatchShell
      title={t("dispatch.nav.apps")}
      description={
        workspaceLabel
          ? t("dispatch.pages.appsDescriptionWithWorkspace", {
              workspace: workspaceLabel,
            })
          : t("dispatch.pages.appsDescription")
      }
    >
      <div className="space-y-8">
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <IconApps
                size={16}
                className="mt-0.5 shrink-0 text-muted-foreground"
              />
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {workspaceLabel
                    ? t("dispatch.pages.appsInWorkspace", {
                        workspace: workspaceLabel,
                      })
                    : t("dispatch.pages.workspaceApps")}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("dispatch.pages.activeCount", {
                    count: visibleApps.length,
                  })}
                  {archivedApps.length > 0
                    ? ` · ${t("dispatch.pages.hiddenCount", {
                        count: archivedApps.length,
                      })}`
                    : ""}
                </p>
              </div>
            </div>
            {visibleApps.length > 0 ? (
              <CreateAppPopover
                align="end"
                trigger={
                  <Button size="sm">
                    <IconPlus size={15} className="mr-1.5" />
                    {t("dispatch.pages.createApp")}
                  </Button>
                }
              />
            ) : null}
          </div>

          {appsQuery.isError ? (
            <ActionQueryError
              error={appsQuery.error}
              onRetry={() => void appsQuery.refetch()}
            />
          ) : showAppSkeletons ? (
            <AppsSkeletonGrid />
          ) : visibleApps.length > 0 ? (
            <div className="grid auto-rows-fr gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleApps.map((app) => (
                <WorkspaceAppCard key={app.id} app={app} className="h-full" />
              ))}
            </div>
          ) : (
            <EmptyAppsState />
          )}
        </section>

        {archivedApps.length > 0 ? (
          <Collapsible open={showHidden} onOpenChange={setShowHidden}>
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <div className="flex min-w-0 items-center gap-2">
                  <IconEyeOff
                    size={16}
                    className="shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">
                      {t("dispatch.pages.hiddenApps")}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {t("dispatch.pages.hiddenAppCount", {
                        count: archivedApps.length,
                      })}
                    </p>
                  </div>
                </div>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                  >
                    {showHidden
                      ? t("dispatch.pages.hide")
                      : t("dispatch.pages.show")}
                    <IconChevronDown
                      size={14}
                      className={cn(
                        "transition-transform",
                        showHidden && "rotate-180",
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className="grid auto-rows-fr gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {archivedApps.map((app) => (
                    <WorkspaceAppCard
                      key={app.id}
                      app={app}
                      className="h-full"
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </section>
          </Collapsible>
        ) : null}
      </div>
    </DispatchShell>
  );
}

function AppsSkeletonGrid() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
              <div className="space-y-2 pt-1">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyAppsState() {
  const t = useT();
  return (
    <div className="rounded-lg border border-dashed bg-card px-4 py-10 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <IconApps size={18} />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-foreground">
        {t("dispatch.pages.noWorkspaceApps")}
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {t("dispatch.pages.noWorkspaceAppsDescription")}
      </p>
      <div className="mt-4">
        <CreateAppPopover
          trigger={
            <Button size="sm">
              <IconPlus size={15} className="mr-1.5" />
              {t("dispatch.pages.createApp")}
            </Button>
          }
        />
      </div>
    </div>
  );
}
