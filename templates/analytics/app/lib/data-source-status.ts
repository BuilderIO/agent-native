import { dataSources, type DataSource } from "@/lib/data-sources";

export interface EnvKeyStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

export type WorkspaceConnectionGrantState =
  | "connected"
  | "granted"
  | "needs_grant"
  | "not_connected";

export interface WorkspaceConnectionProviderSummary {
  id?: string;
  provider: string;
  label?: string;
  grantState: WorkspaceConnectionGrantState;
  grantAvailabilityMessage?: string;
  connectionCount: number;
  grantedConnectionCount: number;
  activeConnectionCount: number;
  hasWorkspaceConnection: boolean;
  hasGrantedWorkspaceConnection: boolean;
  hasActiveWorkspaceConnection: boolean;
}

export interface DataSourceProviderStatus {
  provider: string;
  label: string;
  configured: boolean;
  configuredKeys: string[];
  missingRequiredKeys: string[];
  optionalKeys: string[];
  workspaceConnection?: WorkspaceConnectionProviderSummary;
}

export interface DataSourceStatusResponse {
  credentials?: EnvKeyStatus[];
  providers?: DataSourceProviderStatus[];
  workspaceConnections?: {
    appId: string;
    available: boolean;
    error: string | null;
    providers: WorkspaceConnectionProviderSummary[];
  };
  error?: string;
  message?: string;
  settingsPath?: string;
}

export type SharedConnectionStatusKind =
  | "ready"
  | "needs_grant"
  | "needs_credentials"
  | "local_credentials";

export interface SharedConnectionStatus {
  kind: SharedConnectionStatusKind;
  label: string;
  providerId: string;
  providerLabel: string;
  connection?: WorkspaceConnectionProviderSummary;
}

const dataSourceWorkspaceProviderIds: Record<string, string> = {
  github: "github",
  hubspot: "hubspot",
  notion: "notion",
  slack: "slack",
};

const sharedConnectionLabels: Record<SharedConnectionStatusKind, string> = {
  ready: "Ready via workspace",
  needs_grant: "Needs grant",
  needs_credentials: "Needs credentials",
  local_credentials: "Local credentials",
};

export function credentialRowsFromStatus(
  data: DataSourceStatusResponse | EnvKeyStatus[] | undefined,
): EnvKeyStatus[] {
  if (Array.isArray(data)) return data;
  return data?.credentials ?? [];
}

export function getOptionalCredentialKeys(source: DataSource): Set<string> {
  return new Set(
    source.walkthroughSteps
      .filter((step) => step.optional)
      .map((step) => step.inputKey)
      .filter((k): k is string => Boolean(k)),
  );
}

export function isSourceConfigured(
  source: DataSource,
  envStatus: EnvKeyStatus[],
): boolean {
  const statusMap = new Map(envStatus.map((s) => [s.key, s.configured]));
  const optionalKeys = getOptionalCredentialKeys(source);
  const requiredKeys = source.envKeys.filter((key) => !optionalKeys.has(key));
  if (source.credentialRequirementMode === "any") {
    return requiredKeys.some((key) => statusMap.get(key) === true);
  }
  return requiredKeys.every((key) => statusMap.get(key) === true);
}

export function getWorkspaceProviderIdForSource(
  source: DataSource,
): string | null {
  return dataSourceWorkspaceProviderIds[source.id] ?? null;
}

export function getWorkspaceConnectionForSource(
  source: DataSource,
  data: DataSourceStatusResponse | undefined,
): WorkspaceConnectionProviderSummary | undefined {
  const providerId = getWorkspaceProviderIdForSource(source);
  if (!providerId) return undefined;

  const providerStatus = data?.providers?.find(
    (provider) => provider.provider === providerId,
  );
  if (providerStatus?.workspaceConnection) {
    return providerStatus.workspaceConnection;
  }

  return data?.workspaceConnections?.providers.find(
    (provider) =>
      provider.provider === providerId || provider.id === providerId,
  );
}

export function getProviderStatusForSource(
  source: DataSource,
  data: DataSourceStatusResponse | undefined,
): DataSourceProviderStatus | undefined {
  const providerId = getWorkspaceProviderIdForSource(source) ?? source.id;
  return data?.providers?.find((provider) => provider.provider === providerId);
}

export function getSharedConnectionStatus(
  source: DataSource,
  data: DataSourceStatusResponse | undefined,
  envStatus: EnvKeyStatus[],
): SharedConnectionStatus | null {
  const providerId = getWorkspaceProviderIdForSource(source);
  if (!providerId) return null;

  const connection = getWorkspaceConnectionForSource(source, data);
  const localConfigured = isSourceConfigured(source, envStatus);
  const providerLabel =
    data?.providers?.find((provider) => provider.provider === providerId)
      ?.label ??
    data?.workspaceConnections?.providers.find(
      (provider) =>
        provider.provider === providerId || provider.id === providerId,
    )?.label ??
    source.name;

  let kind: SharedConnectionStatusKind;
  if (connection?.grantState === "connected") {
    kind = "ready";
  } else if (connection?.grantState === "needs_grant") {
    kind = "needs_grant";
  } else if (localConfigured) {
    kind = "local_credentials";
  } else {
    kind = "needs_credentials";
  }

  return {
    kind,
    label: sharedConnectionLabels[kind],
    providerId,
    providerLabel,
    connection,
  };
}

export function isSourceReady(
  source: DataSource,
  data: DataSourceStatusResponse | undefined,
  envStatus: EnvKeyStatus[],
): boolean {
  return (
    isSourceConfigured(source, envStatus) ||
    getProviderStatusForSource(source, data)?.configured === true ||
    getSharedConnectionStatus(source, data, envStatus)?.kind === "ready"
  );
}

export function isSourceLocallyConfigured(
  source: DataSource,
  data: DataSourceStatusResponse | undefined,
  envStatus: EnvKeyStatus[],
): boolean {
  if (isSourceConfigured(source, envStatus)) return true;
  const providerStatus = getProviderStatusForSource(source, data);
  if (!providerStatus?.configured) return false;
  return providerStatus.configuredKeys.length > 0;
}

export function getConfiguredDataSources(
  envStatus: EnvKeyStatus[],
  data?: DataSourceStatusResponse,
): DataSource[] {
  return dataSources.filter((source) =>
    data
      ? isSourceReady(source, data, envStatus)
      : isSourceConfigured(source, envStatus),
  );
}
