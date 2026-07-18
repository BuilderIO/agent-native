import {
  FeatureFlagsEditor,
  type FeatureFlagMetadata,
  type SetFeatureFlagInput,
} from "@agent-native/core/client/feature-flags";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconRefresh } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface FeatureFlag {
  key: string;
  displayName?: string | null;
  description?: string | null;
  defaultValue?: boolean;
  rules?: FeatureFlagMetadata["rules"];
}

export interface FlagApp {
  appId?: string;
  appName?: string;
  appOrigin?: string;
  state?: string;
  id?: string;
  name?: string;
  url?: string;
  status?: string;
  reason?: string;
  flags?: FeatureFlag[];
}

export interface FlagDirectory {
  directoryStatus?: string;
  apps?: FlagApp[];
}

function asDirectory(value: unknown): FlagDirectory {
  return value && typeof value === "object" ? (value as FlagDirectory) : {};
}

function isReady(app: FlagApp) {
  return app.state === "ready" || app.status === "ready";
}

function statusLabel(app: FlagApp) {
  return app.state || app.status || "unknown-legacy";
}

function appId(app: FlagApp) {
  return app.appId || app.id || "";
}

function appName(app: FlagApp) {
  return app.appName || app.name || appId(app);
}

export function qualifyFleetMutation(
  appId: string,
  input: SetFeatureFlagInput,
) {
  return { appId, ...input };
}

export function FeatureFlagsFleetPanel() {
  const t = useT();
  const client = useQueryClient();
  const flags = useActionQuery<unknown>(
    "list-workspace-feature-flags",
    undefined,
    { retry: false },
  );
  const mutation = useActionMutation<
    unknown,
    { appId: string } & SetFeatureFlagInput
  >("set-workspace-feature-flag", {
    onMutate: async (input) => {
      await client.cancelQueries({
        queryKey: ["action", "list-workspace-feature-flags"],
      });
      const key = ["action", "list-workspace-feature-flags", undefined];
      const previous = client.getQueryData(key);
      client.setQueryData(key, (old: unknown) => {
        const data = asDirectory(old);
        return {
          ...data,
          apps: data.apps?.map((app) =>
            appId(app) !== input.appId
              ? app
              : {
                  ...app,
                  flags: app.flags?.map((flag) =>
                    flag.key !== input.key
                      ? flag
                      : {
                          ...flag,
                          rules:
                            input.operation === "replace-rules" && input.rules
                              ? input.rules
                              : input.operation === "off"
                                ? {
                                    ...flag.rules!,
                                    mode: "off",
                                    emails: [],
                                    orgIds: [],
                                    percentage: 0,
                                  }
                                : flag.rules,
                        },
                  ),
                },
          ),
        };
      });
      return { previous, key };
    },
    onError: (_error, _input, context: any) => {
      if (context) client.setQueryData(context.key, context.previous);
    },
    onSettled: () =>
      void client.invalidateQueries({
        queryKey: ["action", "list-workspace-feature-flags"],
      }),
  });
  const directory = asDirectory(flags.data);
  const apps = directory.apps ?? [];
  if (flags.isLoading) return <PanelLoading />;
  if (flags.error || directory.directoryStatus === "unavailable")
    return (
      <StatusState
        title={t("agents.flagsUnavailable")}
        detail={flags.error?.message || t("agents.flagsUnreachable")}
        onRetry={() => void flags.refetch()}
      />
    );
  if (apps.length === 0)
    return (
      <StatusState
        title={t("agents.flagsEmpty")}
        detail={t("agents.flagsEmptyDetail")}
        onRetry={() => void flags.refetch()}
      />
    );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t("agents.featureFlags")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("agents.featureFlagsDescription")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void flags.refetch()}
        >
          <IconRefresh className="me-2 size-4" />
          {t("agents.reloadFlags")}
        </Button>
      </div>
      {apps.map((app) => (
        <section key={appId(app)} className="overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
            <div>
              <h3 className="text-sm font-medium">{appName(app)}</h3>
              {app.reason ? (
                <p className="text-xs text-muted-foreground">{app.reason}</p>
              ) : null}
            </div>
            {!isReady(app) ? (
              <Badge variant="outline">{statusLabel(app)}</Badge>
            ) : null}
          </div>
          {isReady(app) ? (
            <div className="p-4">
              <FeatureFlagsEditor
                flags={(app.flags ?? []).filter(
                  (flag): flag is FeatureFlagMetadata =>
                    !!flag.rules && typeof flag.defaultValue === "boolean",
                )}
                isPending={mutation.isPending}
                error={
                  mutation.variables?.appId === appId(app)
                    ? mutation.error
                    : null
                }
                errorFlagKey={
                  mutation.variables?.appId === appId(app)
                    ? mutation.variables.key
                    : null
                }
                showHeader={false}
                onMutate={(input) =>
                  mutation.mutate(qualifyFleetMutation(appId(app), input))
                }
              />
            </div>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              {statusLabel(app) === "no-definitions"
                ? t("agents.noFlagDefinitions")
                : t("agents.flagsNotReady", { status: statusLabel(app) })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function PanelLoading() {
  const t = useT();
  return (
    <div className="flex min-h-52 items-center justify-center rounded-lg border text-sm text-muted-foreground">
      {t("agents.loading")}
    </div>
  );
}

function StatusState({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail: string;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border p-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      <Button className="mt-4" size="sm" variant="outline" onClick={onRetry}>
        {t("sidebar.retry")}
      </Button>
    </div>
  );
}
