import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { ActionQueryError } from "@agent-native/dispatch/components";
import { SettingsGroup, SettingsRow } from "@agent-native/toolkit/app/settings";
import { useQuery } from "@tanstack/react-query";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { providerName } from "@/components/workflow-canvas/node-kinds";
import { WORKFLOW_CATALOG } from "@/components/workflow/workflow-catalog";
import type {
  GetWorkflowResult,
  ListWorkflowsResult,
} from "@/components/workflow/workflow-types";

import {
  connectionRows,
  providersUsedByGraphs,
  type ConnectionRow,
} from "./connection-rows";
import { ConnectProviderButton } from "./ConnectProviderButton";
import { ReadinessChip } from "./ReadinessChip";
import { useProviderConnections } from "./use-provider-connections";

function useFactoryConnections(factoryId: string) {
  const workflows = useActionQuery<ListWorkflowsResult>(
    "list-factory-workflows",
    { factoryId },
  );
  const statuses = useProviderConnections();
  const listed = workflows.data?.workflows;
  const signature = listed?.map((w) => `${w.id}@${w.version}`).join(",");
  // A graph is only read again when a workflow is saved, which moves its version.
  const used = useQuery({
    queryKey: ["factory", factoryId, "settings-providers", signature],
    enabled: listed !== undefined,
    staleTime: 60_000,
    queryFn: async () => {
      const results = await Promise.all(
        (listed ?? []).map((workflow) =>
          callAction<GetWorkflowResult>(
            "get-factory-workflow",
            { factoryId, workflowId: workflow.id },
            { method: "GET" },
          ),
        ),
      );
      return providersUsedByGraphs(
        results.map((result) => result.graph),
        WORKFLOW_CATALOG,
      );
    },
  });

  const failed = [workflows, statuses, used].find((query) => query.isError);
  if (failed) {
    return {
      kind: "error" as const,
      error: failed.error,
      retry: () => {
        for (const query of [workflows, statuses, used]) {
          if (query.isError) void query.refetch();
        }
      },
    };
  }
  if (!used.data || !statuses.data) return { kind: "loading" as const };
  return {
    kind: "ready" as const,
    rows: connectionRows(used.data, statuses.data.providers),
    recheck: () => void statuses.refetch(),
  };
}

export function ConnectionsGroup({ factoryId }: { factoryId: string }) {
  const t = useT();
  const connections = useFactoryConnections(factoryId);

  if (connections.kind === "loading") {
    return (
      <div className="grid gap-1 rounded-xl bg-card p-1 shadow-sm">
        <Skeleton className="h-[4.25rem] w-full rounded-lg" />
        <Skeleton className="h-[4.25rem] w-full rounded-lg" />
      </div>
    );
  }
  if (connections.kind === "error") {
    return (
      <ActionQueryError error={connections.error} onRetry={connections.retry} />
    );
  }
  if (connections.rows.length === 0) return null;

  return (
    <SettingsGroup variant="soft" title={t("settings.factory.connections")}>
      {connections.rows.map((row) => (
        <SettingsRow
          key={row.provider}
          label={
            row.provider === "email"
              ? t("settings.factory.email")
              : providerName(row.provider)
          }
          control={
            <ConnectionStatus row={row} onConnected={connections.recheck} />
          }
        />
      ))}
    </SettingsGroup>
  );
}

function ConnectionStatus({
  row,
  onConnected,
}: {
  row: ConnectionRow;
  onConnected: () => void;
}) {
  const badge = <ReadinessChip readiness={row.readiness} word={row.word} />;
  return (
    <div className="flex items-center gap-2">
      {row.detail ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {badge}
            </span>
          </TooltipTrigger>
          <TooltipContent>{row.detail}</TooltipContent>
        </Tooltip>
      ) : (
        badge
      )}
      {row.word !== "connected" ? (
        <ConnectProviderButton
          provider={row.provider}
          connectWith={row.connectWith}
          readiness={row.readiness}
          onConnected={onConnected}
        />
      ) : null}
    </div>
  );
}
