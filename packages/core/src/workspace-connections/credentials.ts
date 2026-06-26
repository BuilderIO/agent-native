import {
  resolveCredentialForScope,
  type CredentialContext,
  type CredentialStorageScope,
} from "../credentials/index.js";
import { readAppSecret, type SecretRef } from "../secrets/storage.js";
import {
  getCredentialContext,
  getRequestContext,
  runWithRequestContext,
} from "../server/request-context.js";
import {
  listWorkspaceConnectionsForApp,
  markWorkspaceConnectionUsed,
  resolveWorkspaceConnectionForApp,
  type WorkspaceConnectionAppAccessMode,
  type WorkspaceConnectionCredentialRef,
  type WorkspaceConnectionForApp,
  type WorkspaceConnectionPublicCredentialRef,
} from "./store.js";

export type WorkspaceConnectionCredentialResolutionStatus =
  | "resolved"
  | "missing_context"
  | "not_available"
  | "missing_ref"
  | "missing_secret"
  | "error";

export type WorkspaceConnectionCredentialBackend = "secrets" | "credentials";

export interface ResolveWorkspaceConnectionCredentialForAppOptions {
  appId: string;
  provider: string;
  key: string;
  connectionId?: string | null;
  userEmail?: string | null;
  orgId?: string | null;
}

export interface ResolveWorkspaceConnectionCredentialsForAppOptions extends Omit<
  ResolveWorkspaceConnectionCredentialForAppOptions,
  "key"
> {
  keys: string[];
}

export interface WorkspaceConnectionCredentialProvenance {
  source: "workspace_connection";
  provider: string;
  requestedKey: string;
  resolvedKey: string;
  credentialRef: WorkspaceConnectionPublicCredentialRef;
  connectionId: string;
  connectionLabel: string;
  grantId: string | null;
  appAccessMode: WorkspaceConnectionAppAccessMode;
  secretScope: SecretRef["scope"] | CredentialStorageScope;
  backend: WorkspaceConnectionCredentialBackend;
}

export interface WorkspaceConnectionCredentialResolutionCheck {
  status: Exclude<
    WorkspaceConnectionCredentialResolutionStatus,
    "resolved" | "missing_context"
  >;
  reason: string;
  key: string;
  resolvedKey?: string;
  connectionId?: string;
  connectionLabel?: string;
  grantId?: string | null;
  appAccessMode?: WorkspaceConnectionAppAccessMode;
  credentialRef?: WorkspaceConnectionPublicCredentialRef;
  secretScope?: SecretRef["scope"] | CredentialStorageScope;
  backend?: WorkspaceConnectionCredentialBackend;
}

export interface WorkspaceConnectionCredentialResolution {
  available: boolean;
  status: WorkspaceConnectionCredentialResolutionStatus;
  reason: string;
  provider: string;
  key: string;
  value?: string;
  provenance: WorkspaceConnectionCredentialProvenance | null;
  checked: WorkspaceConnectionCredentialResolutionCheck[];
}

export interface WorkspaceConnectionCredentialsResolution {
  available: boolean;
  appId: string;
  provider: string;
  connectionId: string | null;
  values: Record<string, string>;
  results: Record<string, WorkspaceConnectionCredentialResolution>;
  missingKeys: string[];
}

type ScopedCredentialCandidate = {
  key: string;
  scope: SecretRef["scope"] | CredentialStorageScope;
  scopeId: string;
};

type CredentialReadHit = {
  value: string;
  key: string;
  scope: SecretRef["scope"] | CredentialStorageScope;
  backend: WorkspaceConnectionCredentialBackend;
};

const PROVIDER_CREDENTIAL_KEY_ALIASES: Record<
  string,
  Record<string, string[]>
> = {
  hubspot: {
    HUBSPOT_ACCESS_TOKEN: ["HUBSPOT_PRIVATE_APP_TOKEN"],
    HUBSPOT_PRIVATE_APP_TOKEN: ["HUBSPOT_ACCESS_TOKEN"],
  },
};

function normalizeRequired(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeCredentialKey(key: string): string {
  return key.trim().toUpperCase();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function credentialKeyAliases(provider: string, key: string): string[] {
  const aliases =
    PROVIDER_CREDENTIAL_KEY_ALIASES[provider.trim().toLowerCase()]?.[
      normalizeCredentialKey(key)
    ] ?? [];
  return uniqueStrings([key, ...aliases]);
}

function credentialKeyMatches(
  provider: string,
  requestedKey: string,
  refKey: string,
): boolean {
  const requested = new Set(
    credentialKeyAliases(provider, requestedKey).map(normalizeCredentialKey),
  );
  return requested.has(normalizeCredentialKey(refKey));
}

function lookupKeysForRef(
  provider: string,
  requestedKey: string,
  refKey: string,
): string[] {
  return uniqueStrings([
    refKey,
    ...credentialKeyAliases(provider, refKey),
    requestedKey,
    ...credentialKeyAliases(provider, requestedKey),
  ]);
}

function publicCredentialRef(
  ref: WorkspaceConnectionCredentialRef,
  source: WorkspaceConnectionPublicCredentialRef["source"],
): WorkspaceConnectionPublicCredentialRef {
  return {
    key: ref.key,
    scope: ref.scope,
    provider: ref.provider,
    label: ref.label,
    source,
  };
}

function credentialRefsForConnection(
  connection: WorkspaceConnectionForApp,
): Array<{
  ref: WorkspaceConnectionCredentialRef;
  publicRef: WorkspaceConnectionPublicCredentialRef;
}> {
  return [
    ...(connection.explicitGrant?.credentialRefs ?? []).map((ref) => ({
      ref,
      publicRef: publicCredentialRef(ref, "grant"),
    })),
    ...connection.credentialRefs.map((ref) => ({
      ref,
      publicRef: publicCredentialRef(ref, "connection"),
    })),
  ];
}

function refScope(
  ref: WorkspaceConnectionCredentialRef,
): SecretRef["scope"] | undefined {
  return ref.scope === "user" ||
    ref.scope === "org" ||
    ref.scope === "workspace"
    ? ref.scope
    : undefined;
}

function workspaceScopeId(ctx: CredentialContext): string {
  return ctx.orgId ?? `solo:${ctx.userEmail}`;
}

function credentialCandidatesForRef(
  ref: WorkspaceConnectionCredentialRef,
  ctx: CredentialContext,
): ScopedCredentialCandidate[] {
  const scope = refScope(ref);
  if (scope === "user") {
    return [{ key: ref.key, scope: "user", scopeId: ctx.userEmail }];
  }
  if (scope === "org") {
    return ctx.orgId
      ? [{ key: ref.key, scope: "org", scopeId: ctx.orgId }]
      : [];
  }
  if (scope === "workspace") {
    return [
      { key: ref.key, scope: "workspace", scopeId: workspaceScopeId(ctx) },
    ];
  }
  if (ctx.orgId) {
    return [
      { key: ref.key, scope: "org", scopeId: ctx.orgId },
      { key: ref.key, scope: "workspace", scopeId: ctx.orgId },
      { key: ref.key, scope: "user", scopeId: ctx.userEmail },
    ];
  }
  return [
    { key: ref.key, scope: "user", scopeId: ctx.userEmail },
    { key: ref.key, scope: "workspace", scopeId: workspaceScopeId(ctx) },
  ];
}

async function readCandidate(
  candidate: ScopedCredentialCandidate,
  ctx: CredentialContext,
): Promise<CredentialReadHit | null> {
  const secret = await readAppSecret({
    key: candidate.key,
    scope: candidate.scope as SecretRef["scope"],
    scopeId: candidate.scopeId,
  });
  if (secret?.value) {
    return {
      value: secret.value,
      key: candidate.key,
      scope: candidate.scope,
      backend: "secrets",
    };
  }

  if (candidate.scope === "user" || candidate.scope === "org") {
    const credential = await resolveCredentialForScope(candidate.key, {
      ...ctx,
      scope: candidate.scope,
    });
    if (credential) {
      return {
        value: credential,
        key: candidate.key,
        scope: candidate.scope,
        backend: "credentials",
      };
    }
  }

  return null;
}

async function readFirstCredentialForRef({
  provider,
  requestedKey,
  ref,
  ctx,
}: {
  provider: string;
  requestedKey: string;
  ref: WorkspaceConnectionCredentialRef;
  ctx: CredentialContext;
}): Promise<CredentialReadHit | null> {
  for (const key of lookupKeysForRef(provider, requestedKey, ref.key)) {
    const candidates = credentialCandidatesForRef({ ...ref, key }, ctx);
    for (const candidate of candidates) {
      const hit = await readCandidate(candidate, ctx);
      if (hit) return hit;
    }
  }

  return null;
}

function contextFromOptions(
  options: Pick<
    ResolveWorkspaceConnectionCredentialForAppOptions,
    "userEmail" | "orgId"
  >,
): CredentialContext | null {
  const requestCtx = getCredentialContext();
  const userEmail = options.userEmail?.trim() || requestCtx?.userEmail;
  if (!userEmail) return null;
  const orgId =
    options.orgId === undefined
      ? options.userEmail
        ? null
        : (requestCtx?.orgId ?? null)
      : options.orgId?.trim() || null;
  return { userEmail: userEmail.toLowerCase(), orgId };
}

function result(options: {
  provider: string;
  key: string;
  status: WorkspaceConnectionCredentialResolutionStatus;
  reason: string;
  checked?: WorkspaceConnectionCredentialResolutionCheck[];
  value?: string;
  provenance?: WorkspaceConnectionCredentialProvenance | null;
}): WorkspaceConnectionCredentialResolution {
  return {
    available: options.status === "resolved",
    status: options.status,
    reason: options.reason,
    provider: options.provider,
    key: options.key,
    ...(options.value ? { value: options.value } : {}),
    provenance: options.provenance ?? null,
    checked: options.checked ?? [],
  };
}

function unresolvedStatus(
  checked: WorkspaceConnectionCredentialResolutionCheck[],
): WorkspaceConnectionCredentialResolutionStatus {
  if (checked.some((entry) => entry.status === "error")) return "error";
  if (checked.some((entry) => entry.status === "missing_secret")) {
    return "missing_secret";
  }
  if (checked.some((entry) => entry.status === "missing_ref")) {
    return "missing_ref";
  }
  return "not_available";
}

function unresolvedReason(
  checked: WorkspaceConnectionCredentialResolutionCheck[],
  provider: string,
  key: string,
): string {
  if (checked.length > 0) return checked[checked.length - 1].reason;
  return `No connected ${provider} workspace connection could provide ${key}.`;
}

async function resolveInRequestContext(
  options: ResolveWorkspaceConnectionCredentialForAppOptions,
  ctx: CredentialContext,
): Promise<WorkspaceConnectionCredentialResolution> {
  const appId = normalizeRequired(
    options.appId,
    "resolveWorkspaceConnectionCredentialForApp appId",
  );
  const provider = normalizeRequired(
    options.provider,
    "resolveWorkspaceConnectionCredentialForApp provider",
  );
  const key = normalizeRequired(
    options.key,
    "resolveWorkspaceConnectionCredentialForApp key",
  );
  const connectionId = options.connectionId?.trim();
  const checked: WorkspaceConnectionCredentialResolutionCheck[] = [];

  let connections: WorkspaceConnectionForApp[] = [];
  if (connectionId) {
    const resolved = await resolveWorkspaceConnectionForApp({
      appId,
      provider,
      connectionId,
      includeDisabled: true,
      requireConnected: true,
    });
    if (!resolved.available || !resolved.connection) {
      checked.push({
        status: "not_available",
        reason: resolved.reason,
        key,
        connectionId: resolved.connection?.id,
        connectionLabel: resolved.connection?.label,
        grantId: resolved.appAccess?.grantId ?? null,
        appAccessMode: resolved.appAccess?.mode,
      });
      return result({
        provider,
        key,
        status: "not_available",
        reason: resolved.reason,
        checked,
      });
    }
    connections = [resolved.connection];
  } else {
    connections = (
      await listWorkspaceConnectionsForApp({
        appId,
        provider,
        includeDisabled: false,
      })
    ).filter((connection) => connection.status === "connected");
    if (connections.length === 0) {
      const resolved = await resolveWorkspaceConnectionForApp({
        appId,
        provider,
        includeDisabled: true,
        requireConnected: true,
      });
      checked.push({
        status: "not_available",
        reason: resolved.reason,
        key,
        connectionId: resolved.connection?.id,
        connectionLabel: resolved.connection?.label,
        grantId: resolved.appAccess?.grantId ?? null,
        appAccessMode: resolved.appAccess?.mode,
      });
      return result({
        provider,
        key,
        status: "not_available",
        reason: resolved.reason,
        checked,
      });
    }
  }

  for (const connection of connections) {
    const matchingRefs = credentialRefsForConnection(connection).filter(
      ({ ref }) => credentialKeyMatches(provider, key, ref.key),
    );

    if (matchingRefs.length === 0) {
      checked.push({
        status: "missing_ref",
        reason: `${connection.label} is granted to ${appId} but does not reference ${key}.`,
        key,
        connectionId: connection.id,
        connectionLabel: connection.label,
        grantId: connection.appAccess.grantId,
        appAccessMode: connection.appAccess.mode,
      });
      continue;
    }

    for (const { ref, publicRef } of matchingRefs) {
      try {
        const hit = await readFirstCredentialForRef({
          provider,
          requestedKey: key,
          ref,
          ctx,
        });
        if (hit) {
          await markWorkspaceConnectionUsed({
            connectionId: connection.id,
            appId:
              connection.appAccess.mode === "explicit-grant"
                ? appId
                : undefined,
          });
          const provenance: WorkspaceConnectionCredentialProvenance = {
            source: "workspace_connection",
            provider,
            requestedKey: key,
            resolvedKey: hit.key,
            credentialRef: publicRef,
            connectionId: connection.id,
            connectionLabel: connection.label,
            grantId: connection.appAccess.grantId,
            appAccessMode: connection.appAccess.mode,
            secretScope: hit.scope,
            backend: hit.backend,
          };
          return result({
            provider,
            key,
            status: "resolved",
            reason: `${key} is available through ${connection.label}.`,
            value: hit.value,
            provenance,
            checked,
          });
        }
        checked.push({
          status: "missing_secret",
          reason: `${connection.label} references ${ref.key}, but no scoped credential value was found.`,
          key,
          resolvedKey: ref.key,
          connectionId: connection.id,
          connectionLabel: connection.label,
          grantId: connection.appAccess.grantId,
          appAccessMode: connection.appAccess.mode,
          credentialRef: publicRef,
        });
      } catch (err) {
        checked.push({
          status: "error",
          reason: `${connection.label} credential lookup failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          key,
          resolvedKey: ref.key,
          connectionId: connection.id,
          connectionLabel: connection.label,
          grantId: connection.appAccess.grantId,
          appAccessMode: connection.appAccess.mode,
          credentialRef: publicRef,
        });
      }
    }
  }

  const status = unresolvedStatus(checked);
  return result({
    provider,
    key,
    status,
    reason: unresolvedReason(checked, provider, key),
    checked,
  });
}

export async function resolveWorkspaceConnectionCredentialForApp(
  options: ResolveWorkspaceConnectionCredentialForAppOptions,
): Promise<WorkspaceConnectionCredentialResolution> {
  const ctx = contextFromOptions(options);
  const provider = options.provider?.trim() ?? "";
  const key = options.key?.trim() ?? "";
  if (!ctx) {
    return result({
      provider,
      key,
      status: "missing_context",
      reason:
        "Workspace connection credential resolution requires an authenticated request context.",
    });
  }

  const existing = getRequestContext() ?? {};
  return runWithRequestContext(
    {
      ...existing,
      userEmail: ctx.userEmail,
      orgId: ctx.orgId ?? undefined,
    },
    () => resolveInRequestContext(options, ctx),
  );
}

export async function resolveWorkspaceConnectionCredentialsForApp(
  options: ResolveWorkspaceConnectionCredentialsForAppOptions,
): Promise<WorkspaceConnectionCredentialsResolution> {
  const keys = uniqueStrings(options.keys);
  const entries = await Promise.all(
    keys.map(
      async (key) =>
        [
          key,
          await resolveWorkspaceConnectionCredentialForApp({ ...options, key }),
        ] as const,
    ),
  );
  const results = Object.fromEntries(entries);
  const values: Record<string, string> = {};
  const missingKeys: string[] = [];
  for (const [key, resolution] of entries) {
    if (resolution.value) {
      values[key] = resolution.value;
    } else {
      missingKeys.push(key);
    }
  }

  return {
    available: missingKeys.length === 0,
    appId: options.appId,
    provider: options.provider,
    connectionId: options.connectionId?.trim() || null,
    values,
    results,
    missingKeys,
  };
}
