import { dataSources, type DataSource } from "@/lib/data-sources";

export interface EnvKeyStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

export interface DataSourceStatusResponse {
  credentials?: EnvKeyStatus[];
  error?: string;
  message?: string;
  settingsPath?: string;
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
      .map((step) => step.inputKey)
      .filter(Boolean),
  );
}

export function isSourceConfigured(
  source: DataSource,
  envStatus: EnvKeyStatus[],
): boolean {
  const statusMap = new Map(envStatus.map((s) => [s.key, s.configured]));
  const optionalKeys = getOptionalCredentialKeys(source);
  return source.envKeys
    .filter((key) => !optionalKeys.has(key))
    .every((key) => statusMap.get(key) === true);
}

export function getConfiguredDataSources(
  envStatus: EnvKeyStatus[],
): DataSource[] {
  return dataSources.filter((source) => isSourceConfigured(source, envStatus));
}
