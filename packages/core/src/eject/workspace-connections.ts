import {
  WORKSPACE_CONNECTION_PROVIDERS as RUNTIME_WORKSPACE_CONNECTION_PROVIDERS,
  getWorkspaceConnectionProvider as getRuntimeWorkspaceConnectionProvider,
  listWorkspaceConnectionProviders as listRuntimeWorkspaceConnectionProviders,
  mergeWorkspaceConnectionProviders as mergeRuntimeWorkspaceConnectionProviders,
  type ListWorkspaceConnectionProvidersOptions,
  type WorkspaceConnectionCapability,
  type WorkspaceConnectionProvider,
  type WorkspaceConnectionTemplateUse,
} from "@agent-native/core/connections/runtime";

export * from "@agent-native/core/connections/runtime";

export const WORKSPACE_CONNECTION_PROVIDERS: WorkspaceConnectionProvider[] = [
  "slack",
  "github",
  "figma",
  "notion",
  "gmail",
  "google_drive",
  "hubspot",
  "jira",
  "sentry",
  "granola",
  "clips",
  "generic",
].map((id) => ({
  ...RUNTIME_WORKSPACE_CONNECTION_PROVIDERS.find(
    (provider) => provider.id === id,
  )!,
}));

export const workspaceConnectionProviderOverrides =
  WORKSPACE_CONNECTION_PROVIDERS;

function withLocalOverrides(
  overrides: readonly WorkspaceConnectionProvider[] = [],
): WorkspaceConnectionProvider[] {
  return [...workspaceConnectionProviderOverrides, ...overrides];
}

export function mergeWorkspaceConnectionProviders(
  overrides: readonly WorkspaceConnectionProvider[] = [],
): WorkspaceConnectionProvider[] {
  return mergeRuntimeWorkspaceConnectionProviders(
    withLocalOverrides(overrides),
  );
}

export function listWorkspaceConnectionProviders(
  options: ListWorkspaceConnectionProvidersOptions = {},
): WorkspaceConnectionProvider[] {
  return listRuntimeWorkspaceConnectionProviders({
    ...options,
    providerOverrides: withLocalOverrides(options.providerOverrides),
  });
}

export function getWorkspaceConnectionProvider(
  id: string,
  overrides: readonly WorkspaceConnectionProvider[] = [],
): WorkspaceConnectionProvider | undefined {
  return getRuntimeWorkspaceConnectionProvider(
    id,
    withLocalOverrides(overrides),
  );
}

export function listWorkspaceConnectionProvidersForTemplate(
  templateUse: WorkspaceConnectionTemplateUse,
  providerOverrides: readonly WorkspaceConnectionProvider[] = [],
): WorkspaceConnectionProvider[] {
  return listWorkspaceConnectionProviders({ templateUse, providerOverrides });
}

export function listWorkspaceConnectionProvidersForCapability(
  capability: WorkspaceConnectionCapability,
  providerOverrides: readonly WorkspaceConnectionProvider[] = [],
): WorkspaceConnectionProvider[] {
  return listWorkspaceConnectionProviders({ capability, providerOverrides });
}

export function workspaceConnectionProviderSupports(
  providerOrId: WorkspaceConnectionProvider | string,
  capability: WorkspaceConnectionCapability,
): boolean {
  const provider =
    typeof providerOrId === "string"
      ? getWorkspaceConnectionProvider(providerOrId)
      : providerOrId;
  return provider?.capabilities.includes(capability) ?? false;
}
