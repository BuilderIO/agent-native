/**
 * The saved-key inventory behind Settings › API keys: every stored row the
 * credential resolver can use for the caller, with what uses it and what the
 * caller may do with it. Values are never read into the result; `masked`
 * carries only the last four characters.
 */

import {
  AGENT_PROVIDER_CATALOG,
  type AgentProviderId,
} from "../client/agent-provider-catalog.js";
import { canManageOrg } from "../org/permissions.js";
import { readOrgMemberRole } from "../server/personal-provider-key-policy.js";
import { canonicalSecretKey, secretKeyNames } from "./key-aliases.js";
import { resolveSecretManagedBy } from "./managed-keys.js";
import {
  getRequiredSecret,
  listRequiredSecrets,
  type SecretManagedBy,
  type SecretScope,
  type SecretUsage,
} from "./register.js";
import {
  deleteAppSecret,
  listAppSecretsForScope,
  VAULT_SYNC_DESCRIPTION_PREFIX,
  type SecretMeta,
} from "./storage.js";
import { describeSecretUsage } from "./usage.js";

/** Whose key a row is: the caller's own, or the organization's. */
export type ApiKeyOwnerScope = "user" | "org";

export interface ApiKeyEntry {
  /** Stored key name, e.g. `OPENAI_API_KEY` or an ad-hoc `STRIPE_SECRET_KEY`. */
  name: string;
  /** Registered label, e.g. "OpenAI API key". Absent for ad-hoc keys. */
  label?: string;
  scope: ApiKeyOwnerScope;
  /**
   * The stored row's own scope. A `workspace` row is the organization's
   * shared row (owner `org`) or, for owner `user`, the caller's solo row.
   */
  storedScope: SecretScope;
  /** "••••1234". Absent on managed keys, which only say they exist. */
  masked?: string;
  updatedAt: number | null;
  /** Synced from the Dispatch Vault and managed there. */
  vault?: true;
  registered: boolean;
  docsUrl?: string;
  /** The model provider this key (or endpoint) adds. Manage it in Model. */
  provider?: AgentProviderId;
  /** What uses the key, per app and feature. Empty when nothing is known to. */
  usedFor: SecretUsage[];
  /** Present when another Settings page creates and rotates the key. */
  managedBy?: SecretManagedBy;
  /** Saving a new value writes this same row. */
  canReplace: boolean;
  canDelete: boolean;
  /** A registered validator can check the stored value. */
  canTest: boolean;
}

export interface AddableApiKey {
  name: string;
  label: string;
  description?: string;
  docsUrl?: string;
  /** Where a save lands: `user` for the caller, otherwise shared. */
  scope: SecretScope;
}

export interface ApiKeysListing {
  /** The caller's keys, then (owners and admins) the organization's. */
  keys: ApiKeyEntry[];
  /** Keys another Settings page owns, read-only here. */
  managed: ApiKeyEntry[];
  /** Registered keys nobody has saved yet that the caller may add. */
  addable: AddableApiKey[];
  hasOrganization: boolean;
  /** Owner or admin: sees and manages the organization's keys. */
  canManageOrg: boolean;
}

export interface ApiKeyCaller {
  email: string;
  orgId: string | null;
}

interface StoredRowSource {
  scope: SecretScope;
  scopeId: string;
  owner: ApiKeyOwnerScope;
}

/**
 * The rows the resolver reads for the caller, in its precedence order:
 * personal, the pre-organization solo row, then the organization's.
 */
function storedRowSources(caller: ApiKeyCaller): StoredRowSource[] {
  return [
    { scope: "user", scopeId: caller.email, owner: "user" },
    { scope: "workspace", scopeId: `solo:${caller.email}`, owner: "user" },
    ...(caller.orgId
      ? ([
          { scope: "org", scopeId: caller.orgId, owner: "org" },
          { scope: "workspace", scopeId: caller.orgId, owner: "org" },
        ] as const)
      : []),
  ];
}

/** The row id an owner scope and stored scope name for this caller. */
export function apiKeyRowScopeId(
  caller: ApiKeyCaller,
  owner: ApiKeyOwnerScope,
  storedScope: SecretScope,
): string | null {
  if (owner === "user") {
    if (storedScope === "user") return caller.email;
    if (storedScope === "workspace") return `solo:${caller.email}`;
    return null;
  }
  if (storedScope === "user") return null;
  return caller.orgId;
}

function providerForName(name: string): AgentProviderId | undefined {
  return AGENT_PROVIDER_CATALOG.find(
    (option) =>
      (option.key && secretKeyNames(option.key).includes(name)) ||
      option.endpointKey === name,
  )?.id;
}

/** The row the secrets write routes save `name` to for this caller. */
function writeTarget(
  caller: ApiKeyCaller,
  name: string,
  requested: "user" | "workspace",
): { scope: SecretScope; scopeId: string } | null {
  const registered = getRequiredSecret(name);
  const scope: SecretScope = registered ? registered.scope : requested;
  if (scope === "user") return { scope, scopeId: caller.email };
  if (scope === "org") {
    return caller.orgId ? { scope, scopeId: caller.orgId } : null;
  }
  return {
    scope,
    scopeId: caller.orgId ?? `solo:${caller.email}`,
  };
}

function toEntry(
  caller: ApiKeyCaller,
  meta: SecretMeta,
  owner: ApiKeyOwnerScope,
  manages: boolean,
): ApiKeyEntry {
  const registered = getRequiredSecret(meta.key);
  const managedBy = resolveSecretManagedBy(meta.key);
  const provider = providerForName(meta.key);
  const vault =
    meta.scope !== "user" &&
    !!meta.description?.startsWith(VAULT_SYNC_DESCRIPTION_PREFIX);
  const mayChange = !managedBy && !vault && (owner === "user" || manages);

  // Replace writes through the routes' own target, so it only applies when
  // that target is this row; otherwise it would add a second row instead.
  const target = writeTarget(
    caller,
    meta.key,
    meta.scope === "user" ? "user" : "workspace",
  );
  const writesThisRow =
    !!target &&
    target.scope === meta.scope &&
    target.scopeId === meta.scopeId &&
    registered?.kind !== "oauth";
  const canReplace = mayChange && !provider && writesThisRow;

  return {
    name: meta.key,
    ...(registered ? { label: registered.label } : {}),
    scope: owner,
    storedScope: meta.scope,
    ...(managedBy || !meta.last4 ? {} : { masked: meta.last4 }),
    updatedAt: meta.updatedAt || null,
    ...(vault ? { vault: true as const } : {}),
    registered: !!registered,
    ...(registered?.docsUrl ? { docsUrl: registered.docsUrl } : {}),
    ...(provider ? { provider } : {}),
    usedFor: describeSecretUsage(meta.key),
    ...(managedBy ? { managedBy } : {}),
    canReplace,
    canDelete: mayChange,
    canTest: canReplace && !!registered?.validator,
  };
}

async function callerRole(caller: ApiKeyCaller) {
  return caller.orgId ? readOrgMemberRole(caller.orgId, caller.email) : null;
}

/**
 * Every saved key the caller can use. Members get their own keys plus the
 * names of managed organization keys (never their masks); owners and admins
 * also get the organization's keys.
 */
export async function listApiKeys(
  caller: ApiKeyCaller,
): Promise<ApiKeysListing> {
  const manages = caller.orgId ? canManageOrg(await callerRole(caller)) : false;
  const sources = storedRowSources(caller);
  const reads = await Promise.all(
    sources.map((source) =>
      listAppSecretsForScope(source.scope, source.scopeId),
    ),
  );

  const keys: ApiKeyEntry[] = [];
  const managed: ApiKeyEntry[] = [];
  const stored = new Set<string>();
  for (const [index, rows] of reads.entries()) {
    const { owner } = sources[index]!;
    for (const meta of rows) {
      stored.add(canonicalSecretKey(meta.key));
      const entry = toEntry(caller, meta, owner, manages);
      if (entry.managedBy) {
        managed.push(entry);
      } else if (owner === "user" || manages) {
        keys.push(entry);
      }
    }
  }

  const addable: AddableApiKey[] = [];
  for (const secret of listRequiredSecrets()) {
    if (secret.kind !== "api-key") continue;
    if (stored.has(canonicalSecretKey(secret.key))) continue;
    if (providerForName(secret.key) || resolveSecretManagedBy(secret.key)) {
      continue;
    }
    if (secret.scope === "org" && !manages) continue;
    if (secret.scope === "workspace" && caller.orgId && !manages) continue;
    if (secret.scope === "org" && !caller.orgId) continue;
    addable.push({
      name: secret.key,
      label: secret.label,
      ...(secret.description ? { description: secret.description } : {}),
      ...(secret.docsUrl ? { docsUrl: secret.docsUrl } : {}),
      scope: secret.scope,
    });
  }

  return {
    keys,
    managed,
    addable,
    hasOrganization: !!caller.orgId,
    canManageOrg: manages,
  };
}

export type DeleteApiKeyRefusal =
  | { status: "not-found" }
  | { status: "forbidden"; error: string }
  | { status: "managed"; managedBy: SecretManagedBy }
  | { status: "vault" };

export type DeleteApiKeyResult =
  | { status: "deleted"; removed: string[] }
  | DeleteApiKeyRefusal;

/**
 * Delete one saved key row. A provider key also takes its endpoint and older
 * key names at the same row, so the provider stops rather than half-working.
 */
export async function deleteApiKey(
  caller: ApiKeyCaller,
  input: { name: string; scope: ApiKeyOwnerScope; storedScope?: SecretScope },
): Promise<DeleteApiKeyResult> {
  const storedScope = input.storedScope ?? input.scope;
  const scopeId = apiKeyRowScopeId(caller, input.scope, storedScope);
  if (!scopeId) return { status: "not-found" };
  if (input.scope === "org" && !canManageOrg(await callerRole(caller))) {
    return {
      status: "forbidden",
      error:
        "Only organization owners and admins can delete organization keys.",
    };
  }
  const managedBy = resolveSecretManagedBy(input.name);
  if (managedBy) return { status: "managed", managedBy };

  const rows = await listAppSecretsForScope(storedScope, scopeId);
  const row = rows.find((meta) => meta.key === input.name);
  if (!row) return { status: "not-found" };
  if (
    storedScope !== "user" &&
    row.description?.startsWith(VAULT_SYNC_DESCRIPTION_PREFIX)
  ) {
    return { status: "vault" };
  }

  const provider = AGENT_PROVIDER_CATALOG.find(
    (option) => option.id === providerForName(input.name),
  );
  const names = provider
    ? [
        ...(provider.key ? secretKeyNames(provider.key) : []),
        ...(provider.endpointKey ? [provider.endpointKey] : []),
      ]
    : [input.name];
  const present = new Set(rows.map((meta) => meta.key));
  const removed: string[] = [];
  for (const name of names) {
    if (!present.has(name)) continue;
    if (await deleteAppSecret({ key: name, scope: storedScope, scopeId })) {
      removed.push(name);
    }
  }
  return removed.length > 0
    ? { status: "deleted", removed }
    : { status: "not-found" };
}
