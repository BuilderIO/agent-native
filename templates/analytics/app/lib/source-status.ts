import {
  IconBrandGithub,
  IconBrandGoogle,
  IconChartBar,
  IconDatabase,
} from "@tabler/icons-react";

import { isDbtUsable } from "../../server/lib/dbt-connection";
import {
  getGrantedWorkspaceConnectionStatuses,
  type DataSourceStatusResponse,
  type WorkspaceConnectionProviderSummary,
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

// A granted dbt row is connected only when the org token and environment ID are
// saved too. A missing readiness value is unknown, so it reads as an error.
function dbtHealthState(
  connection: WorkspaceConnectionProviderSummary | undefined,
): SourceHealthState {
  const readiness = connection?.dbtReadiness;
  // A saved but malformed environment ID needs repair, so it is an error, not a missing setup step.
  if (
    readiness === undefined ||
    readiness === "error" ||
    readiness === "environment_invalid" ||
    readiness === "checking"
  ) {
    return "error";
  }
  if (readiness === "needs_reauth") return "needs_reauth";
  return isDbtUsable(readiness) ? "connected" : "not_connected";
}

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
  // dbt health comes from readiness whatever the grant state, so a granted row
  // in error cannot fall through to "configured".
  if (
    sourceId === "dbt" &&
    (grantState === "connected" || grantState === "granted")
  ) {
    return dbtHealthState(connection);
  }
  if (grantState === "connected") {
    return "connected";
  }
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
