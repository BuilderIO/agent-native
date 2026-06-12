import { resolveCredential, type CredentialContext } from "./credentials";
import type { WorkspaceConnectionCredentialResolution } from "@agent-native/core/workspace-connections";
import { resolveWorkspaceConnectionCredentialForApp } from "@agent-native/core/workspace-connections";
import type { SecretRef } from "@agent-native/core/secrets";

export const ANALYTICS_APP_ID = "analytics";

export const HUBSPOT_ANALYTICS_CREDENTIAL_KEYS = [
  "HUBSPOT_PRIVATE_APP_TOKEN",
  "HUBSPOT_ACCESS_TOKEN",
] as const;

export const GONG_ANALYTICS_CREDENTIAL_KEYS = [
  "GONG_ACCESS_KEY",
  "GONG_ACCESS_SECRET",
] as const;

const GONG_LEGACY_API_KEY = "GONG_API_KEY";

export type AnalyticsProviderCredentialSource =
  | "workspace_connection"
  | "analytics_local";

export interface AnalyticsProviderCredential {
  value: string;
  key: string;
  provider: string;
  source: AnalyticsProviderCredentialSource;
  connectionId?: string;
  connectionLabel?: string;
  scope?: SecretRef["scope"];
}

export interface ResolveProviderCredentialOptions {
  provider: string;
  keys: string | readonly string[];
  ctx: CredentialContext;
  workspaceConnection?: boolean;
  connectionId?: string | null;
}

export interface AnalyticsGongCredentials {
  accessKey: string;
  accessSecret: string;
  sources: AnalyticsProviderCredential[];
}

function normalizeKey(key: string): string {
  return key.trim().toUpperCase();
}

function uniqueKeys(keys: string | readonly string[]): string[] {
  const rawKeys = Array.isArray(keys) ? [...keys] : [keys];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const key of rawKeys) {
    const normalized = normalizeKey(key);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeCoreCredentialResult(
  result: WorkspaceConnectionCredentialResolution,
  fallback: { provider: string; key: string },
): AnalyticsProviderCredential | null {
  if (!result.available || !result.value) return null;
  const scope =
    result.provenance?.secretScope === "user" ||
    result.provenance?.secretScope === "org" ||
    result.provenance?.secretScope === "workspace"
      ? result.provenance.secretScope
      : undefined;
  return {
    value: result.value,
    key: result.provenance?.resolvedKey ?? result.key ?? fallback.key,
    provider: result.provider ?? fallback.provider,
    source: "workspace_connection",
    connectionId: result.provenance?.connectionId,
    connectionLabel: result.provenance?.connectionLabel,
    scope,
  };
}

function isGongAuthKey(
  key: string,
): key is (typeof GONG_ANALYTICS_CREDENTIAL_KEYS)[number] {
  return (GONG_ANALYTICS_CREDENTIAL_KEYS as readonly string[]).includes(
    normalizeKey(key),
  );
}

function parseLegacyGongApiKey(
  value: string,
): { accessKey: string; accessSecret: string } | null {
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const accessKey = value.slice(0, separator).trim();
  const accessSecret = value.slice(separator + 1).trim();
  if (!accessKey || !accessSecret) return null;
  return { accessKey, accessSecret };
}

function deriveGongCredentialFromLegacy(
  credential: AnalyticsProviderCredential,
  requestedKey: string,
): AnalyticsProviderCredential | null {
  const parsed = parseLegacyGongApiKey(credential.value);
  if (!parsed) return null;
  return {
    ...credential,
    key: GONG_LEGACY_API_KEY,
    value:
      normalizeKey(requestedKey) === "GONG_ACCESS_SECRET"
        ? parsed.accessSecret
        : parsed.accessKey,
  };
}

async function resolveViaCoreHelper({
  provider,
  keys,
  ctx,
  connectionId,
}: {
  provider: string;
  keys: string[];
  ctx: CredentialContext;
  connectionId?: string | null;
}): Promise<AnalyticsProviderCredential | null> {
  const normalizedConnectionId = connectionId?.trim() || undefined;
  for (const key of keys) {
    const result = await resolveWorkspaceConnectionCredentialForApp({
      appId: ANALYTICS_APP_ID,
      provider,
      key,
      connectionId: normalizedConnectionId,
      userEmail: ctx.userEmail,
      orgId: ctx.orgId,
    });
    const credential = normalizeCoreCredentialResult(result, {
      provider,
      key,
    });
    if (credential) return credential;
  }

  return null;
}

export async function resolveWorkspaceConnectionProviderCredential(
  options: ResolveProviderCredentialOptions,
): Promise<AnalyticsProviderCredential | null> {
  if (options.workspaceConnection === false) return null;
  const keys = uniqueKeys(options.keys);
  if (keys.length === 0) return null;

  return resolveViaCoreHelper({
    provider: options.provider,
    keys,
    ctx: options.ctx,
    connectionId: options.connectionId,
  });
}

export async function resolveLocalAnalyticsProviderCredential(
  options: ResolveProviderCredentialOptions,
): Promise<AnalyticsProviderCredential | null> {
  const keys = uniqueKeys(options.keys);
  for (const key of keys) {
    const value = await resolveCredential(key, options.ctx);
    if (value) {
      return {
        value,
        key,
        provider: options.provider,
        source: "analytics_local",
      };
    }
  }
  return null;
}

async function resolveLegacyGongProviderCredential(
  options: ResolveProviderCredentialOptions,
  requestedKey: string,
): Promise<AnalyticsProviderCredential | null> {
  if (
    normalizeKey(options.provider) !== "GONG" ||
    !isGongAuthKey(requestedKey)
  ) {
    return null;
  }

  const legacyOptions = { ...options, keys: [GONG_LEGACY_API_KEY] };
  if (options.workspaceConnection !== false) {
    const workspaceCredential =
      await resolveWorkspaceConnectionProviderCredential(legacyOptions);
    const derived = workspaceCredential
      ? deriveGongCredentialFromLegacy(workspaceCredential, requestedKey)
      : null;
    if (derived) return derived;
  }

  if (options.connectionId?.trim()) return null;

  const localCredential =
    await resolveLocalAnalyticsProviderCredential(legacyOptions);
  return localCredential
    ? deriveGongCredentialFromLegacy(localCredential, requestedKey)
    : null;
}

export async function resolveAnalyticsProviderCredential(
  options: ResolveProviderCredentialOptions,
): Promise<AnalyticsProviderCredential | null> {
  const keys = uniqueKeys(options.keys);
  const workspaceCredential =
    await resolveWorkspaceConnectionProviderCredential({ ...options, keys });
  if (workspaceCredential) return workspaceCredential;

  if (!options.connectionId?.trim()) {
    const localCredential = await resolveLocalAnalyticsProviderCredential({
      ...options,
      keys,
    });
    if (localCredential) return localCredential;
  }

  for (const key of keys) {
    const legacyGongCredential = await resolveLegacyGongProviderCredential(
      options,
      key,
    );
    if (legacyGongCredential) return legacyGongCredential;
  }

  return null;
}

export async function resolveAnalyticsGongCredentials(
  options: Omit<ResolveProviderCredentialOptions, "provider" | "keys">,
): Promise<AnalyticsGongCredentials | null> {
  const accessKey = await resolveAnalyticsProviderCredential({
    ...options,
    provider: "gong",
    keys: ["GONG_ACCESS_KEY"],
  });
  const accessSecret = await resolveAnalyticsProviderCredential({
    ...options,
    provider: "gong",
    keys: ["GONG_ACCESS_SECRET"],
  });
  if (!accessKey?.value || !accessSecret?.value) return null;
  return {
    accessKey: accessKey.value,
    accessSecret: accessSecret.value,
    sources:
      accessKey.key === accessSecret.key
        ? [accessKey]
        : [accessKey, accessSecret],
  };
}

export async function hasAnalyticsProviderCredential(
  options: ResolveProviderCredentialOptions,
): Promise<boolean> {
  return (await resolveAnalyticsProviderCredential(options)) !== null;
}
