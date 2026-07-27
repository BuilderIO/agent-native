import type { WorkspaceConnectionTemplateUse } from "@agent-native/core/connections/runtime";
import {
  PROVIDER_API_IDS,
  createProviderApiRuntime as createRuntimeProviderApiRuntime,
  deleteGitHubRepositoryFile as deleteRuntimeGitHubRepositoryFile,
  executeProviderApiRequest as executeRuntimeProviderApiRequest,
  fetchProviderApiDocs as fetchRuntimeProviderApiDocs,
  getProviderApiConfig as getRuntimeProviderApiConfig,
  listGitHubRepositoryFiles as listRuntimeGitHubRepositoryFiles,
  listProviderApiCatalog as listRuntimeProviderApiCatalog,
  mergeProviderApiConfigs as mergeRuntimeProviderApiConfigs,
  readGitHubRepositoryFile as readRuntimeGitHubRepositoryFile,
  resolveProviderApiOAuthAccessToken as resolveRuntimeProviderApiOAuthAccessToken,
  searchGitHubRepositoryFiles as searchRuntimeGitHubRepositoryFiles,
  writeGitHubRepositoryFile as writeRuntimeGitHubRepositoryFile,
  type ProviderApiConfig,
  type ProviderApiId,
  type ProviderApiRuntime,
  type ProviderApiRuntimeOptions,
} from "@agent-native/core/provider-api/runtime";

export * from "@agent-native/core/provider-api/runtime";

const provider = (id: ProviderApiId): ProviderApiConfig => ({
  ...getRuntimeProviderApiConfig(id),
});

export const providerApiOverrides: ProviderApiConfig[] = [
  provider("amplitude"),
  provider("apollo"),
  provider("bigquery"),
  provider("clay"),
  provider("commonroom"),
  provider("dataforseo"),
  provider("ga4"),
  provider("gcloud"),
  provider("github"),
  provider("figma"),
  provider("gmail"),
  provider("gong"),
  provider("google_calendar"),
  provider("google_drive"),
  provider("google_slides"),
  provider("granola"),
  provider("grafana"),
  provider("hubspot"),
  provider("salesforce"),
  provider("jira"),
  provider("mixpanel"),
  provider("notion"),
  provider("posthog"),
  provider("prometheus"),
  provider("pylon"),
  provider("sentry"),
  provider("slack"),
  provider("stripe"),
  provider("twitter"),
];

function withLocalOverrides(
  overrides: readonly ProviderApiConfig[] = [],
): ProviderApiConfig[] {
  return [...providerApiOverrides, ...overrides];
}

function withLocalRuntimeOverrides(
  runtime: ProviderApiRuntimeOptions,
): ProviderApiRuntimeOptions {
  return {
    ...runtime,
    providerOverrides: withLocalOverrides(runtime.providerOverrides),
  };
}

export function mergeProviderApiConfigs(
  overrides: readonly ProviderApiConfig[] = [],
): ProviderApiConfig[] {
  return mergeRuntimeProviderApiConfigs(withLocalOverrides(overrides));
}

export function getProviderApiConfig(
  providerId: ProviderApiId | string,
  overrides: readonly ProviderApiConfig[] = [],
): ProviderApiConfig {
  return getRuntimeProviderApiConfig(providerId, withLocalOverrides(overrides));
}

export function listProviderApiIdsForTemplateUse(
  templateUse: WorkspaceConnectionTemplateUse,
  overrides: readonly ProviderApiConfig[] = [],
): ProviderApiId[] {
  const configs = new Map(
    mergeProviderApiConfigs(overrides).map((config) => [config.id, config]),
  );
  return PROVIDER_API_IDS.filter((id) =>
    (configs.get(id)?.templateUses ?? []).includes(templateUse),
  );
}

export function listProviderApiCatalog(
  providerId?: ProviderApiId | string,
  options: Parameters<typeof listRuntimeProviderApiCatalog>[1] = {},
) {
  return listRuntimeProviderApiCatalog(providerId, {
    ...options,
    providerOverrides: withLocalOverrides(options.providerOverrides),
  });
}

export function createProviderApiRuntime(
  options: ProviderApiRuntimeOptions,
): ProviderApiRuntime {
  return createRuntimeProviderApiRuntime(withLocalRuntimeOverrides(options));
}

export function fetchProviderApiDocs(
  options: Parameters<typeof fetchRuntimeProviderApiDocs>[0],
  runtime: ProviderApiRuntimeOptions = { appId: "app" },
): ReturnType<typeof fetchRuntimeProviderApiDocs> {
  return fetchRuntimeProviderApiDocs(
    options,
    withLocalRuntimeOverrides(runtime),
  );
}

export function executeProviderApiRequest(
  args: Parameters<typeof executeRuntimeProviderApiRequest>[0],
  runtime: ProviderApiRuntimeOptions,
): ReturnType<typeof executeRuntimeProviderApiRequest> {
  return executeRuntimeProviderApiRequest(
    args,
    withLocalRuntimeOverrides(runtime),
  );
}

export function resolveProviderApiOAuthAccessToken(
  args: Parameters<typeof resolveRuntimeProviderApiOAuthAccessToken>[0],
  runtime: ProviderApiRuntimeOptions,
): ReturnType<typeof resolveRuntimeProviderApiOAuthAccessToken> {
  return resolveRuntimeProviderApiOAuthAccessToken(
    args,
    withLocalRuntimeOverrides(runtime),
  );
}

export function listGitHubRepositoryFiles(
  args: Parameters<typeof listRuntimeGitHubRepositoryFiles>[0],
  runtime: ProviderApiRuntimeOptions,
): ReturnType<typeof listRuntimeGitHubRepositoryFiles> {
  return listRuntimeGitHubRepositoryFiles(
    args,
    withLocalRuntimeOverrides(runtime),
  );
}

export function searchGitHubRepositoryFiles(
  args: Parameters<typeof searchRuntimeGitHubRepositoryFiles>[0],
  runtime: ProviderApiRuntimeOptions,
): ReturnType<typeof searchRuntimeGitHubRepositoryFiles> {
  return searchRuntimeGitHubRepositoryFiles(
    args,
    withLocalRuntimeOverrides(runtime),
  );
}

export function readGitHubRepositoryFile(
  args: Parameters<typeof readRuntimeGitHubRepositoryFile>[0],
  runtime: ProviderApiRuntimeOptions,
): ReturnType<typeof readRuntimeGitHubRepositoryFile> {
  return readRuntimeGitHubRepositoryFile(
    args,
    withLocalRuntimeOverrides(runtime),
  );
}

export function writeGitHubRepositoryFile(
  args: Parameters<typeof writeRuntimeGitHubRepositoryFile>[0],
  runtime: ProviderApiRuntimeOptions,
): ReturnType<typeof writeRuntimeGitHubRepositoryFile> {
  return writeRuntimeGitHubRepositoryFile(
    args,
    withLocalRuntimeOverrides(runtime),
  );
}

export function deleteGitHubRepositoryFile(
  args: Parameters<typeof deleteRuntimeGitHubRepositoryFile>[0],
  runtime: ProviderApiRuntimeOptions,
): ReturnType<typeof deleteRuntimeGitHubRepositoryFile> {
  return deleteRuntimeGitHubRepositoryFile(
    args,
    withLocalRuntimeOverrides(runtime),
  );
}
