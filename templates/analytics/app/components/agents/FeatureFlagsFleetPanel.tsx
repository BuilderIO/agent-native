import {
  type FeatureFlagMetadata,
  type SetFeatureFlagInput,
} from "@agent-native/core/client/feature-flags";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { FeatureFlagsEditor } from "@agent-native/toolkit/app/feature-flags";
import { IconCheck, IconRefresh } from "@tabler/icons-react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface FeatureFlag {
  key: string;
  canManage?: boolean;
  movedToLab?: string;
  displayName?: string | null;
  description?: string | null;
  defaultValue?: boolean;
  rules?: FeatureFlagMetadata["rules"];
  enabledForCurrentUser?: boolean;
  scopes?: FeatureFlagMetadata["scopes"];
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

/** Where the target app says it wrote the rule. */
interface VerifiedMutationScope {
  kind?: NonNullable<SetFeatureFlagInput["scope"]>;
  orgId: string | null;
  orgDomain: string | null;
}

interface VerifiedFlagMutation {
  contractVersion: 3;
  status: "verified";
  key: string;
  rules: NonNullable<FeatureFlagMetadata["rules"]>;
  scope?: VerifiedMutationScope;
  enabledForCurrentUser: boolean | null;
  flag?: FeatureFlag;
}

/** The last change the server verified, kept apart from the directory list. */
export interface VerifiedFleetChange {
  appName: string;
  flagName: string;
  scope: NonNullable<SetFeatureFlagInput["scope"]>;
  mode: NonNullable<FeatureFlagMetadata["rules"]>["mode"];
  enabledForCurrentUser: boolean | null;
  verifiedAt: number;
}

/**
 * Names the change from the directory as it stood before the change, since a
 * later refresh may fail or leave the app out.
 */
export function describeVerifiedFleetChange(
  before: unknown,
  input: { appId: string } & SetFeatureFlagInput,
  verified: VerifiedFlagMutation,
  verifiedAt: number,
): VerifiedFleetChange {
  const app = asDirectory(before).apps?.find(
    (candidate) => appId(candidate) === input.appId,
  );
  const flag = app?.flags?.find((candidate) => candidate.key === verified.key);
  return {
    appName: app ? appName(app) : input.appId,
    flagName: verified.flag?.displayName || flag?.displayName || verified.key,
    // Only an explicit "global" kind proves a global write; an org write may
    // leave `kind` out.
    scope: verified.scope
      ? verified.scope.kind === "global"
        ? "global"
        : "org"
      : (input.scope ?? "org"),
    mode: verified.rules.mode,
    enabledForCurrentUser: verified.enabledForCurrentUser,
    verifiedAt,
  };
}

function updateFleetFlag(
  value: unknown,
  targetAppId: string,
  key: string,
  update: (flag: FeatureFlag) => FeatureFlag,
): FlagDirectory {
  const data = asDirectory(value);
  return {
    ...data,
    apps: data.apps?.map((app) =>
      appId(app) !== targetAppId
        ? app
        : {
            ...app,
            flags: app.flags?.map((flag) =>
              flag.key === key ? update(flag) : flag,
            ),
          },
    ),
  };
}

export function reconcileVerifiedFleetMutation(
  value: unknown,
  targetAppId: string,
  verified: VerifiedFlagMutation,
): FlagDirectory {
  return updateFleetFlag(value, targetAppId, verified.key, (flag) =>
    verified.flag
      ? verified.flag
      : {
          ...flag,
          rules: verified.rules,
          ...(verified.enabledForCurrentUser === null
            ? {}
            : { enabledForCurrentUser: verified.enabledForCurrentUser }),
        },
  );
}

/**
 * Shows the change on the rule it writes. A global change leaves the rule in
 * effect alone when the org has its own rule, because that rule still wins.
 */
export function applyOptimisticFleetMutation(
  flag: FeatureFlag,
  input: SetFeatureFlagInput,
): FeatureFlag {
  const scope = input.scope ?? "org";
  const written = flag.scopes?.[scope];
  const base =
    written?.state === "set" ? written.rules : (flag.rules ?? undefined);
  const rules =
    input.operation === "replace-rules" && input.rules
      ? input.rules
      : input.operation === "off" && base
        ? {
            ...base,
            mode: "off" as const,
            emails: [],
            orgIds: [],
            percentage: 0,
          }
        : undefined;
  if (!rules) return flag;
  if (!flag.scopes) return { ...flag, rules };
  if (!written) return flag;
  const takesEffect = scope === "org" || flag.scopes.inEffect !== "org";
  return {
    ...flag,
    ...(takesEffect ? { rules } : {}),
    scopes: {
      ...flag.scopes,
      inEffect: takesEffect ? scope : flag.scopes.inEffect,
      [scope]: { ...written, state: "set", rules },
    },
  };
}

export function recoverFleetMutationFailure(
  client: QueryClient,
  context?: { previous: unknown; key: readonly unknown[] },
) {
  if (context) client.setQueryData(context.key, context.previous);
  void client.invalidateQueries({
    queryKey: ["action", "list-workspace-feature-flags"],
  });
}

function asDirectory(value: unknown): FlagDirectory {
  return value && typeof value === "object" ? (value as FlagDirectory) : {};
}

export function hasFleetApps(value: unknown): boolean {
  return (asDirectory(value).apps?.length ?? 0) > 0;
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
  const [verifiedChange, setVerifiedChange] =
    useState<VerifiedFleetChange | null>(null);
  const flags = useActionQuery<unknown>(
    "list-workspace-feature-flags",
    undefined,
    { retry: false },
  );
  const mutation = useActionMutation<
    unknown,
    { appId: string } & SetFeatureFlagInput
  >("set-workspace-feature-flag", {
    skipActionQueryInvalidation: true,
    onMutate: async (input) => {
      // A new change replaces the last one, so it can't be mistaken for this one.
      setVerifiedChange(null);
      await client.cancelQueries({
        queryKey: ["action", "list-workspace-feature-flags"],
      });
      const key = ["action", "list-workspace-feature-flags", undefined];
      const previous = client.getQueryData(key);
      client.setQueryData(key, (old: unknown) =>
        updateFleetFlag(old, input.appId, input.key, (flag) =>
          applyOptimisticFleetMutation(flag, input),
        ),
      );
      return { previous, key };
    },
    onError: (_error, _input, context: any) =>
      recoverFleetMutationFailure(client, context),
    onSuccess: (result, input, context: any) => {
      if (
        !result ||
        typeof result !== "object" ||
        (result as Partial<VerifiedFlagMutation>).contractVersion !== 3 ||
        (result as Partial<VerifiedFlagMutation>).status !== "verified"
      ) {
        void client.invalidateQueries({
          queryKey: ["action", "list-workspace-feature-flags"],
        });
        return;
      }
      const verified = result as VerifiedFlagMutation;
      setVerifiedChange(
        describeVerifiedFleetChange(
          context.previous,
          input,
          verified,
          Date.now(),
        ),
      );
      client.setQueryData(context.key, (old: unknown) =>
        reconcileVerifiedFleetMutation(old, input.appId, verified),
      );
    },
  });
  const directory = asDirectory(flags.data);
  const apps = directory.apps ?? [];
  const verifiedNote = verifiedChange ? (
    <VerifiedChangeNote change={verifiedChange} />
  ) : null;
  if (flags.isLoading) return <PanelLoading />;
  if (
    flags.error ||
    (directory.directoryStatus === "unavailable" && !hasFleetApps(directory))
  )
    return (
      <StatusState
        title={t("agents.flagsUnavailable")}
        detail={
          mutation.error?.message ||
          flags.error?.message ||
          t("agents.flagsUnreachable")
        }
        onRetry={() => void flags.refetch()}
        note={verifiedNote}
      />
    );
  if (apps.length === 0)
    return (
      <StatusState
        title={t("agents.flagsEmpty")}
        detail={t("agents.flagsEmptyDetail")}
        onRetry={() => void flags.refetch()}
        note={verifiedNote}
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
      {verifiedNote}
      {directory.directoryStatus === "unavailable" ? (
        <p
          className="rounded-lg border px-4 py-3 text-sm text-muted-foreground"
          role="status"
        >
          {t("agents.flagsUnreachable")}
        </p>
      ) : null}
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
              {mutation.variables?.appId === appId(app) && mutation.error ? (
                <p className="mb-3 text-sm text-destructive">
                  {mutation.error.message}
                </p>
              ) : null}
              <FeatureFlagsEditor
                flags={(app.flags ?? []).filter(
                  (flag): flag is FeatureFlagMetadata =>
                    (!!flag.rules || !!flag.scopes) &&
                    typeof flag.defaultValue === "boolean",
                )}
                isPending={mutation.isPending}
                error={null}
                errorFlagKey={null}
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

function VerifiedChangeNote({ change }: { change: VerifiedFleetChange }) {
  const t = useT();
  const formatters = useFormatters();
  const values = {
    time: formatters.formatDate(change.verifiedAt, { timeStyle: "short" }),
    flag: change.flagName,
    app: change.appName,
    availability:
      change.mode === "off"
        ? t("featureFlags.off")
        : change.mode === "on"
          ? t("featureFlags.everyone")
          : t("featureFlags.targeted"),
  };
  return (
    <div
      className="flex items-start gap-2 rounded-lg border px-4 py-3 text-sm"
      role="status"
    >
      <IconCheck className="mt-0.5 size-4 shrink-0 text-agent-kit-positive" />
      <div>
        <p>
          {change.scope === "global"
            ? t("agents.verifiedFlagChangeGlobal", values)
            : t("agents.verifiedFlagChangeOrg", values)}
        </p>
        {change.enabledForCurrentUser === null ? null : (
          <p className="mt-1 text-xs text-muted-foreground">
            {change.enabledForCurrentUser
              ? t("featureFlags.youHaveAccess")
              : t("featureFlags.youDoNotHaveAccess")}
          </p>
        )}
      </div>
    </div>
  );
}

function StatusState({
  title,
  detail,
  onRetry,
  note,
}: {
  title: string;
  detail: string;
  onRetry: () => void;
  note: ReactNode;
}) {
  const t = useT();
  const status = (
    <div className="rounded-lg border p-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      <Button className="mt-4" size="sm" variant="outline" onClick={onRetry}>
        {t("sidebar.retry")}
      </Button>
    </div>
  );
  if (!note) return status;
  return (
    <div className="flex flex-col gap-4">
      {note}
      {status}
    </div>
  );
}
