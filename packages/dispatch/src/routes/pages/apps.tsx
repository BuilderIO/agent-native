import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconApps,
  IconChevronDown,
  IconClockHour4,
  IconEyeOff,
  IconPlus,
} from "@tabler/icons-react";
import { useState } from "react";
import { Outlet, useParams } from "react-router";

import { ActionQueryError } from "../../components/action-query-error";
import {
  APP_LIST_GRID_CLASS,
  APP_LIST_GRID_ROW_CLASS,
  AppList,
} from "../../components/app-list-row";
import { CreateAppPopover } from "../../components/create-app-popover";
import { DispatchShell } from "../../components/dispatch-shell";
import { OtherAppsSection } from "../../components/other-apps-section";
import { Button } from "../../components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import { Skeleton } from "../../components/ui/skeleton";
import { WorkspaceAppCard } from "../../components/workspace-app-card";
import type {
  CuratedWorkspaceTemplatesResult,
  WorkspaceTemplateLabels,
} from "../../components/workspace-template-card";
import type { ConnectedAppSummary } from "../../lib/other-apps";
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

export default function AppsRouteEntry() {
  const { appId } = useParams();
  return appId ? <Outlet /> : <AppsRoute />;
}

function AppsRoute() {
  const t = useT();
  const [showPending, setShowPending] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const appsQuery = useActionQuery("list-workspace-apps", {
    includeAgentCards: false,
    includeArchived: true,
  });
  const connectedAppsQuery = useActionQuery("list-connected-agents", {});
  const curatedTemplatesQuery = useActionQuery(
    "list-curated-workspace-templates",
    {},
  );
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
  const activeApps = visibleApps.filter((app) => app.status !== "pending");
  const pendingApps = visibleApps.filter((app) => app.status === "pending");
  const archivedApps = allApps.filter((app) => app.archived);
  const showAppSkeletons = appsLoading && allApps.length === 0;
  const templateLabels: WorkspaceTemplateLabels = {
    appId: t("dispatch.pages.remixAppIdLabel"),
    appIdDescription: t("dispatch.pages.remixAppIdDescription"),
    cancel: t("dispatch.pages.cancel"),
    integrationSetup: t("dispatch.pages.integrationSetup"),
    installed: t("dispatch.pages.alreadyInWorkspace"),
    remix: t("dispatch.pages.addApp", { defaultValue: "Add app" }),
    remixing: t("dispatch.pages.remixing"),
    remixSuccess: t("dispatch.pages.remixSuccess"),
    remixError: t("dispatch.pages.remixError"),
    appIdRequired: t("dispatch.pages.appIdRequired"),
    source: t("dispatch.pages.source"),
    openApp: t("dispatch.pages.openApp", { defaultValue: "Open app" }),
    viewLiveApp: t("dispatch.pages.openApp", { defaultValue: "Open" }),
  };

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
                  {t("dispatch.pages.yourApps", { defaultValue: "Your apps" })}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("dispatch.pages.activeCount", {
                    count: activeApps.length,
                  })}
                  {pendingApps.length > 0
                    ? ` · ${t("dispatch.pages.pendingCount", {
                        count: pendingApps.length,
                      })}`
                    : ""}
                  {archivedApps.length > 0
                    ? ` · ${t("dispatch.pages.hiddenCount", {
                        count: archivedApps.length,
                      })}`
                    : ""}
                </p>
              </div>
            </div>
            {activeApps.length > 0 || pendingApps.length > 0 ? (
              <CreateAppPopover
                align="end"
                trigger={
                  <Button size="sm" variant="outline">
                    <IconPlus size={15} className="mr-1.5" />
                    {t("dispatch.pages.addApp", { defaultValue: "Add app" })}
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
          ) : activeApps.length > 0 ? (
            <AppList className={APP_LIST_GRID_CLASS}>
              {activeApps.map((app) => (
                <WorkspaceAppCard
                  key={app.id}
                  app={app}
                  className={APP_LIST_GRID_ROW_CLASS}
                />
              ))}
            </AppList>
          ) : pendingApps.length > 0 ? (
            <EmptyActiveAppsState />
          ) : (
            <EmptyAppsState />
          )}
        </section>

        {pendingApps.length > 0 ? (
          <Collapsible open={showPending} onOpenChange={setShowPending}>
            <section className="space-y-3 border-t pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <IconClockHour4
                    size={16}
                    className="shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">
                      {t("dispatch.pages.pendingApps")}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {t("dispatch.pages.pendingCount", {
                        count: pendingApps.length,
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
                    {showPending
                      ? t("dispatch.pages.hidePendingApps")
                      : t("dispatch.pages.showPendingApps")}
                    <IconChevronDown
                      size={14}
                      className={cn(
                        "transition-transform",
                        showPending && "rotate-180",
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <AppList className={APP_LIST_GRID_CLASS}>
                  {pendingApps.map((app) => (
                    <WorkspaceAppCard
                      key={app.id}
                      app={app}
                      className={APP_LIST_GRID_ROW_CLASS}
                    />
                  ))}
                </AppList>
              </CollapsibleContent>
            </section>
          </Collapsible>
        ) : null}

        <OtherAppsSection
          templates={
            curatedTemplatesQuery.data as
              | CuratedWorkspaceTemplatesResult
              | undefined
          }
          connectedApps={
            connectedAppsQuery.data as ConnectedAppSummary[] | undefined
          }
          workspaceApps={allApps}
          templatesLoading={curatedTemplatesQuery.isLoading}
          connectedAppsLoading={connectedAppsQuery.isLoading}
          templatesError={curatedTemplatesQuery.error}
          connectedAppsError={connectedAppsQuery.error}
          onRetryTemplates={() => void curatedTemplatesQuery.refetch()}
          onRetryConnectedApps={() => void connectedAppsQuery.refetch()}
          templateLabels={templateLabels}
          onRemixSuccess={() => {
            void appsQuery.refetch();
            void curatedTemplatesQuery.refetch();
          }}
        />

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
                <AppList className={APP_LIST_GRID_CLASS}>
                  {archivedApps.map((app) => (
                    <WorkspaceAppCard
                      key={app.id}
                      app={app}
                      className={APP_LIST_GRID_ROW_CLASS}
                    />
                  ))}
                </AppList>
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
    <AppList className={APP_LIST_GRID_CLASS}>
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "flex min-w-0 items-center gap-3 border-b px-4 py-3.5 last:border-b-0",
            APP_LIST_GRID_ROW_CLASS,
          )}
        >
          <Skeleton className="size-8 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-8 w-24 shrink-0 rounded-md" />
        </div>
      ))}
    </AppList>
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
            <Button size="sm" variant="outline">
              <IconPlus size={15} className="mr-1.5" />
              {t("dispatch.pages.addApp", { defaultValue: "Add app" })}
            </Button>
          }
        />
      </div>
    </div>
  );
}

function EmptyActiveAppsState() {
  const t = useT();
  return (
    <div className="rounded-lg border border-dashed bg-card px-4 py-10 text-center">
      <p className="text-sm font-medium text-foreground">
        {t("dispatch.pages.noActiveWorkspaceApps")}
      </p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        {t("dispatch.pages.noActiveWorkspaceAppsDescription")}
      </p>
    </div>
  );
}
