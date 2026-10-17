import {
  fail,
  isAgentConnectionRequiredError,
} from "@agent-native/core/action";
import {
  isProviderApiId,
  resolveProviderApiOAuthAccessToken,
} from "@agent-native/core/provider-api";
import type { SecretRef } from "@agent-native/core/secrets";
import { getRequestContext } from "@agent-native/core/server";
import type { WorkspaceConnectionCredentialResolution } from "@agent-native/core/workspace-connections";
import {
  resolveWorkspaceConnectionCredentialForApp,
  resolveWorkspaceConnectionForApp,
} from "@agent-native/core/workspace-connections";

import {
  resolveCredentialDetailed,
  type CredentialContext,
} from "./credentials";
import {
  parseSigmaDirectCredentials,
  SIGMA_DIRECT_CREDENTIALS_KEY,
  SIGMA_DIRECT_CONNECTION_MARKER,
  SIGMA_PROVIDER_ID,
  sigmaCredentialField,
} from "./sigma-connection";

export const ANALYTICS_APP_ID = "analytics";

export const HUBSPOT_ANALYTICS_CREDENTIAL_KEYS = [
  "HUBSPOT_PRIVATE_APP_TOKEN",
  "HUBSPOT_ACCESS_TOKEN",
] as const;

export const CLAY_ANALYTICS_CREDENTIAL_KEYS = ["CLAY_PUBLIC_API_KEY"] as const;

export const BUILDER_ANALYTICS_CREDENTIAL_KEYS = [
  "BUILDER_PUBLIC_KEY",
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
  scopeId?: string;
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

interface SigmaDirectCredentialSnapshot {
  credentials: NonNullable<ReturnType<typeof parseSigmaDirectCredentials>>;
  connectionLabel: string;
}

type SigmaDirectCredentialRead =
  | { kind: "not-direct" }
  | { kind: "direct"; snapshot: SigmaDirectCredentialSnapshot };

const sigmaDirectCredentialReads = new WeakMap<
  object,
  Map<string, Promise<SigmaDirectCredentialRead>>
>();

async function readSigmaDirectCredentials(
  orgId: string,
  connectionId: string,
  ctx: CredentialContext,
): Promise<SigmaDirectCredentialRead> {
  const requestContext = getRequestContext();
  if (!requestContext) {
    throw new Error("Sigma credentials require a request-scoped context.");
  }
  let requestCache = sigmaDirectCredentialReads.get(requestContext);
  if (!requestCache) {
    requestCache = new Map();
    sigmaDirectCredentialReads.set(requestContext, requestCache);
  }
  const cacheKey = `${orgId}:${connectionId}`;
  let result = requestCache.get(cacheKey);
  if (!result) {
    result = (async () => {
      const connection = await resolveWorkspaceConnectionForApp({
        appId: ANALYTICS_APP_ID,
        provider: SIGMA_PROVIDER_ID,
        connectionId,
        requireConnected: true,
      });
      if (
        !connection.available ||
        connection.connection?.config.analyticsSetup !==
          SIGMA_DIRECT_CONNECTION_MARKER
      ) {
        return { kind: "not-direct" };
      }

      const directConnection = connection.connection;
      const credentialRef = directConnection.credentialRefs[0];
      if (
        directConnection.allowedApps.length !== 1 ||
        directConnection.allowedApps[0] !== ANALYTICS_APP_ID ||
        directConnection.allowedUsers.length > 0 ||
        (directConnection.allowedUserGroups?.length ?? 0) > 0 ||
        directConnection.credentialRefs.length !== 1 ||
        credentialRef?.key !== SIGMA_DIRECT_CREDENTIALS_KEY ||
        credentialRef.scope !== "org" ||
        credentialRef.provider !== "sigma"
      ) {
        fail("The Analytics Sigma connection access policy is invalid.", {
          errorCode: "sigma_connection_policy_invalid",
          statusCode: 409,
        });
      }

      const resolution = await resolveWorkspaceConnectionCredentialForApp({
        appId: ANALYTICS_APP_ID,
        provider: SIGMA_PROVIDER_ID,
        key: SIGMA_DIRECT_CREDENTIALS_KEY,
        connectionId,
        userEmail: ctx.userEmail,
        orgId,
        credentialScope: "org",
      });
      const provenance = resolution.provenance;
      if (
        !resolution.available ||
        resolution.status !== "resolved" ||
        !resolution.value ||
        !provenance
      ) {
        fail("The saved Analytics Sigma credentials could not be read.", {
          errorCode: "sigma_direct_credentials_unavailable",
          statusCode: 503,
        });
      }
      if (
        provenance.connectionId !== connectionId ||
        provenance.credentialRef.source !== "connection" ||
        provenance.credentialRef.key !== SIGMA_DIRECT_CREDENTIALS_KEY ||
        provenance.credentialRef.scope !== "org" ||
        provenance.credentialRef.provider !== "sigma" ||
        provenance.secretScope !== "org"
      ) {
        fail(
          "The Analytics Sigma connection credential reference is invalid.",
          {
            errorCode: "sigma_connection_policy_invalid",
            statusCode: 409,
          },
        );
      }

      const credentials = parseSigmaDirectCredentials(resolution.value);
      if (!credentials) {
        fail("The saved Analytics Sigma credential bundle could not be read.", {
          errorCode: "sigma_direct_credentials_unavailable",
          statusCode: 503,
        });
      }
      return {
        kind: "direct",
        snapshot: {
          credentials,
          connectionLabel: provenance.connectionLabel,
        },
      };
    })();
    requestCache.set(cacheKey, result);
  }
  return result;
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
  fallback: { provider: string; key: string; ctx: CredentialContext },
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
    ...(scope === "user"
      ? { scopeId: fallback.ctx.userEmail }
      : scope === "org" || scope === "workspace"
        ? { scopeId: fallback.ctx.orgId ?? undefined }
        : {}),
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
      ...(ctx.credentialScope === "org"
        ? { credentialScope: "org" as const }
        : {}),
    });
    const credential = normalizeCoreCredentialResult(result, {
      provider,
      key,
      ctx,
    });
    if (credential) return credential;
  }

  return null;
}

async function resolveWorkspaceOAuthProviderCredential(
  options: ResolveProviderCredentialOptions,
): Promise<AnalyticsProviderCredential | null> {
  if (options.workspaceConnection === false) return null;
  const provider = options.provider.trim().toLowerCase();
  if (!isProviderApiId(provider)) return null;
  if (provider === "bigquery" && options.ctx.credentialScope === "org") {
    return null;
  }

  const requestedConnectionId = options.connectionId?.trim() || undefined;
  const resolvedConnection = await resolveWorkspaceConnectionForApp({
    appId: ANALYTICS_APP_ID,
    provider,
    connectionId: requestedConnectionId,
    ...(provider === "bigquery"
      ? { connectionOwnerEmail: options.ctx.userEmail }
      : {}),
    requireConnected: true,
  });
  if (
    !resolvedConnection.available ||
    resolvedConnection.connection?.config.credentialMode !== "oauth"
  ) {
    return null;
  }

  const oauth = await resolveProviderApiOAuthAccessToken(
    {
      provider,
      connectionId: resolvedConnection.connection.id,
    },
    {
      appId: ANALYTICS_APP_ID,
      providerIds: [provider],
      getCredentialContext: () => options.ctx,
    },
  );
  return {
    value: oauth.accessToken,
    key: `${normalizeKey(provider)}_OAUTH_TOKEN`,
    provider,
    source: "workspace_connection",
    connectionId: oauth.connectionId ?? resolvedConnection.connection.id,
    connectionLabel:
      oauth.connectionLabel ?? resolvedConnection.connection.label,
  };
}

export async function resolveWorkspaceConnectionProviderCredential(
  options: ResolveProviderCredentialOptions,
): Promise<AnalyticsProviderCredential | null> {
  if (options.workspaceConnection === false) return null;
  const keys = uniqueKeys(options.keys);
  if (keys.length === 0) return null;

  const provider = options.provider.trim().toLowerCase();
  const connectionId = options.connectionId?.trim();
  if (provider === SIGMA_PROVIDER_ID && connectionId) {
    const requestedKey = keys.find((key) => sigmaCredentialField(key));
    const field = requestedKey ? sigmaCredentialField(requestedKey) : null;
    if (requestedKey && field && options.ctx.orgId) {
      const directRead = await readSigmaDirectCredentials(
        options.ctx.orgId,
        connectionId,
        options.ctx,
      );
      if (directRead.kind === "direct") {
        const directCredentials = directRead.snapshot;
        const value = directCredentials.credentials[field];
        if (!value) return null;
        return {
          value,
          key: normalizeKey(requestedKey),
          provider,
          source: "workspace_connection",
          connectionId,
          connectionLabel: directCredentials.connectionLabel,
          scope: "org",
          scopeId: options.ctx.orgId,
        };
      }
    }
  }

  return resolveViaCoreHelper({
    provider,
    keys,
    ctx: options.ctx,
    connectionId,
  });
}

export async function resolveLocalAnalyticsProviderCredential(
  options: ResolveProviderCredentialOptions,
): Promise<AnalyticsProviderCredential | null> {
  const keys = uniqueKeys(options.keys);
  for (const key of keys) {
    const credential = await resolveCredentialDetailed(key, options.ctx);
    if (credential) {
      return {
        value: credential.value,
        key,
        provider: options.provider,
        source: "analytics_local",
        scope: credential.scope,
        scopeId: credential.scopeId,
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
  const oauthCredential =
    await resolveWorkspaceOAuthProviderCredential(options);
  if (oauthCredential) return oauthCredential;

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

export async function resolveBigQueryOAuthCredential(
  ctx: CredentialContext,
): Promise<AnalyticsProviderCredential | null> {
  try {
    return await resolveAnalyticsProviderCredential({
      provider: "bigquery",
      keys: [],
      ctx,
    });
  } catch (error) {
    if (
      isAgentConnectionRequiredError(error) &&
      error.provider === "bigquery" &&
      error.reason === "reauthorize"
    ) {
      return null;
    }
    throw error;
  }
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
