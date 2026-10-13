import {
  IconBrandGithub,
  IconBrandGoogle,
  IconChartBar,
  IconDatabase,
} from "@tabler/icons-react";

import {
  getGrantedWorkspaceConnectionStatuses,
  type DataSourceStatusResponse,
} from "./data-source-status";

export const SOURCE_HEALTH_SOURCES = [
  { id: "github", label: "GitHub", icon: IconBrandGithub },
  { id: "dbt", label: "dbt Cloud", icon: IconDatabase },
  { id: "bigquery", label: "BigQuery", icon: IconBrandGoogle },
  { id: "amplitude", label: "Amplitude", icon: IconChartBar },
  { id: "sigma", label: "Sigma", icon: IconDatabase },
] as const;

export type SourceHealthId = (typeof SOURCE_HEALTH_SOURCES)[number]["id"];
export type SourceHealthState =
  | "connected"
  | "configured"
  | "not_connected"
  | "needs_reauth"
  | "error";

export function sourceHealthState(
  sourceId: SourceHealthId,
  data: DataSourceStatusResponse | undefined,
  queryFailed = false,
): SourceHealthState {
  if (queryFailed || !data || data.error) {
    return "error";
  }

  const provider = data.providers?.find(
    (candidate) => candidate.provider === sourceId,
  );
  const connection =
    provider?.workspaceConnection ??
    data.workspaceConnections?.providers.find(
      (candidate) =>
        candidate.provider === sourceId || candidate.id === sourceId,
    );
  const statuses = new Set(getGrantedWorkspaceConnectionStatuses(connection));

  const grantState = connection?.grantState;
  // The aggregate status list includes connections granted to other apps.
  // Use the per-connection list filtered for Analytics when assessing health.
  if (grantState === "connected") return "connected";
  if (grantState === "needs_grant") {
    const missingRequiredKeys = provider?.missingRequiredKeys;
    const requiredCredentialsConfigured =
      typeof provider?.credentialsConfigured === "boolean"
        ? provider.credentialsConfigured
        : Array.isArray(missingRequiredKeys) &&
          missingRequiredKeys.length === 0;
    return requiredCredentialsConfigured ? "configured" : "not_connected";
  }
  if (data.workspaceConnections?.available === false) return "error";
  if (provider?.configured === null) return "error";
  if (grantState === "granted") {
    if (statuses.has("needs_reauth")) return "needs_reauth";
    if (statuses.has("error")) return "error";
  }
  if (provider?.configured === true || grantState === "granted") {
    return "configured";
  }
  return "not_connected";
}
