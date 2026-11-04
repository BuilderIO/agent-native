import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { SettingsGroup, SettingsRow } from "@agent-native/toolkit/app/settings";
import { IconArrowUpRight } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { useWorkspaceAppLists } from "../lib/workspace-app-lists";
import { HOSTED_APPS_SETTINGS_INVALID_ERROR_CODE } from "../shared/hosted-apps-settings";
import { ActionQueryError } from "./action-query-error";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Switch } from "./ui/switch";

export interface HostedAppsSettings {
  showHostedApps: boolean;
}

function isInvalidStoredSetting(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { errorCode?: unknown }).errorCode ===
      HOSTED_APPS_SETTINGS_INVALID_ERROR_CODE
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // coercion-ok: a URL the browser cannot parse is shown as stored.
    return url;
  }
}

/** Settings › Organization › Apps: show or hide hosted apps for everyone. */
export function HostedAppsSettingsGroup() {
  const t = useT();
  const query = useActionQuery<HostedAppsSettings>(
    "get-hosted-apps-settings",
    {},
  );
  // The switched value holds until the setting reads back: a save invalidates
  // action queries, and the next read replaces `query.data`.
  const [optimistic, setOptimistic] = useState<{
    showHostedApps: boolean;
    readFrom: HostedAppsSettings | undefined;
  } | null>(null);
  const save = useActionMutation<
    HostedAppsSettings,
    { showHostedApps: boolean }
  >("set-hosted-apps-settings", {
    onError: (error) => {
      setOptimistic(null);
      toast.error(t("dispatch.pages.hostedAppsSaveFailed"), {
        description: error.message,
      });
    },
  });
  const title = t("dispatch.pages.hostedApps");
  // An invalid stored value has no state to show; saving any value repairs it.
  const storedInvalid = query.isError && isInvalidStoredSetting(query.error);
  const showHostedApps =
    optimistic && optimistic.readFrom === query.data
      ? optimistic.showHostedApps
      : storedInvalid
        ? false
        : query.data?.showHostedApps;
  // The launchers' Hosted apps tier, including the apps this setting hides.
  const lists = useWorkspaceAppLists({ includeHiddenFromLaunchers: true });
  const listsFailed =
    lists.status === "error" ||
    (lists.connectedAppsQuery.isError &&
      lists.connectedAppsQuery.data === undefined);
  const listsLoading =
    !listsFailed &&
    (lists.status === "loading" || lists.connectedAppsQuery.data === undefined);

  return (
    <SettingsGroup id="hosted-apps" title={title}>
      {query.isError && !storedInvalid && query.data === undefined ? (
        <div className="px-5 py-4 sm:px-6">
          <ActionQueryError
            error={query.error}
            onRetry={() => void query.refetch()}
            queryName="get-hosted-apps-settings"
          />
        </div>
      ) : showHostedApps === undefined ? (
        <div
          className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"
          aria-busy="true"
        >
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
      ) : (
        <>
          <SettingsRow
            id="show-hosted-apps"
            label={t("dispatch.pages.showHostedApps")}
            control={
              <Switch
                aria-label={t("dispatch.pages.showHostedApps")}
                checked={showHostedApps}
                disabled={save.isPending}
                onCheckedChange={(checked) => {
                  setOptimistic({
                    showHostedApps: checked,
                    readFrom: query.data,
                  });
                  save.mutate({ showHostedApps: checked });
                }}
              />
            }
          >
            {storedInvalid ? (
              <p className="text-xs text-destructive" role="alert">
                {t("dispatch.pages.hostedAppsSettingInvalid")}
              </p>
            ) : null}
          </SettingsRow>
          {listsFailed ? (
            <div className="px-5 py-4 sm:px-6">
              <ActionQueryError
                error={
                  lists.status === "error"
                    ? lists.appsQuery.error
                    : lists.connectedAppsQuery.error
                }
                onRetry={() => {
                  void lists.appsQuery.refetch();
                  void lists.connectedAppsQuery.refetch();
                }}
                queryName={
                  lists.status === "error"
                    ? "list-workspace-apps"
                    : "list-connected-agents"
                }
              />
            </div>
          ) : listsLoading ? (
            <div
              className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"
              aria-busy="true"
              data-hosted-apps-loading
            >
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-8 w-16 rounded-md" />
            </div>
          ) : lists.hostedApps.length > 0 ? (
            <div
              data-state={showHostedApps ? "shown" : "hidden"}
              className="divide-y divide-border/60 transition-opacity data-[state=hidden]:opacity-50"
            >
              {lists.hostedApps.map((app) => (
                <SettingsRow
                  key={app.id}
                  id={`hosted-app-${app.id}`}
                  label={app.name}
                  description={hostOf(app.homeUrl?.trim() || app.url)}
                  control={
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={app.homeUrl?.trim() || app.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t("dispatch.pages.chatFirstOpenApp", {
                          name: app.name,
                        })}
                      >
                        {t("dispatch.pages.openApp")}
                        <IconArrowUpRight size={13} aria-hidden="true" />
                      </a>
                    </Button>
                  }
                />
              ))}
            </div>
          ) : null}
        </>
      )}
    </SettingsGroup>
  );
}
