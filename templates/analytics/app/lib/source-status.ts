import {
  IconBrandGithub,
  IconBrandGoogle,
  IconChartBar,
  IconDatabase,
} from "@tabler/icons-react";

import type { DataSourceStatusResponse } from "./data-source-status";

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
  const statuses = new Set(connection?.statuses ?? []);

  if (statuses.has("error")) return "error";
  if (statuses.has("needs_reauth")) return "needs_reauth";
  if (
    provider?.configured === true ||
    connection?.grantState === "connected" ||
    statuses.has("connected")
  ) {
    return "connected";
  }
  if (data.workspaceConnections?.available === false) return "error";
  if (provider?.configured === null) return "error";
  return "not_connected";
}
