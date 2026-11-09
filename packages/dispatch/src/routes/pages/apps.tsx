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
import { AppCardTiers } from "../../components/app-card-tiers";
import { AppList, AppListRow } from "../../components/app-list-row";
import { AppListActions } from "../../components/app-tier-sections";
import { CommunityAppsSection } from "../../components/community-apps-section";
import {
  CreateAppPopover,
  NewAppButton,
} from "../../components/create-app-popover";
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
  WorkspaceAppSearch,
  WorkspaceAppSearchEmpty,
} from "../../components/workspace-app-search";
import { cn } from "../../lib/utils";
import {
  hasPinnedWorkspaceApp,
  orderWorkspaceApps,
  useWorkspaceAppLayout,
  workspaceAppMatchesQuery,
} from "../../lib/workspace-app-layout";
import { useWorkspaceAppLists } from "../../lib/workspace-app-lists";
import { isWorkspaceAppVisibleInDefaultLaunchers } from "../../lib/workspace-apps";

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
  const [searchQuery, setSearchQuery] = useState("");
  const { layout } = useWorkspaceAppLayout();
  const {
    status: appsStatus,
    workspaceApps: apps,
    hostedApps: defaultApps,
    appsQuery,
    connectedAppsQuery,
  } = useWorkspaceAppLists();
  const { data: workspace } = useActionQuery(
    "get-workspace-info",
    {},
    { staleTime: 60_000 },
  );
  const ws = workspace as WorkspaceInfo | undefined;
  const workspaceLabel = ws?.displayName ?? ws?.name ?? null;
  const allApps = apps.filter(isWorkspaceAppVisibleInDefaultLaunchers);
  const visibleApps = allApps.filter((app) => !app.archived);
  const activeApps = visibleApps.filter((app) => app.status !== "pending");
  const pendingApps = visibleApps.filter((app) => app.status === "pending");
  const archivedApps = allApps.filter((app) => app.archived);
  const orderedPendingApps = orderWorkspaceApps(pendingApps, layout);
  const orderedArchivedApps = orderWorkspaceApps(archivedApps, layout);
  const filteredActiveApps = activeApps.filter((app) =>
    workspaceAppMatchesQuery(app, searchQuery),
  );
  const filteredPendingApps = orderedPendingApps.filter((app) =>
    workspaceAppMatchesQuery(app, searchQuery),
  );
  const filteredArchivedApps = orderedArchivedApps.filter((app) =>
    workspaceAppMatchesQuery(app, searchQuery),
  );
  const filteredDefaultApps = defaultApps.filter((app) =>
    workspaceAppMatchesQuery(app, searchQuery),
  );
  const hasSearchResults =
    filteredActiveApps.length > 0 ||
    filteredPendingApps.length > 0 ||
    filteredArchivedApps.length > 0 ||
    filteredDefaultApps.length > 0;
  const showAppSkeletons = appsStatus === "loading";
  const appDiscoveryFailed = appsQuery.isError || connectedAppsQuery.isError;
  const showsEmptyAppsState =
    !showAppSkeletons &&
    !appDiscoveryFailed &&
    !searchQuery.trim() &&
    activeApps.length === 0 &&
    pendingApps.length === 0;

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
      <div className="mx-auto w-full max-w-[1000px] space-y-8">
        <section className="space-y-3">
          {appsQuery.isError ? (
            <ActionQueryError
              error={appsQuery.error}
              onRetry={() => void appsQuery.refetch()}
              queryName="list-workspace-apps"
            />
          ) : null}
          {connectedAppsQuery.isError ? (
            <ActionQueryError
              error={connectedAppsQuery.error}
              onRetry={() => void connectedAppsQuery.refetch()}
              queryName="list-connected-agents"
            />
          ) : null}
          <AppCardTiers
            workspaceApps={showAppSkeletons ? [] : filteredActiveApps}
            hostedApps={showAppSkeletons ? [] : filteredDefaultApps}
            appsTitle={t("dispatch.pages.workspaceApps")}
            hasPinnedApps={
              !showAppSkeletons &&
              hasPinnedWorkspaceApp([...activeApps, ...defaultApps], layout)
            }
            actions={
              <AppListActions
                search={
                  !showAppSkeletons ? (
                    <WorkspaceAppSearch
                      className="w-full sm:w-[250px]"
                      query={searchQuery}
                      onQueryChange={setSearchQuery}
                    />
                  ) : undefined
                }
                // The empty state carries its own Add app.
                newApp={
                  !showAppSkeletons && !showsEmptyAppsState ? (
                    <NewAppButton />
                  ) : undefined
                }
              />
            }
            appsFallback={
              showAppSkeletons ? (
                <AppsSkeletonGrid />
              ) : appDiscoveryFailed ? null : searchQuery.trim() ? (
                hasSearchResults ? null : (
                  <WorkspaceAppSearchEmpty
                    query={searchQuery}
                    onClear={() => setSearchQuery("")}
                  />
                )
              ) : showsEmptyAppsState ? (
                <EmptyAppsState />
              ) : activeApps.length > 0 ? null : (
                <EmptyActiveAppsState />
              )
            }
          />
        </section>

        {pendingApps.length > 0 &&
        (!searchQuery.trim() || filteredPendingApps.length > 0) ? (
          <Collapsible
            open={showPending || Boolean(searchQuery.trim())}
            onOpenChange={setShowPending}
          >
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
                    {showPending || Boolean(searchQuery.trim())
                      ? t("dispatch.pages.hidePendingApps")
                      : t("dispatch.pages.showPendingApps")}
                    <IconChevronDown
                      size={14}
                      className={cn(
                        "transition-transform",
                        (showPending || Boolean(searchQuery.trim())) &&
                          "rotate-180",
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <AppList layout="grid">
                  {filteredPendingApps.map((app) => (
                    <WorkspaceAppCard key={app.id} app={app} />
                  ))}
                </AppList>
              </CollapsibleContent>
            </section>
          </Collapsible>
        ) : null}

        {archivedApps.length > 0 &&
        (!searchQuery.trim() || filteredArchivedApps.length > 0) ? (
          <Collapsible
            open={showHidden || Boolean(searchQuery.trim())}
            onOpenChange={setShowHidden}
          >
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
                    {showHidden || Boolean(searchQuery.trim())
                      ? t("dispatch.pages.hide")
                      : t("dispatch.pages.show")}
                    <IconChevronDown
                      size={14}
                      className={cn(
                        "transition-transform",
                        (showHidden || Boolean(searchQuery.trim())) &&
                          "rotate-180",
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <AppList layout="grid">
                  {filteredArchivedApps.map((app) => (
                    <WorkspaceAppCard key={app.id} app={app} />
                  ))}
                </AppList>
              </CollapsibleContent>
            </section>
          </Collapsible>
        ) : null}

        <CommunityAppsSection />
      </div>
    </DispatchShell>
  );
}

function AppsSkeletonGrid() {
  return (
    <AppList layout="grid">
      {Array.from({ length: 3 }).map((_, index) => (
        <AppListRow key={index}>
          <Skeleton className="size-8 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-8 w-24 shrink-0 rounded-md" />
        </AppListRow>
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
