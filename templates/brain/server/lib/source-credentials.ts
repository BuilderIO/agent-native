import { resolveCredential } from "@agent-native/core/credentials";
import { resolveSecret } from "@agent-native/core/server";
import {
  listWorkspaceConnectionGrants,
  listWorkspaceConnections,
  type SerializedWorkspaceConnection,
  type SerializedWorkspaceConnectionGrant,
  type WorkspaceConnectionCredentialRef,
} from "@agent-native/core/workspace-connections";
import { readAppSecret, type SecretRef } from "@agent-native/core/secrets";
import type { CredentialContext } from "@agent-native/core/credentials";
import type { BrainSourceProvider } from "../../shared/types.js";

const APP_ID = "brain";

interface ResolveSourceCredentialOptions {
  provider: BrainSourceProvider | string;
  key: string;
  ctx: CredentialContext;
}

function isGrantedToBrain(
  connection: SerializedWorkspaceConnection,
  grants: SerializedWorkspaceConnectionGrant[],
): boolean {
  return (
    connection.allowedApps.length === 0 ||
    connection.allowedApps.includes(APP_ID) ||
    grants.some(
      (grant) => grant.connectionId === connection.id && grant.appId === APP_ID,
    )
  );
}

function credentialRefsForConnection(
  connection: SerializedWorkspaceConnection,
  grants: SerializedWorkspaceConnectionGrant[],
) {
  const grant = grants.find((entry) => entry.connectionId === connection.id);
  return [...(grant?.credentialRefs ?? []), ...connection.credentialRefs];
}

function refMatchesKey(ref: WorkspaceConnectionCredentialRef, key: string) {
  return ref.key.trim() === key;
}

async function readCredentialRef(
  ref: WorkspaceConnectionCredentialRef,
  ctx: CredentialContext,
): Promise<string | undefined> {
  const scope = typeof ref.scope === "string" ? ref.scope : undefined;
  const candidates: SecretRef[] = [];

  if (scope === "user") {
    candidates.push({ key: ref.key, scope: "user", scopeId: ctx.userEmail });
  } else if (scope === "org" && ctx.orgId) {
    candidates.push({ key: ref.key, scope: "org", scopeId: ctx.orgId });
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

  for (const candidate of candidates) {
    try {
      const secret = await readAppSecret(candidate);
      if (secret?.value) return secret.value;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function resolveWorkspaceConnectionCredential({
  provider,
  key,
  ctx,
}: ResolveSourceCredentialOptions): Promise<string | undefined> {
  let connections: SerializedWorkspaceConnection[] = [];
  let grants: SerializedWorkspaceConnectionGrant[] = [];
  try {
    [connections, grants] = await Promise.all([
      listWorkspaceConnections({ provider, appId: APP_ID }),
      listWorkspaceConnectionGrants({ provider, appId: APP_ID }),
    ]);
  } catch {
    return undefined;
  }

  for (const connection of connections) {
    if (connection.status !== "connected") continue;
    if (!isGrantedToBrain(connection, grants)) continue;

    const matchingRefs = credentialRefsForConnection(connection, grants).filter(
      (ref) => refMatchesKey(ref, key),
    );
    for (const ref of matchingRefs) {
      const value = await readCredentialRef(ref, ctx);
      if (value) return value;
    }
  }

  return undefined;
}

export async function resolveSourceCredential(
  options: ResolveSourceCredentialOptions,
): Promise<string | undefined> {
  const workspaceCredential =
    await resolveWorkspaceConnectionCredential(options);
  if (workspaceCredential) return workspaceCredential;

  const localCredential = await resolveCredential(options.key, options.ctx);
  if (localCredential) return localCredential;

  const registeredOrEnvCredential = await resolveSecret(options.key);
  if (registeredOrEnvCredential) return registeredOrEnvCredential;

  return process.env[options.key] || undefined;
}
