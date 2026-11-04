import { useT } from "@agent-native/core/client/i18n";
import { useMemo, useState } from "react";

import {
  hasPinnedWorkspaceApp,
  tierWorkspaceApps,
  useWorkspaceAppLayout,
  workspaceAppMatchesQuery,
} from "../lib/workspace-app-layout";
import { workspaceAppHref } from "../lib/workspace-apps";
import { ActionQueryError } from "./action-query-error";
import { AppIcon } from "./app-icon";
import { AppGridItem, AppList, AppListRow } from "./app-list-row";
import { AppOpenActions, appOpenActionLabels } from "./app-open-actions";
import { AppPinButton } from "./app-pin-button";
import {
  AppListActions,
  AppTierSections,
  NoWorkspaceAppsText,
} from "./app-tier-sections";
import { NewAppButton } from "./create-app-popover";
import {
  dispatchNavLinkTarget,
  useDispatchWorkspaceAppLauncher,
} from "./layout/Layout";
import { Skeleton } from "./ui/skeleton";
import {
  WorkspaceAppSearch,
  WorkspaceAppSearchEmpty,
} from "./workspace-app-search";

export function DispatchChatHomeApps() {
  const t = useT();
  const launcher = useDispatchWorkspaceAppLauncher();
  const { layout, togglePinned } = useWorkspaceAppLayout();
  const [query, setQuery] = useState("");
  const tiers = useMemo(
    () =>
      tierWorkspaceApps(
        (launcher?.workspaceApps ?? [])
          .map((app) => ({
            id: app.id,
            name: app.name,
            source: app.source,
            app,
            description: app.defaultDescriptionKey
              ? t(app.defaultDescriptionKey)
              : app.description,
          }))
          .filter((row) => workspaceAppMatchesQuery(row, query)),
        layout,
      ),
    [launcher?.workspaceApps, layout, query, t],
  );
  const hasMatches =
    tiers.pinned.length + tiers.apps.length + tiers.hosted.length > 0;
  if (!launcher) return null;
  const hasOwnApps = launcher.workspaceApps.some(
    (app) => app.source !== "builtin",
  );

  if (launcher.workspaceAppsStatus === "error") {
    return (
      <div className="mx-auto w-full max-w-[1000px]">
        <ActionQueryError
          error={launcher.error}
          onRetry={launcher.retry}
          queryName={launcher.errorQueryName}
        />
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[1000px]">
      {launcher.error ? (
        <ActionQueryError
          error={launcher.error}
          onRetry={launcher.retry}
          className="mb-3"
          queryName={launcher.errorQueryName}
        />
      ) : null}
      <section>
        <AppTierSections
          tiers={tiers}
          appsTitle={t("dispatch.pages.workspaceApps")}
          hasPinnedApps={hasPinnedWorkspaceApp(launcher.workspaceApps, layout)}
          actions={
            <AppListActions
              viewAllHref={dispatchNavLinkTarget("/apps")}
              search={
                <WorkspaceAppSearch
                  query={query}
                  onQueryChange={setQuery}
                  className="w-full sm:w-[280px]"
                />
              }
              newApp={<NewAppButton onCreated={launcher.retry} />}
            />
          }
          appsFallback={
            launcher.workspaceAppsStatus === "loading" ? (
              <AppList layout="grid">
                {Array.from({ length: 6 }, (_, index) => (
                  <AppListRow key={index}>
                    <Skeleton className="size-7 rounded-lg" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-3 w-40 max-w-full" />
                    </div>
                    <Skeleton className="h-7 w-20" />
                  </AppListRow>
                ))}
              </AppList>
            ) : query.trim() ? (
              hasMatches ? null : (
                <WorkspaceAppSearchEmpty
                  query={query}
                  onClear={() => setQuery("")}
                />
              )
            ) : hasOwnApps ? null : (
              <NoWorkspaceAppsText />
            )
          }
          renderItems={(rows) => (
            <AppList layout="grid">
              {rows.map(({ app, description }) => {
                const href = workspaceAppHref(app);
                const pinned = layout.pinnedIds.includes(app.id.toLowerCase());
                return (
                  <AppGridItem key={app.id} asChild>
                    <article>
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <AppIcon id={app.id} name={app.name} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-foreground">
                            {app.name}
                          </span>
                          {description ? (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {description}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <AppPinButton
                        appId={app.id}
                        name={app.name}
                        pinned={pinned}
                        onToggle={() => togglePinned(app.id)}
                      />
                      <AppOpenActions
                        name={app.name}
                        href={href}
                        onOpen={() => launcher.openApp(app)}
                        showNewTabOption={Boolean(href)}
                        external={app.source === "builtin"}
                        labels={appOpenActionLabels(t, app.name)}
                      />
                    </article>
                  </AppGridItem>
                );
              })}
            </AppList>
          )}
        />
      </section>
    </div>
  );
}
