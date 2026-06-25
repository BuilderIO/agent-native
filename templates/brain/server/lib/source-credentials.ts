import { resolveCredential } from "@agent-native/core/credentials";
import type { CredentialContext } from "@agent-native/core/credentials";
import { readAppSecret, type SecretRef } from "@agent-native/core/secrets";
import {
  getWorkspaceConnectionAppAccess,
  listWorkspaceConnectionGrants,
  listWorkspaceConnections,
  resolveWorkspaceConnectionForApp,
  type SerializedWorkspaceConnection,
  type SerializedWorkspaceConnectionGrant,
  type WorkspaceConnectionAppAccessMode,
  type WorkspaceConnectionCredentialRef,
} from "@agent-native/core/workspace-connections";

import type { BrainSourceProvider } from "../../shared/types.js";

const APP_ID = "brain";

interface ResolveSourceCredentialOptions {
  provider: BrainSourceProvider | string;
  key: string;
  ctx: CredentialContext;
  workspaceConnectionId?: string | null;
}

type SourceCredentialSource =
  | "workspace_connection"
  | "brain_local"
  | "registered_secret";

export type SourceCredentialCheckStatus =
  | "available"
  | "missing"
  | "not_granted"
  | "unhealthy"
  | "error";

export interface SourceCredentialProvenance {
  source: SourceCredentialSource;
  key: string;
  provider: string;
  scope?: SecretRef["scope"];
  connectionId?: string;
  connectionLabel?: string;
  grantId?: string | null;
  appAccessMode?: WorkspaceConnectionAppAccessMode;
  credentialRefLabel?: string;
}

export interface SourceCredentialCheck {
  source: SourceCredentialSource;
  key: string;
  status: SourceCredentialCheckStatus;
  message: string;
  scope?: SecretRef["scope"];
  connectionId?: string;
  connectionLabel?: string;
  grantId?: string | null;
  appAccessMode?: WorkspaceConnectionAppAccessMode;
}

export interface SourceCredentialAvailability {
  provider: string;
  key: string;
  available: boolean;
  provenance: SourceCredentialProvenance | null;
  checked: SourceCredentialCheck[];
  missingMessage: string | null;
}

type SourceCredentialResolution = SourceCredentialAvailability & {
  value?: string;
};

function normalizeCredentialKey(key: string) {
  return key.trim().toUpperCase();
}

function credentialRefsForConnection(
  connection: SerializedWorkspaceConnection,
  grants: SerializedWorkspaceConnectionGrant[],
) {
  const grant = grants.find((entry) => entry.connectionId === connection.id);
  return [...(grant?.credentialRefs ?? []), ...connection.credentialRefs];
}

function refMatchesKey(ref: WorkspaceConnectionCredentialRef, key: string) {
  return normalizeCredentialKey(ref.key) === normalizeCredentialKey(key);
}

function refScope(ref: WorkspaceConnectionCredentialRef) {
  return ref.scope === "user" ||
    ref.scope === "org" ||
    ref.scope === "workspace"
    ? ref.scope
    : undefined;
}

function credentialRefCandidates(
  ref: WorkspaceConnectionCredentialRef,
  ctx: CredentialContext,
): SecretRef[] {
  const scope = refScope(ref);
  const candidates: SecretRef[] = [];

  if (scope === "user") {
    candidates.push({ key: ref.key, scope: "user", scopeId: ctx.userEmail });
  } else if (scope === "org" && ctx.orgId) {
    candidates.push({ key: ref.key, scope: "org", scopeId: ctx.orgId });
  } else if (scope === "workspace") {
    candidates.push({
      key: ref.key,
      scope: "workspace",
      scopeId: ctx.orgId ?? `solo:${ctx.userEmail}`,
    });
  } else if (ctx.orgId) {
    candidates.push(
      { key: ref.key, scope: "org", scopeId: ctx.orgId },
      { key: ref.key, scope: "workspace", scopeId: ctx.orgId },
    );
  } else {
    candidates.push(
      { key: ref.key, scope: "user", scopeId: ctx.userEmail },
      { key: ref.key, scope: "workspace", scopeId: `solo:${ctx.userEmail}` },
    );
  }

  return candidates;
}

function registeredSecretCandidates(
  key: string,
  ctx: CredentialContext,
): SecretRef[] {
  const candidates: SecretRef[] = [
    { key, scope: "user", scopeId: ctx.userEmail },
  ];
  if (ctx.orgId) {
    candidates.push(
      { key, scope: "org", scopeId: ctx.orgId },
      { key, scope: "workspace", scopeId: ctx.orgId },
    );
  } else {
    candidates.push({
      key,
      scope: "workspace",
      scopeId: `solo:${ctx.userEmail}`,
    });
  }
  return candidates;
}

async function readFirstSecretCandidate(
  candidates: SecretRef[],
): Promise<{ value?: string; ref?: SecretRef; error?: string }> {
  for (const candidate of candidates) {
    try {
      const secret = await readAppSecret(candidate);
      if (secret?.value) {
        return { value: secret.value, ref: candidate };
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return {};
}

function connectionStatusMessage(connection: SerializedWorkspaceConnection) {
  switch (connection.status) {
    case "checking":
      return `${connection.label} is still checking health.`;
    case "needs_reauth":
      return `${connection.label} needs to be reauthorized before Brain can use it.`;
    case "error":
      return `${connection.label} is in an error state before Brain can use it.`;
    case "disabled":
      return `${connection.label} is disabled.`;
    case "connected":
    default:
      return `${connection.label} is connected.`;
  }
}

function missingCredentialMessage(
  provider: string,
  key: string,
  checked: SourceCredentialCheck[],
) {
  if (checked.some((entry) => entry.status === "not_granted")) {
    return `A ${provider} workspace connection exists, but Brain has not been granted access. Grant Brain access to reuse it or add ${key} to Brain credentials.`;
  }
  if (checked.some((entry) => entry.status === "unhealthy")) {
    return `Brain can see a ${provider} workspace connection, but it is not healthy. Reauthorize or repair the connection, or add ${key} to Brain credentials.`;
  }
  if (
    checked.some(
      (entry) =>
        entry.source === "workspace_connection" && entry.status === "missing",
    )
  ) {
    return `Brain can access a ${provider} workspace connection, but ${key} is missing from its credential refs or vault storage.`;
  }
  return `Configure ${key} in Brain credentials or create and grant a shared ${provider} workspace connection.`;
}

function boundConnectionMissingCredentialMessage(
  provider: string,
  key: string,
  workspaceConnectionId: string,
  checked: SourceCredentialCheck[],
) {
  const connectionCheck = checked.find(
    (entry) =>
      entry.source === "workspace_connection" &&
      entry.connectionId === workspaceConnectionId,
  );
  const connectionError = checked.find(
    (entry) =>
      entry.source === "workspace_connection" && entry.status === "error",
  );
  if (connectionError) {
    return connectionError.message;
  }
  if (!connectionCheck) {
    return `The selected ${provider} workspace connection ${workspaceConnectionId} was not found. Choose a granted connection or clear the source binding.`;
  }
  if (connectionCheck.status === "not_granted") {
    return `The selected ${provider} workspace connection is not granted to Brain. Grant Brain access in Dispatch or choose another connection.`;
  }
  if (connectionCheck.status === "unhealthy") {
    return `The selected ${provider} workspace connection is not healthy. Reauthorize or repair it in Dispatch before syncing this source.`;
  }
  if (connectionCheck.status === "missing") {
    return `The selected ${provider} workspace connection is granted to Brain, but ${key} is missing from its credential refs or vault storage.`;
  }
  if (connectionCheck.status === "error") {
    return connectionCheck.message;
  }
  return `The selected ${provider} workspace connection cannot provide ${key}. Choose another granted connection or clear the source binding.`;
}

function availabilityFromResolution(
  resolution: SourceCredentialResolution,
): SourceCredentialAvailability {
  const { value: _value, ...availability } = resolution;
  return availability;
}

async function resolveWorkspaceConnectionCredential({
  provider,
  key,
  ctx,
  workspaceConnectionId,
  checked,
}: ResolveSourceCredentialOptions & {
  checked: SourceCredentialCheck[];
}): Promise<{
  value: string;
  provenance: SourceCredentialProvenance;
} | null> {
  let connections: SerializedWorkspaceConnection[] = [];
  let grants: SerializedWorkspaceConnectionGrant[] = [];
  try {
    [connections, grants] = await Promise.all([
      listWorkspaceConnections({ provider, includeDisabled: true }),
      listWorkspaceConnectionGrants({ provider, appId: APP_ID }),
    ]);
  } catch (err) {
    checked.push({
      source: "workspace_connection",
      key,
      status: "error",
      message: `Workspace connections are unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    return null;
  }

  const providerConnections = workspaceConnectionId
    ? connections.filter(
        (connection) => connection.id === workspaceConnectionId,
      )
    : connections;

  if (workspaceConnectionId && providerConnections.length === 0) {
    checked.push({
      source: "workspace_connection",
      key,
      status: "missing",
      message: `The selected ${provider} workspace connection ${workspaceConnectionId} was not found.`,
      connectionId: workspaceConnectionId,
    });
    return null;
  }

  for (const connection of providerConnections) {
    const access = getWorkspaceConnectionAppAccess(connection, APP_ID, grants);
    if (!access.available) {
      checked.push({
        source: "workspace_connection",
        key,
        status: "not_granted",
        message: access.reason,
        connectionId: connection.id,
        connectionLabel: connection.label,
        grantId: access.grantId,
        appAccessMode: access.mode,
      });
      continue;
    }

    if (connection.status !== "connected") {
      checked.push({
        source: "workspace_connection",
        key,
        status: "unhealthy",
        message: connectionStatusMessage(connection),
        connectionId: connection.id,
        connectionLabel: connection.label,
        grantId: access.grantId,
        appAccessMode: access.mode,
      });
      continue;
    }

    const matchingRefs = credentialRefsForConnection(connection, grants).filter(
      (ref) => refMatchesKey(ref, key),
    );
    if (matchingRefs.length === 0) {
      checked.push({
        source: "workspace_connection",
        key,
        status: "missing",
        message: `${connection.label} is granted to Brain but does not reference ${key}.`,
        connectionId: connection.id,
        connectionLabel: connection.label,
        grantId: access.grantId,
        appAccessMode: access.mode,
      });
    }

    for (const ref of matchingRefs) {
      const candidates = credentialRefCandidates(ref, ctx);
      if (candidates.length === 0) {
        checked.push({
          source: "workspace_connection",
          key,
          status: "missing",
          message: `${connection.label} references ${ref.key}, but its scope is unavailable in this request.`,
          connectionId: connection.id,
          connectionLabel: connection.label,
          grantId: access.grantId,
          appAccessMode: access.mode,
        });
        continue;
      }

      const found = await readFirstSecretCandidate(candidates);
      if (found.value && found.ref) {
        checked.push({
          source: "workspace_connection",
          key,
          status: "available",
          message: `${key} is available through ${connection.label}.`,
          scope: found.ref.scope,
          connectionId: connection.id,
          connectionLabel: connection.label,
          grantId: access.grantId,
          appAccessMode: access.mode,
        });
        return {
          value: found.value,
          provenance: {
            source: "workspace_connection",
            key,
            provider,
            scope: found.ref.scope,
            connectionId: connection.id,
            connectionLabel: connection.label,
            grantId: access.grantId,
            appAccessMode: access.mode,
            credentialRefLabel: ref.label,
          },
        };
      }

      checked.push({
        source: "workspace_connection",
        key,
        status: found.error ? "error" : "missing",
        message: found.error
          ? `${connection.label} credential lookup failed: ${found.error}`
          : `${connection.label} references ${ref.key}, but no vault value was found.`,
        connectionId: connection.id,
        connectionLabel: connection.label,
        grantId: access.grantId,
        appAccessMode: access.mode,
      });
    }
  }

  return null;
}

async function resolveRegisteredSecretCredential(
  options: ResolveSourceCredentialOptions,
  checked: SourceCredentialCheck[],
): Promise<{
  value: string;
  provenance: SourceCredentialProvenance;
} | null> {
  const found = await readFirstSecretCandidate(
    registeredSecretCandidates(options.key, options.ctx),
  );
  if (found.value && found.ref) {
    checked.push({
      source: "registered_secret",
      key: options.key,
      status: "available",
      message: `${options.key} is available in the credential vault.`,
      scope: found.ref.scope,
    });
    return {
      value: found.value,
      provenance: {
        source: "registered_secret",
        key: options.key,
        provider: options.provider,
        scope: found.ref.scope,
      },
    };
  }

  checked.push({
    source: "registered_secret",
    key: options.key,
    status: found.error ? "error" : "missing",
    message: found.error
      ? `${options.key} vault lookup failed: ${found.error}`
      : `${options.key} was not found in the credential vault.`,
  });
  return null;
}

async function resolveSourceCredentialDetailed(
  options: ResolveSourceCredentialOptions,
): Promise<SourceCredentialResolution> {
  const checked: SourceCredentialCheck[] = [];
  const workspaceConnectionId = options.workspaceConnectionId?.trim() || null;
  const workspaceCredential = await resolveWorkspaceConnectionCredential({
    ...options,
    workspaceConnectionId,
    checked,
  });
  if (workspaceCredential) {
    return {
      provider: options.provider,
      key: options.key,
      available: true,
      value: workspaceCredential.value,
      provenance: workspaceCredential.provenance,
      checked,
      missingMessage: null,
    };
  }

  if (workspaceConnectionId) {
    return {
      provider: options.provider,
      key: options.key,
      available: false,
      provenance: null,
      checked,
      missingMessage: boundConnectionMissingCredentialMessage(
        options.provider,
        options.key,
        workspaceConnectionId,
        checked,
      ),
    };
  }

  const localCredential = await resolveCredential(options.key, options.ctx);
  if (localCredential) {
    checked.push({
      source: "brain_local",
      key: options.key,
      status: "available",
      message: `${options.key} is available in Brain-local credentials.`,
    });
    return {
      provider: options.provider,
      key: options.key,
      available: true,
      value: localCredential,
      provenance: {
        source: "brain_local",
        key: options.key,
        provider: options.provider,
      },
      checked,
      missingMessage: null,
    };
  }

  checked.push({
    source: "brain_local",
    key: options.key,
    status: "missing",
    message: `${options.key} was not found in Brain-local credentials.`,
  });

  const registeredCredential = await resolveRegisteredSecretCredential(
    options,
    checked,
  );
  if (registeredCredential) {
    return {
      provider: options.provider,
      key: options.key,
      available: true,
      value: registeredCredential.value,
      provenance: registeredCredential.provenance,
      checked,
      missingMessage: null,
    };
  }

  return {
    provider: options.provider,
    key: options.key,
    available: false,
    provenance: null,
    checked,
    missingMessage: missingCredentialMessage(
      options.provider,
      options.key,
      checked,
    ),
  };
}

export async function resolveSourceCredential(
  options: ResolveSourceCredentialOptions,
): Promise<string | undefined> {
  const resolution = await resolveSourceCredentialDetailed(options);
  return resolution.value;
}

export async function inspectSourceCredentialAvailability(
  options: ResolveSourceCredentialOptions,
): Promise<SourceCredentialAvailability> {
  return availabilityFromResolution(
    await resolveSourceCredentialDetailed(options),
  );
}

export async function assertSourceWorkspaceConnectionAvailable({
  provider,
  workspaceConnectionId,
}: {
  provider: BrainSourceProvider | string;
  workspaceConnectionId: string;
}) {
  let result: Awaited<ReturnType<typeof resolveWorkspaceConnectionForApp>>;
  try {
    result = await resolveWorkspaceConnectionForApp({
      appId: APP_ID,
      provider,
      connectionId: workspaceConnectionId,
      requireConnected: true,
      includeDisabled: true,
    });
  } catch (err) {
    throw new Error(
      `Workspace connections are unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!result.available || !result.connection || !result.appAccess) {
    throw new Error(result.reason);
  }
  return {
    connection: result.connection,
    access: result.appAccess,
  };
}
