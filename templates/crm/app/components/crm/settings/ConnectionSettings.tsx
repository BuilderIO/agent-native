import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle, IconPlugConnected } from "@tabler/icons-react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import {
  connectionModeInfo,
  CRM_CONNECTION_MODE_INFO,
  SELECTABLE_CRM_CONNECTION_MODES,
} from "./settings-admin";

interface CrmConnectionSummary {
  id: string;
  provider: string;
  label: string;
  accountId: string | null;
  mode: string;
  status: string;
  objectTypes: string[];
  lastSyncedAt: string | null;
  lastError: string | null;
}

export function ConnectionSettings() {
  const t = useT();
  const connectionsQuery = useActionQuery<{
    connections: CrmConnectionSummary[];
  }>("list-crm-connections" as never, {} as never);
  const connections = connectionsQuery.data?.connections ?? [];
  const hasDeprecatedMode = connections.some(
    (connection) => connectionModeInfo(connection.mode)?.deprecated,
  );

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">
        {t("connection.title")}
      </h1>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {t("connection.description")}
      </p>

      <div className="mt-5 grid gap-3 rounded-lg border border-border/70 bg-card p-4">
        <p className="text-sm font-medium">{t("connection.modesTitle")}</p>
        {SELECTABLE_CRM_CONNECTION_MODES.map((mode) => (
          <div key={mode} className="grid gap-0.5">
            <p className="text-sm">
              {t(CRM_CONNECTION_MODE_INFO[mode].labelKey)}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {t(CRM_CONNECTION_MODE_INFO[mode].descriptionKey)}
            </p>
          </div>
        ))}
      </div>

      {hasDeprecatedMode ? (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-border/70 bg-muted/40 px-4 py-3">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-5 text-muted-foreground">
            {t("connection.hybridDeprecated")}
          </p>
        </div>
      ) : null}

      {connectionsQuery.isError ? (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
          <IconAlertTriangle className="size-4 shrink-0 text-destructive" />
          <p className="flex-1 text-sm">
            {connectionsQuery.error instanceof Error
              ? connectionsQuery.error.message
              : t("connection.loadFailed")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void connectionsQuery.refetch()}
          >
            {t("connection.retry")}
          </Button>
        </div>
      ) : connections.length ? (
        <div className="mt-6 divide-y divide-border/70 rounded-lg border border-border/70 bg-card">
          {connections.map((connection) => (
            <ConnectionRow key={connection.id} connection={connection} />
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm font-medium">
            {connectionsQuery.isLoading
              ? t("connection.loading")
              : t("connection.emptyTitle")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("connection.emptyDescription")}
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/setup">{t("connection.openSetup")}</Link>
          </Button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/setup">{t("connection.openSetup")}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/settings/connections">
            {t("connection.openWorkspaceConnections")}
          </Link>
        </Button>
      </div>
    </div>
  );
}

function ConnectionRow({ connection }: { connection: CrmConnectionSummary }) {
  const t = useT();
  const mode = connectionModeInfo(connection.mode);

  return (
    <section className="flex flex-wrap items-start gap-4 px-4 py-3.5">
      <IconPlugConnected className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{connection.label}</p>
          <Badge variant="outline" className="font-normal">
            {connection.provider}
          </Badge>
          {mode ? (
            <Badge
              variant={mode.deprecated ? "outline" : "secondary"}
              className="font-normal"
            >
              {t(mode.labelKey)}
              {mode.deprecated ? ` · ${t("connection.deprecated")}` : ""}
            </Badge>
          ) : (
            // Never fall back to a default label: an unrecognized mode means
            // this build cannot read the row, which is not the same as native.
            <Badge variant="destructive" className="font-normal">
              {t("connection.modeUnrecognized", { mode: connection.mode })}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {mode ? t(mode.descriptionKey) : t("connection.modeUnrecognizedHelp")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("connection.mirroredObjects", {
            objects: connection.objectTypes.join(", ") || t("connection.none"),
          })}
        </p>
        {connection.lastError ? (
          <p className="mt-1 text-xs text-destructive">
            {connection.lastError}
          </p>
        ) : null}
      </div>
      <Badge variant="outline" className="shrink-0 font-normal">
        {connection.status}
      </Badge>
    </section>
  );
}
