import { useT } from "@agent-native/core/client/i18n";
import {
  formatMcpServersLoadError,
  getDefaultMcpIntegrations,
  McpIntegrationDialog,
  McpIntegrationLogo,
  useCreateMcpServer,
  useMcpServers,
  useReconnectMcpServer,
} from "@agent-native/core/client/resources";
import {
  IconAlertCircle,
  IconCheck,
  IconCircle,
  IconLoader2,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DbtMcpStatus } from "@/lib/data-source-status";

const dbtIntegration = getDefaultMcpIntegrations().find(
  (integration) => integration.id === "dbt",
);
// This card owns organization scope, so skip the dialog's personal/workspace
// choice and enforce the shared scope again at the create boundary.
const dbtDialogIntegration = dbtIntegration
  ? { ...dbtIntegration, supportsOrganizationScope: false }
  : undefined;

export function DbtMcpDataSourceCard({
  status,
  isLoading,
  canManageOrg,
  hasOrg,
  focused,
  showAskContinuation,
  onSaved,
}: {
  status: DbtMcpStatus | undefined;
  isLoading: boolean;
  canManageOrg: boolean;
  hasOrg: boolean;
  focused: boolean;
  showAskContinuation: boolean;
  onSaved: () => void;
}) {
  const t = useT();
  const [dialogOpen, setDialogOpen] = useState(false);
  const serversQuery = useMcpServers();
  const createServer = useCreateMcpServer();
  const reconnectServer = useReconnectMcpServer();
  const connected = status?.configured === true;
  const notConfigured = status?.configured === false && status.available;
  const hasError =
    !isLoading &&
    (status?.configured === null || status?.available === false || !status);
  const dbtServer = status?.serverId
    ? [
        ...(serversQuery.data?.org ?? []),
        ...(serversQuery.data?.user ?? []),
      ].find(
        (server) =>
          server.id === status.serverId || server.mergedId === status.serverId,
      )
    : undefined;
  const errorMessage = reconnectServer.error
    ? reconnectServer.error instanceof Error && reconnectServer.error.message
      ? reconnectServer.error.message
      : t("dataSources.connectionFailed")
    : serversQuery.error
      ? formatMcpServersLoadError(serversQuery.error)
      : hasError && status?.error
        ? formatMcpServersLoadError(status.error)
        : null;

  const handlePrimaryAction = () => {
    if (notConfigured) {
      setDialogOpen(true);
      return;
    }
    if (!dbtServer) return;
    reconnectServer.mutate(
      { id: dbtServer.id, scope: dbtServer.scope },
      { onSuccess: onSaved },
    );
  };

  return (
    <Card
      id="data-source-dbt"
      className={`data-source-card rounded-xl border-0 bg-muted/35 shadow-none ${
        focused ? "ring-1 ring-ring/40" : ""
      }`}
    >
      <CardHeader className="p-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background/80">
              {dbtIntegration ? (
                <McpIntegrationLogo
                  name={dbtIntegration.name}
                  logoUrl={dbtIntegration.logoUrl}
                  integrationId={dbtIntegration.id}
                  className="size-8 rounded-md border-0 bg-transparent"
                  imageClassName="size-full p-0.5"
                />
              ) : null}
            </div>
            <CardTitle className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
              <span>dbt</span>
              <span className="text-xs font-normal text-muted-foreground">
                {t("dataSources.dbtSharedIdentity")}
              </span>
            </CardTitle>
          </div>

          <div className="flex items-center justify-between gap-3 sm:justify-end">
            {isLoading ? (
              <Skeleton className="h-4 w-28 rounded-full" />
            ) : hasError ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                <IconAlertCircle className="size-3.5" />
                {t("dataSources.connectionFailed")}
              </span>
            ) : connected ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                <IconCheck className="size-3.5" />
                {t("dataSources.dbtConnectedTools", {
                  count: status.toolCount,
                })}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <IconCircle className="size-3" />
                {t("dataSources.notConfigured")}
              </span>
            )}

            {!isLoading && canManageOrg && hasOrg ? (
              <Button
                size="sm"
                variant={connected ? "outline" : "default"}
                onClick={handlePrimaryAction}
                disabled={
                  reconnectServer.isPending || (!notConfigured && !dbtServer)
                }
                className="text-xs"
              >
                {reconnectServer.isPending ? (
                  <IconLoader2 className="size-3.5 animate-spin" />
                ) : notConfigured ? (
                  t("dataSources.connect")
                ) : (
                  t("dataSources.reconnect")
                )}
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>

      {(errorMessage || (focused && connected && showAskContinuation)) && (
        <CardContent className="px-3.5 pb-3.5 pt-0">
          {errorMessage ? (
            <p role="alert" className="text-xs text-destructive">
              {errorMessage}
            </p>
          ) : null}
          {focused && connected && showAskContinuation ? (
            <div className="flex items-center justify-between gap-3 rounded-md bg-emerald-500/10 p-2.5">
              <span className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <IconCheck className="size-3.5" />
                {t("dataSources.connectionSuccessful")}
              </span>
              <Button asChild size="sm" className="text-xs">
                <Link to="/ask">{t("navigation.ask")}</Link>
              </Button>
            </div>
          ) : null}
        </CardContent>
      )}

      {canManageOrg && hasOrg && dbtDialogIntegration ? (
        <McpIntegrationDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          connectIntegrationId="dbt"
          defaultScope="org"
          canCreateOrgMcp
          hasOrg
          onCreateMcpServer={(args) =>
            createServer.mutateAsync({ ...args, scope: "org" })
          }
          onCreated={onSaved}
          integrations={[dbtDialogIntegration]}
        />
      ) : null}
    </Card>
  );
}
