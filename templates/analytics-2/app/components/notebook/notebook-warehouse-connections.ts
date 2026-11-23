import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../../shared/bigquery-source-contract.js";

export interface NotebookWarehouseConnection {
  id: string;
  provider: string;
  label: string;
  accountLabel: string | null;
  queryable: boolean;
  status: string;
}

interface NotebookWarehouseSources {
  workspaceProviders: Array<{
    id: string;
    connections: NotebookWarehouseConnection[];
  }>;
  organizationBigQuery?: {
    sourceId: string;
    credentialReadiness: string;
    connectionName: string | null;
  };
  defaultDataConnection?: { provider: string; connectionId: string } | null;
}

/** Resolve actual queryable sources without fabricating a workspace catalog grant. */
export function notebookWarehouseConnections(
  sources: NotebookWarehouseSources | undefined,
  organizationFallbackLabel: string,
): NotebookWarehouseConnection[] {
  if (!sources) return [];
  const catalog =
    sources.workspaceProviders
      .find((provider) => provider.id === "bigquery")
      ?.connections.filter(
        (connection) =>
          connection.id !== ORGANIZATION_BIGQUERY_SOURCE_ID &&
          connection.provider === "bigquery" &&
          connection.queryable &&
          connection.status === "connected",
      ) ?? [];
  const organization = sources.organizationBigQuery;
  if (
    organization?.sourceId !== ORGANIZATION_BIGQUERY_SOURCE_ID ||
    organization.credentialReadiness !== "configured"
  )
    return catalog;
  const connection: NotebookWarehouseConnection = {
    id: ORGANIZATION_BIGQUERY_SOURCE_ID,
    provider: "bigquery",
    label: organization.connectionName?.trim() || organizationFallbackLabel,
    accountLabel: null,
    queryable: true,
    status: "connected",
  };
  const isDefault =
    sources.defaultDataConnection?.provider === "bigquery" &&
    sources.defaultDataConnection.connectionId === connection.id;
  return isDefault ? [connection, ...catalog] : [...catalog, connection];
}
