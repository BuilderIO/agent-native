import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared/builder-link-tracking";
import {
  IconApps,
  IconArrowUpRight,
  IconChevronDown,
  IconEyeOff,
  IconPlus,
  IconStack2,
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
import {
  WorkspaceTemplatesSection,
  type CuratedWorkspaceTemplatesResult,
  type WorkspaceTemplateLabels,
} from "../../components/workspace-template-card";
import {
  filterOtherApps,
  type ConnectedAppSummary,
} from "../../lib/other-apps";
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
  const archivedApps = allApps.filter((app) => app.archived);
  const otherApps = filterOtherApps(
    (connectedAppsQuery.data || []) as ConnectedAppSummary[],
    allApps,
  );
  const showAppSkeletons = appsLoading && allApps.length === 0;
  const templateLabels: WorkspaceTemplateLabels = {
    appId: t("dispatch.pages.remixAppIdLabel"),
    appIdDescription: t("dispatch.pages.remixAppIdDescription"),
    cancel: t("dispatch.pages.cancel"),
    integrationSetup: t("dispatch.pages.integrationSetup"),
    installed: t("dispatch.pages.alreadyInWorkspace"),
    remix: t("dispatch.pages.remix"),
    remixing: t("dispatch.pages.remixing"),
    remixSuccess: t("dispatch.pages.remixSuccess"),
    remixError: t("dispatch.pages.remixError"),
    appIdRequired: t("dispatch.pages.appIdRequired"),
    source: t("dispatch.pages.source"),
    viewLiveApp: t("dispatch.pages.viewLiveApp"),
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

        {curatedTemplatesQuery.isError ? (
          <section className="space-y-3 border-t pt-4">
            <ActionQueryError
              error={curatedTemplatesQuery.error}
              onRetry={() => void curatedTemplatesQuery.refetch()}
            />
          </section>
        ) : curatedTemplatesQuery.data ? (
          <section className="space-y-3 border-t pt-4">
            <div className="flex min-w-0 items-start gap-2">
              <IconStack2
                size={16}
                className="mt-0.5 shrink-0 text-muted-foreground"
              />
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {t("dispatch.pages.curatedTemplates")}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("dispatch.pages.curatedTemplatesDescription")}
                </p>
              </div>
            </div>
            <WorkspaceTemplatesSection
              templates={
                curatedTemplatesQuery.data as CuratedWorkspaceTemplatesResult
              }
              labels={templateLabels}
              onRemixSuccess={() => {
                void appsQuery.refetch();
                void curatedTemplatesQuery.refetch();
              }}
            />
          </section>
        ) : null}

        {connectedAppsQuery.isError ? (
          <section className="space-y-3 border-t pt-4">
            <OtherAppsHeading count={0} />
            <ActionQueryError
              error={connectedAppsQuery.error}
              onRetry={() => void connectedAppsQuery.refetch()}
            />
          </section>
        ) : connectedAppsQuery.isLoading || otherApps.length > 0 ? (
          <section className="space-y-3 border-t pt-4">
            <OtherAppsHeading count={otherApps.length} />
            {connectedAppsQuery.isLoading ? (
              <OtherAppsSkeletonGrid />
            ) : (
              <div className="grid auto-rows-fr gap-3 md:grid-cols-2 xl:grid-cols-3">
                {otherApps.map((app) => (
                  <OtherAppCard key={app.id} app={app} />
                ))}
              </div>
            )}
          </section>
        ) : null}

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

function OtherAppsHeading({ count }: { count: number }) {
  const t = useT();
  return (
    <div className="flex min-w-0 items-start gap-2">
      <IconStack2 size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-foreground">
          {t("dispatch.pages.otherApps")}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("dispatch.pages.otherAppsDescription")}
          {count > 0
            ? ` · ${t("dispatch.pages.availableCount", { count })}`
            : ""}
        </p>
      </div>
    </div>
  );
}

function OtherAppsSkeletonGrid() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-lg bg-card p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="size-8 rounded-md" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OtherAppCard({ app }: { app: ConnectedAppSummary }) {
  const t = useT();
  return (
    <a
      href={withBuilderUtmTrackingParams(app.url, {
        campaign: "product",
        content: "dispatch_app",
      })}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-h-[116px] items-start gap-3 rounded-xl bg-card/40 p-4 transition-[background-color] hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
        {app.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span className="truncate text-sm font-semibold text-foreground">
            {app.name}
          </span>
          <IconArrowUpRight
            size={15}
            className="shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          />
        </span>
        <span className="mt-2 line-clamp-2 block text-[13px] leading-5 text-muted-foreground">
          {app.description || app.url}
        </span>
        <span className="mt-3 block text-xs font-medium text-foreground">
          {t("dispatch.pages.openApp")}
        </span>
      </span>
    </a>
  );
}

function AppsSkeletonGrid() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-lg bg-card p-4">
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
