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

export type WorkspaceConnectionStatus =
  | "connected"
  | "checking"
  | "needs_reauth"
  | "error"
  | "disabled";

export interface WorkspaceConnectionStatusEntry {
  id: string;
  status: WorkspaceConnectionStatus;
  grantedToApp: boolean;
}

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
  statuses?: WorkspaceConnectionStatus[];
  connections?: WorkspaceConnectionStatusEntry[];
}

export interface DataSourceProviderStatus {
  provider: string;
  label: string;
  setupLink?: string;
  configured: boolean | null;
  ready?: boolean | null;
  credentialsConfigured?: boolean | null;
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
  | "local_credentials"
  | "needs_reauth"
  | "error";

export interface SharedConnectionStatus {
  kind: SharedConnectionStatusKind;
  label: string;
  providerId: string;
  providerLabel: string;
  connection?: WorkspaceConnectionProviderSummary;
}

const dataSourceWorkspaceProviderIds: Record<string, string> = {
  bigquery: "bigquery",
  github: "github",
  hubspot: "hubspot",
  jira: "jira",
  notion: "notion",
  sentry: "sentry",
  slack: "slack",
};

const workspaceOAuthSourceIds = new Set([
  "bigquery",
  "notion",
  "hubspot",
  "jira",
  "sentry",
]);

export function isWorkspaceOAuthSource(source: DataSource): boolean {
  return workspaceOAuthSourceIds.has(source.id);
}

export function canConnectWorkspaceOAuth(
  source: DataSource,
  canManageOrg: boolean,
  hasOrg: boolean,
): boolean {
  return source.id === "bigquery" ? hasOrg : canManageOrg;
}

export function shouldShowWorkspaceOAuthSetup(
  source: DataSource,
  status: SharedConnectionStatus | null,
  canManageOrg: boolean,
): boolean {
  return (
    (canManageOrg || source.id === "bigquery") &&
    (status?.kind === "needs_credentials" ||
      status?.kind === "needs_grant" ||
      status?.kind === "needs_reauth" ||
      status?.kind === "error") &&
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
    source.id !== "bigquery" &&
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
    (canManageOrg || source.id === "bigquery") &&
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

export function getGoogleSheetsConnection(
  data: DataSourceStatusResponse | undefined,
): WorkspaceConnectionProviderSummary | undefined {
  return data?.workspaceConnections?.providers.find(
    (provider) =>
      provider.provider === "google_sheets" || provider.id === "google_sheets",
  );
}

const sharedConnectionLabels: Record<SharedConnectionStatusKind, string> = {
  ready: "Ready via workspace",
  needs_grant: "Available in workspace",
  needs_credentials: "Not connected",
  local_credentials: "Configured in this app",
  needs_reauth: "Reconnect needed",
  error: "Connection error",
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
  if (source.id === "bigquery") {
    return (
      statusMap.get("BIGQUERY_PROJECT_ID") === true &&
      statusMap.get("GOOGLE_APPLICATION_CREDENTIALS_JSON") === true
    );
  }
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

export function getGrantedWorkspaceConnectionStatuses(
  connection: WorkspaceConnectionProviderSummary | undefined,
): WorkspaceConnectionStatus[] {
  return (
    connection?.connections
      ?.filter(({ grantedToApp }) => grantedToApp)
      .map(({ status }) => status) ?? []
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
  const grantedStatuses = new Set(
    getGrantedWorkspaceConnectionStatuses(connection),
  );
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
  const bigQueryProjectConfigured = envStatus.some(
    (status) =>
      normalizeCredentialKey(status.key) === "BIGQUERY_PROJECT_ID" &&
      status.configured,
  );
  if (
    connection?.grantState === "connected" &&
    (source.id !== "bigquery" || bigQueryProjectConfigured)
  ) {
    kind = "ready";
  } else if (connection?.grantState === "needs_grant") {
    kind = "needs_grant";
  } else if (
    (connection?.grantState === "granted" ||
      connection?.hasGrantedWorkspaceConnection === true) &&
    grantedStatuses.has("needs_reauth")
  ) {
    kind = "needs_reauth";
  } else if (
    (connection?.grantState === "granted" ||
      connection?.hasGrantedWorkspaceConnection === true) &&
    grantedStatuses.has("error")
  ) {
    kind = "error";
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

export function hasExistingWorkspaceConnection(
  status: SharedConnectionStatus | null,
): boolean {
  const connection = status?.connection;
  if (
    !connection ||
    connection.grantState === "needs_grant" ||
    connection.grantState === "not_connected"
  ) {
    return false;
  }
  return (
    connection.hasGrantedWorkspaceConnection === true ||
    connection.grantState === "granted" ||
    connection.grantState === "connected"
  );
}

export function isSourceReady(
  source: DataSource,
  data: DataSourceStatusResponse | undefined,
  envStatus: EnvKeyStatus[],
): boolean {
  const providerStatus = getProviderStatusForSource(source, data);
  const workspaceConnection = getWorkspaceConnectionForSource(source, data);
  if (source.id === "bigquery") {
    const projectConfigured = envStatus.some(
      (status) =>
        normalizeCredentialKey(status.key) === "BIGQUERY_PROJECT_ID" &&
        status.configured,
    );
    const serviceAccountConfigured = envStatus.some(
      (status) =>
        normalizeCredentialKey(status.key) ===
          "GOOGLE_APPLICATION_CREDENTIALS_JSON" && status.configured,
    );
    return (
      projectConfigured &&
      (serviceAccountConfigured ||
        workspaceConnection?.grantState === "connected")
    );
  }
  if (providerStatus?.ready !== undefined && providerStatus.ready !== null) {
    return providerStatus.ready;
  }

  const providerReady =
    providerStatus?.credentialsConfigured === true ||
    (providerStatus?.credentialsConfigured !== false &&
      providerStatus?.configured === true &&
      workspaceConnection?.grantState !== "granted" &&
      workspaceConnection?.grantState !== "needs_grant");
  return (
    isSourceConfigured(source, envStatus) ||
    providerReady ||
    getSharedConnectionStatus(source, data, envStatus)?.kind === "ready"
  );
}

export function isSourceLocallyConfigured(
  source: DataSource,
  data: DataSourceStatusResponse | undefined,
  envStatus: EnvKeyStatus[],
): boolean {
  if (source.id === "bigquery") {
    return (
      envStatus.some(
        (status) =>
          normalizeCredentialKey(status.key) === "BIGQUERY_PROJECT_ID" &&
          status.configured,
      ) &&
      envStatus.some(
        (status) =>
          normalizeCredentialKey(status.key) ===
            "GOOGLE_APPLICATION_CREDENTIALS_JSON" && status.configured,
      )
    );
  }
  if (isSourceConfigured(source, envStatus)) return true;
  const providerStatus = getProviderStatusForSource(source, data);
  if (providerStatus?.credentialsConfigured === false) return false;
  if (isSourceConfigured(source, envStatus)) return true;
  if (!providerStatus?.configured) return false;
  if (providerStatus.credentialsConfigured === true) return true;
  const configuredKeys = Array.isArray(providerStatus.configuredKeys)
    ? providerStatus.configuredKeys.filter(
        (key): key is string => typeof key === "string",
      )
    : [];
  const optionalCredentialKeys = Array.isArray(providerStatus.optionalKeys)
    ? providerStatus.optionalKeys.filter(
        (key): key is string => typeof key === "string",
      )
    : [];
  const optionalKeys = new Set(
    optionalCredentialKeys.map(normalizeCredentialKey),
  );
  return configuredKeys.some(
    (key) => !optionalKeys.has(normalizeCredentialKey(key)),
  );
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
