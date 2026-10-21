import { useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { SettingsGroup, SettingsRow } from "@agent-native/toolkit/app/settings";
import { ProviderReadinessBadge } from "@agent-native/toolkit/app/setup-connections";
import { IconClipboardCopy, IconLoader2 } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopyDiagnostics } from "@/components/workflow/CopyDiagnostics";
import { useWorkflowStrings } from "@/components/workflow/workflow-strings";

import {
  schedulerView,
  type SchedulerHealth,
  type SchedulerWord,
} from "./scheduler-health";

const HEALTH_REFETCH_MS = 60_000;

export function SchedulerGroup({ factoryId }: { factoryId: string }) {
  const t = useT();
  const ws = useWorkflowStrings();
  const diagnostics = useCopyDiagnostics({ factoryId });
  const { formatDate } = useFormatters();
  const query = useActionQuery<SchedulerHealth>(
    "get-factory-automation-health",
    {},
    { refetchInterval: HEALTH_REFETCH_MS },
  );
  const view = schedulerView(query.data, query.error);

  if (!view) {
    return <Skeleton className="h-[4.25rem] w-full rounded-xl" />;
  }

  const words: Record<SchedulerWord, string> = {
    healthy: t("factoryRoute.automationHealthHealthy"),
    stale: t("factoryRoute.automationHealthStale"),
    error: t("factoryRoute.automationHealthError"),
    noHeartbeat: t("factoryRoute.automationHealthNoData"),
  };
  const readiness = {
    healthy: "ready",
    stale: "needs_attention",
    error: "needs_attention",
    noHeartbeat: "disabled",
  } as const;
  const error =
    view.kind === "unreadable"
      ? `${t("factoryRoute.automationDiagnosticsLoadError")} ${view.message}`
      : view.lastError;

  return (
    <SettingsGroup
      variant="soft"
      title={t("factoryRoute.automationHealthTitle")}
    >
      <SettingsRow
        label={t("factoryRoute.automationHealthStatus")}
        control={
          view.kind === "unreadable" ? (
            <ProviderReadinessBadge
              status="needs_attention"
              label={t("settings.factory.couldNotCheck")}
            />
          ) : (
            <ProviderReadinessBadge
              status={readiness[view.word]}
              label={words[view.word]}
            />
          )
        }
      />
      {view.kind === "reported" && view.lastCheckedAt ? (
        <SettingsRow
          label={t("factoryRoute.automationLastCheck")}
          control={
            <span className="text-sm text-muted-foreground">
              {formatDate(view.lastCheckedAt, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          }
        />
      ) : null}
      {error ? (
        <SettingsRow
          label={t("factoryRoute.automationHealthErrorDetail")}
          control={
            <span className="block max-w-sm text-sm text-muted-foreground sm:text-end">
              {error}
            </span>
          }
        />
      ) : null}
      <SettingsRow
        label={ws.diagnostics.copy}
        control={
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={ws.diagnostics.copy}
            disabled={diagnostics.pending}
            onClick={diagnostics.copy}
          >
            {diagnostics.pending ? (
              <IconLoader2 className="animate-spin" />
            ) : (
              <IconClipboardCopy />
            )}
          </Button>
        }
      />
      {diagnostics.dialog}
    </SettingsGroup>
  );
}
