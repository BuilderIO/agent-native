import { resolveCredential, type CredentialContext } from "./credentials";
import type { WorkspaceConnectionCredentialResolution } from "@agent-native/core/workspace-connections";
import { resolveWorkspaceConnectionCredentialForApp } from "@agent-native/core/workspace-connections";
import type { SecretRef } from "@agent-native/core/secrets";

export const ANALYTICS_APP_ID = "analytics";

export const HUBSPOT_ANALYTICS_CREDENTIAL_KEYS = [
  "HUBSPOT_PRIVATE_APP_TOKEN",
  "HUBSPOT_ACCESS_TOKEN",
] as const;

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

export async function resolveAnalyticsProviderCredential(
  options: ResolveProviderCredentialOptions,
): Promise<AnalyticsProviderCredential | null> {
  const workspaceCredential =
    await resolveWorkspaceConnectionProviderCredential(options);
  if (workspaceCredential) return workspaceCredential;
  if (options.connectionId?.trim()) return null;
  return resolveLocalAnalyticsProviderCredential(options);
}

export async function hasAnalyticsProviderCredential(
  options: ResolveProviderCredentialOptions,
): Promise<boolean> {
  return (await resolveAnalyticsProviderCredential(options)) !== null;
}
