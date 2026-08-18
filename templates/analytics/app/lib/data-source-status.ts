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
  setupLink?: string;
  // null when the workspace-connection lookup failed: unreadable, not absent.
  configured: boolean | null;
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
  jira: "jira",
  notion: "notion",
  sentry: "sentry",
  slack: "slack",
};

const workspaceOAuthSourceIds = new Set([
  "notion",
  "hubspot",
  "jira",
  "sentry",
]);

export function isWorkspaceOAuthSource(source: DataSource): boolean {
  return workspaceOAuthSourceIds.has(source.id);
}

export function shouldShowWorkspaceOAuthSetup(
  source: DataSource,
  status: SharedConnectionStatus | null,
  canManageOrg: boolean,
): boolean {
  return (
    canManageOrg &&
    (status?.kind === "needs_credentials" || status?.kind === "needs_grant") &&
    isWorkspaceOAuthSource(source)
  );
}

export function shouldShowWorkspaceOAuthAdminNotice(
  source: DataSource,
  ready: boolean,
  canManageOrg: boolean,
  orgLoaded = true,
  hasOrg = true,
): boolean {
  return (
    orgLoaded &&
    hasOrg &&
    !canManageOrg &&
    !ready &&
    isWorkspaceOAuthSource(source)
  );
}

export function shouldOfferWorkspaceOAuthReconnect(
  source: DataSource,
  status: SharedConnectionStatus | null,
  canManageOrg: boolean,
  connectionTestFailed: boolean,
): boolean {
  return (
    canManageOrg &&
    connectionTestFailed &&
    status?.kind === "ready" &&
    isWorkspaceOAuthSource(source)
  );
}

export type FocusedDataSourceResolution =
  | { status: "none" }
  | { status: "found"; source: DataSource }
  | { status: "unknown"; requestedId: string };

export function focusedDataSourceFromSearchParams(
  searchParams: URLSearchParams,
): FocusedDataSourceResolution {
  const requestedSourceId = searchParams.get("source")?.trim().toLowerCase();
  if (!requestedSourceId) return { status: "none" };

  // Keep links emitted before PostgreSQL's provider id was aligned with the
  // UI source id working instead of silently dropping their focus.
  const sourceId =
    requestedSourceId === "postgres" ? "postgresql" : requestedSourceId;
  const source = dataSources.find((candidate) => candidate.id === sourceId);
  return source
    ? { status: "found", source }
    : { status: "unknown", requestedId: requestedSourceId };
}

export function dataSourceOAuthReturnPath(
  source: DataSource | undefined,
  returnToAsk: boolean,
): string {
  const params = new URLSearchParams();
  if (source) params.set("source", source.id);
  if (returnToAsk) params.set("returnTo", "ask");
  const query = params.toString();
  return query ? `/data-sources?${query}` : "/data-sources";
}

export function getGoogleDriveConnection(
  data: DataSourceStatusResponse | undefined,
): WorkspaceConnectionProviderSummary | undefined {
  return data?.workspaceConnections?.providers.find(
    (provider) =>
      provider.provider === "google_drive" || provider.id === "google_drive",
  );
}

const sharedConnectionLabels: Record<SharedConnectionStatusKind, string> = {
  ready: "Ready via workspace",
  needs_grant: "Available in workspace",
  needs_credentials: "Not connected",
  local_credentials: "Configured in this app",
};

function normalizeCredentialKey(key: string): string {
  return key.trim().toUpperCase();
}

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
      .map((step) =>
        step.inputKey ? normalizeCredentialKey(step.inputKey) : undefined,
      )
      .filter((k): k is string => Boolean(k)),
  );
}

export function isSourceConfigured(
  source: DataSource,
  envStatus: EnvKeyStatus[],
): boolean {
  const statusMap = new Map(
    envStatus.map((s) => [normalizeCredentialKey(s.key), s.configured]),
  );
  const optionalKeys = getOptionalCredentialKeys(source);
  const requiredKeys = source.envKeys.filter(
    (key) => !optionalKeys.has(normalizeCredentialKey(key)),
  );
  if (source.credentialRequirementMode === "any") {
    return requiredKeys.some(
      (key) => statusMap.get(normalizeCredentialKey(key)) === true,
    );
  }
  return requiredKeys.every(
    (key) => statusMap.get(normalizeCredentialKey(key)) === true,
  );
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
