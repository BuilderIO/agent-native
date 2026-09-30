import { useT } from "@agent-native/core/client/i18n";
import { AppOpenActions } from "@agent-native/toolkit/app/chat/chat-first";
import { IconArrowUpRight, IconPlus } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import {
  orderWorkspaceApps,
  useWorkspaceAppLayout,
  workspaceAppMatchesQuery,
} from "../lib/workspace-app-layout";
import { workspaceAppHref } from "../lib/workspace-apps";
import { ActionQueryError } from "./action-query-error";
import { AppIcon } from "./app-icon";
import { CreateAppPopover } from "./create-app-popover";
import {
  dispatchNavLinkTarget,
  useDispatchWorkspaceAppLauncher,
} from "./layout/Layout";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import {
  WorkspaceAppSearch,
  WorkspaceAppSearchEmpty,
} from "./workspace-app-search";

export function DispatchChatHomeApps() {
  const t = useT();
  const launcher = useDispatchWorkspaceAppLauncher();
  const { layout } = useWorkspaceAppLayout();
  const [query, setQuery] = useState("");
  const apps = useMemo(
    () =>
      orderWorkspaceApps(launcher?.workspaceApps ?? [], layout)
        .map((app) => ({
          app,
          description: app.defaultDescriptionKey
            ? t(app.defaultDescriptionKey)
            : app.description,
        }))
        .filter(({ app, description }) =>
          workspaceAppMatchesQuery({ ...app, description }, query),
        ),
    [launcher?.workspaceApps, layout, query, t],
  );
  if (!launcher) return null;

  if (launcher.error && launcher.workspaceApps.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1000px]">
        <ActionQueryError error={launcher.error} onRetry={launcher.retry} />
      </div>
    );
  }
  if (!launcher.isLoading && launcher.workspaceApps.length === 0) return null;

  return (
    <div className="mx-auto w-full max-w-[1000px]">
      {launcher.error ? (
        <ActionQueryError
          error={launcher.error}
          onRetry={launcher.retry}
          className="mb-3"
        />
      ) : null}
      <section aria-label={t("dispatch.nav.apps")}>
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            {t("dispatch.nav.apps")}
          </h2>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
            <WorkspaceAppSearch
              query={query}
              onQueryChange={setQuery}
              className="w-full max-w-[280px]"
            />
            <CreateAppPopover
              align="end"
              onCreated={launcher.retry}
              trigger={
                <Button type="button" size="sm" variant="outline">
                  <IconPlus size={16} aria-hidden="true" />
                  {t("dispatch.pages.chatFirstNewApp")}
                </Button>
              }
            />
          </div>
        </header>
        {launcher.isLoading && launcher.workspaceApps.length === 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="flex min-w-0 items-center gap-3 rounded-xl bg-muted/30 px-3 py-2.5"
              >
                <Skeleton className="size-7 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3 w-40 max-w-full" />
                </div>
                <Skeleton className="h-7 w-20" />
              </div>
            ))}
          </div>
        ) : apps.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {apps.map(({ app, description }) => {
              const href = workspaceAppHref(app);
              return (
                <article
                  key={app.id}
                  className="flex min-w-0 items-center gap-3 rounded-xl bg-muted/30 px-3 py-2.5 transition-colors hover:bg-muted/50"
                >
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
                  <AppOpenActions
                    name={app.name}
                    href={href}
                    onOpen={() => launcher.openApp(app)}
                    showNewTabOption={Boolean(href)}
                    labels={{
                      openApp: t("dispatch.pages.openApp", {
                        defaultValue: "Open",
                      }),
                      openAppAccessible: t("dispatch.pages.chatFirstOpenApp", {
                        name: app.name,
                      }),
                      openInNewTab: t("dispatch.pages.chatFirstOpenInNewTab"),
                      moreOptions: t("extensions.optionsFor", {
                        name: app.name,
                      }),
                    }}
                  />
                </article>
              );
            })}
          </div>
        ) : (
          <WorkspaceAppSearchEmpty query={query} onClear={() => setQuery("")} />
        )}
        <Link
          to={dispatchNavLinkTarget("/apps")}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t("dispatch.pages.allApps")}
          <IconArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
