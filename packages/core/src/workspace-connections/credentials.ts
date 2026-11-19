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
  type RequestContext,
} from "../server/request-context.js";
import {
  credentialKeyMatches,
  lookupKeysForRef,
} from "./credential-key-aliases.js";
import {
  CONNECTION_CREDENTIAL_REF_MARKER,
  connectionCredentialMarkerState,
  readMarkedConnectionCredential,
} from "./credential-profile.js";
import {
  listWorkspaceConnectionsForApp,
  markWorkspaceConnectionUsed,
  resolveWorkspaceConnectionForApp,
  type WorkspaceConnectionAppAccessMode,
  type WorkspaceConnectionCredentialRef,
  type WorkspaceConnectionForApp,
  type WorkspaceConnectionPublicCredentialRef,
} from "./store.js";
import { WORKSPACE_CREDENTIAL_MARKER } from "./workspace-credential-marker.js";
import { readWorkspaceCredential } from "./workspace-credentials.js";

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
  credentialScope?: "org";
  recordUsage?: boolean;
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

function connectionCredentialProvenance(input: {
  provider: string;
  requestedKey: string;
  connection: WorkspaceConnectionForApp;
  publicRef: WorkspaceConnectionPublicCredentialRef;
  hit: CredentialReadHit;
}): WorkspaceConnectionCredentialProvenance {
  return {
    source: "workspace_connection",
    provider: input.provider,
    requestedKey: input.requestedKey,
    resolvedKey: input.hit.key,
    credentialRef: input.publicRef,
    connectionId: input.connection.id,
    connectionLabel: input.connection.label,
    grantId: input.connection.appAccess.grantId,
    appAccessMode: input.connection.appAccess.mode,
    secretScope: input.hit.scope,
    backend: input.hit.backend,
  };
}

function normalizeRequired(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
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
    ...(ref.ref === CONNECTION_CREDENTIAL_REF_MARKER ||
    ref.ref === WORKSPACE_CREDENTIAL_MARKER
      ? { ref: ref.ref }
      : {}),
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
    return ctx.credentialScope === "org"
      ? []
      : [{ key: ref.key, scope: "user", scopeId: ctx.userEmail }];
  }
  if (scope === "org") {
    return ctx.orgId
      ? [{ key: ref.key, scope: "org", scopeId: ctx.orgId }]
      : [];
  }
  if (scope === "workspace") {
    return ctx.orgId || ctx.credentialScope !== "org"
      ? [{ key: ref.key, scope: "workspace", scopeId: workspaceScopeId(ctx) }]
      : [];
  }
  if (ctx.orgId) {
    return [
      { key: ref.key, scope: "org", scopeId: ctx.orgId },
      { key: ref.key, scope: "workspace", scopeId: ctx.orgId },
      ...(ctx.credentialScope === "org"
        ? []
        : [{ key: ref.key, scope: "user" as const, scopeId: ctx.userEmail }]),
    ];
  }
  if (ctx.credentialScope === "org") return [];
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
      throwOnUnreadable: true,
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
    "userEmail" | "orgId" | "credentialScope"
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
  const credentialScope =
    options.credentialScope ?? requestCtx?.credentialScope;
  if (credentialScope === "org" && !orgId) return null;
  return {
    userEmail: userEmail.toLowerCase(),
    orgId,
    ...(credentialScope === "org" ? { credentialScope } : {}),
  };
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
  strictRequestContext: RequestContext | undefined,
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

  let missingContextReason: string | undefined;
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

    // Per-connection no-fallback: when any matching ref on this connection is
    // non-legacy, this connection/key must be answered from a marked namespace
    // or not at all. Unmarked refs on the same connection are not a fallback.
    // Other connections stay eligible for ordinary default selection when no
    // connectionId was supplied.
    const hasNonLegacyMarker = matchingRefs.some(
      ({ ref }) => connectionCredentialMarkerState(ref) !== "legacy",
    );
    const refsToTry = hasNonLegacyMarker
      ? matchingRefs.filter(
          ({ ref }) => connectionCredentialMarkerState(ref) !== "legacy",
        )
      : matchingRefs;

    for (const { ref, publicRef } of refsToTry) {
      try {
        const marker = connectionCredentialMarkerState(ref);
        if (marker !== "legacy") {
          const workspaceProfile = ref.ref === WORKSPACE_CREDENTIAL_MARKER;
          // Workspace credentials require an explicit source identity. Unknown
          // markers still go to the fail-closed personal marker validator.
          const outcome = workspaceProfile
            ? options.connectionId?.trim()
              ? {
                  status: "resolved" as const,
                  key: ref.key,
                  value: await readWorkspaceCredential({
                    appId,
                    connectionId: connection.id,
                    provider,
                    key: ref.key,
                    requestContext: strictRequestContext,
                  }),
                }
              : {
                  status: "not_available" as const,
                  reason:
                    "A workspace credential requires an explicit connection.",
                }
            : await readMarkedConnectionCredential({
                connection,
                provider,
                ref,
                requestContext: strictRequestContext,
              });
          if (outcome.status === "missing_context") {
            if (options.connectionId) {
              return result({
                provider,
                key,
                status: "missing_context",
                reason: outcome.reason,
                checked,
              });
            }
            // An unbound background lookup may still use another eligible
            // legacy connection. This marked candidate never uses that value.
            missingContextReason ??= outcome.reason;
          }
          if (outcome.status === "resolved") {
            const hit: CredentialReadHit = {
              value: outcome.value,
              key: outcome.key,
              scope: workspaceProfile ? "org" : "user",
              backend: "secrets",
            };
            if (options.recordUsage !== false) {
              const markUsed = () =>
                markWorkspaceConnectionUsed({
                  connectionId: connection.id,
                  ...(connection.appAccess.mode === "explicit-grant"
                    ? { appId }
                    : {}),
                });
              // Record usage under the genuine captured identity so an option
              // override cannot change the actor the row is attributed to.
              if (strictRequestContext) {
                await runWithRequestContext(strictRequestContext, markUsed);
              } else {
                await markUsed();
              }
            }
            return result({
              provider,
              key,
              status: "resolved",
              reason: `${key} is available through ${connection.label}.`,
              value: hit.value,
              provenance: connectionCredentialProvenance({
                provider,
                requestedKey: key,
                connection,
                publicRef,
                hit,
              }),
              checked,
            });
          }
          checked.push({
            status:
              outcome.status === "invalid_ref" ||
              outcome.status === "missing_context"
                ? "not_available"
                : outcome.status,
            reason: outcome.reason,
            key,
            resolvedKey: ref.key,
            connectionId: connection.id,
            connectionLabel: connection.label,
            grantId: connection.appAccess.grantId,
            appAccessMode: connection.appAccess.mode,
            credentialRef: publicRef,
          });
          continue;
        }

        const hit = await readFirstCredentialForRef({
          provider,
          requestedKey: key,
          ref,
          ctx,
        });
        if (hit) {
          if (options.recordUsage !== false) {
            await markWorkspaceConnectionUsed({
              connectionId: connection.id,
              appId:
                connection.appAccess.mode === "explicit-grant"
                  ? appId
                  : undefined,
            });
          }
          return result({
            provider,
            key,
            status: "resolved",
            reason: `${key} is available through ${connection.label}.`,
            value: hit.value,
            provenance: connectionCredentialProvenance({
              provider,
              requestedKey: key,
              connection,
              publicRef,
              hit,
            }),
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

  if (missingContextReason) {
    return result({
      provider,
      key,
      status: "missing_context",
      reason: missingContextReason,
      checked,
    });
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

  // Capture the genuine request identity before applying any caller-supplied
  // option override. Marked connection refs must never trust our app's
  // `userEmail`/`orgId` options; only this captured context is authoritative.
  const strictRequestContext = getRequestContext();
  const existing = strictRequestContext ?? {};
  return runWithRequestContext(
    {
      ...existing,
      userEmail: ctx.userEmail,
      orgId: ctx.orgId ?? undefined,
      ...(ctx.credentialScope === "org"
        ? { credentialScope: "org" as const }
        : {}),
    },
    () => resolveInRequestContext(options, ctx, strictRequestContext),
  );
}

/** Resolve one user vault value only through an explicit, owner-bound app grant. */
export async function resolveExplicitUserConnectionCredential(options: {
  appId: string;
  provider: string;
  connectionId: string;
  key: string;
}): Promise<WorkspaceConnectionCredentialResolution> {
  const ctx = getCredentialContext();
  const provider = options.provider.trim();
  const key = options.key.trim();
  const unavailable = (
    status: WorkspaceConnectionCredentialResolutionStatus,
    reason: string,
  ) => result({ provider, key, status, reason });
  if (
    !ctx?.userEmail ||
    !provider ||
    !key ||
    !options.connectionId.trim() ||
    !options.appId.trim()
  ) {
    return unavailable(
      "missing_context",
      "An authenticated owner, app, provider, connection and credential key are required.",
    );
  }
  if (ctx.credentialScope === "org") {
    return unavailable(
      "not_available",
      "A user credential is unavailable in an organization-only context.",
    );
  }
  try {
    const resolved = await resolveWorkspaceConnectionForApp({
      appId: options.appId,
      provider,
      connectionId: options.connectionId,
      connectionOwnerEmail: ctx.userEmail,
      requireConnected: true,
    });
    const connection = resolved.connection;
    const grant = connection?.explicitGrant;
    if (
      !resolved.available ||
      !connection ||
      !grant ||
      connection.ownerEmail.toLowerCase() !== ctx.userEmail.toLowerCase() ||
      connection.orgId !== (ctx.orgId ?? null) ||
      grant.connectionId !== connection.id ||
      grant.appId !== options.appId ||
      grant.provider !== provider ||
      grant.orgId !== connection.orgId
    ) {
      return unavailable(
        "not_available",
        "The owner-bound connection or its explicit app grant is unavailable.",
      );
    }
    const refs = grant.credentialRefs.filter(
      (ref) =>
        ref.key === key &&
        (!ref.provider || ref.provider === provider) &&
        (ref.scope === "user" ||
          connectionCredentialMarkerState(ref) !== "legacy"),
    );
    if (
      refs.some((ref) => connectionCredentialMarkerState(ref) === "invalid")
    ) {
      return unavailable(
        "not_available",
        "The explicit grant contains a malformed connection credential reference.",
      );
    }
    const markedRefs = refs.filter(
      (ref) => connectionCredentialMarkerState(ref) === "connection",
    );
    const markedRef = markedRefs.at(0);
    if (markedRef) {
      if (refs.length !== 1)
        return unavailable(
          "missing_ref",
          "The explicit grant must contain one matching connection credential reference.",
        );
      const outcome = await readMarkedConnectionCredential({
        connection,
        provider,
        ref: markedRef,
        requestContext: getRequestContext(),
      });
      if (outcome.status === "missing_context")
        return unavailable("missing_context", outcome.reason);
      if (outcome.status === "resolved") {
        return result({
          provider,
          key,
          status: "resolved",
          reason:
            "The explicit grant provides the connection vault credential.",
          value: outcome.value,
          provenance: {
            source: "workspace_connection",
            provider,
            requestedKey: key,
            resolvedKey: outcome.key,
            credentialRef: publicCredentialRef(markedRef, "grant"),
            connectionId: connection.id,
            connectionLabel: connection.label,
            grantId: grant.id,
            appAccessMode: connection.appAccess.mode,
            secretScope: "user",
            backend: "secrets",
          },
        });
      }
      if (outcome.status === "invalid_ref")
        return unavailable("not_available", outcome.reason);
      return unavailable(outcome.status, outcome.reason);
    }
    const ref = refs.at(0);
    if (refs.length !== 1 || ref === undefined)
      return unavailable(
        "missing_ref",
        "The explicit grant must contain one matching user-scoped credential reference.",
      );
    const secret = await readAppSecret({
      key,
      scope: "user",
      scopeId: ctx.userEmail.toLowerCase(),
    });
    if (!secret?.value)
      return unavailable(
        "missing_secret",
        "The referenced user vault credential is unavailable.",
      );
    return result({
      provider,
      key,
      status: "resolved",
      reason: "The explicit grant provides the user vault credential.",
      value: secret.value,
      provenance: {
        source: "workspace_connection",
        provider,
        requestedKey: key,
        resolvedKey: key,
        credentialRef: publicCredentialRef(ref, "grant"),
        connectionId: connection.id,
        connectionLabel: connection.label,
        grantId: grant.id,
        appAccessMode: connection.appAccess.mode,
        secretScope: "user",
        backend: "secrets",
      },
    });
  } catch {
    return unavailable(
      "error",
      "The owner-bound connection or vault lookup failed.",
    );
  }
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
