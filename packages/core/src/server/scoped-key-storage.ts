import type { H3Event } from "h3";

import { getOrgContext } from "../org/context.js";
import {
  getRequiredSecret,
  type RegisteredSecret,
  type SecretScope,
} from "../secrets/register.js";
import { writeAppSecret } from "../secrets/storage.js";
import { getSession } from "./auth.js";

const KEY_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ScopedKeySaveRequestScope =
  | "app"
  | "auto"
  | "org"
  | "user"
  | "workspace"
  | undefined;

export interface ScopedKeyValue {
  key: string;
  value: string;
}

export interface ScopedKeySaveRow {
  key: string;
  scope: SecretScope;
  scopeId: string;
}

export class ScopedKeyStorageError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ScopedKeyStorageError";
  }
}

export function findUnsupportedScopedKeyNames(
  vars: unknown,
  allowedKeys: Iterable<string>,
): string[] {
  if (!Array.isArray(vars)) return [];

  const allowed = new Set(allowedKeys);
  const unsupported = new Set<string>();
  for (const entry of vars) {
    if (!entry || typeof entry !== "object") continue;
    const key = (entry as { key?: unknown }).key;
    const normalizedKey = typeof key === "string" ? key.trim() : "";
    if (normalizedKey && !allowed.has(normalizedKey)) {
      unsupported.add(normalizedKey);
    }
  }
  return [...unsupported];
}

function redactSecretFromMessage(message: string, secretValue: string): string {
  if (!message || !secretValue) return message;
  return message.split(secretValue).join("[redacted]");
}

function normalizeKeyValueVars(vars: unknown): ScopedKeyValue[] {
  if (!Array.isArray(vars) || vars.length === 0) {
    throw new ScopedKeyStorageError(400, "vars array required");
  }

  const out: ScopedKeyValue[] = [];
  for (const entry of vars) {
    if (!entry || typeof entry !== "object") {
      throw new ScopedKeyStorageError(400, "Each var must be an object");
    }
    const { key, value } = entry as { key?: unknown; value?: unknown };
    const normalizedKey = typeof key === "string" ? key.trim() : "";
    if (!normalizedKey || !KEY_NAME_RE.test(normalizedKey)) {
      throw new ScopedKeyStorageError(
        400,
        normalizedKey
          ? `Invalid key name "${normalizedKey}"`
          : "Each var requires a key",
      );
    }
    const normalizedValue = typeof value === "string" ? value.trim() : "";
    if (!normalizedValue) {
      throw new ScopedKeyStorageError(
        400,
        `Value for ${normalizedKey} must be non-empty`,
      );
    }
    out.push({ key: normalizedKey, value: normalizedValue });
  }
  return out;
}

function resolveTargetScope(
  secret: RegisteredSecret | undefined,
  requestedScope: ScopedKeySaveRequestScope,
): SecretScope {
  if (secret?.kind === "api-key") return secret.scope;
  if (requestedScope === "org") return "org";
  if (requestedScope === "workspace" || requestedScope === "app") {
    return "workspace";
  }
  return "user";
}

async function resolveScopeId(
  event: H3Event,
  scope: SecretScope,
): Promise<{
  scopeId: string;
  orgRole: string | null;
  orgId: string | null;
}> {
  const session = await getSession(event).catch(() => null);
  const email = session?.email ?? null;

  if (scope === "user") {
    if (!email) {
      throw new ScopedKeyStorageError(401, "Sign in to save keys");
    }
    return { scopeId: email, orgRole: null, orgId: null };
  }

  const orgCtx = await getOrgContext(event).catch(() => null);
  const orgId = orgCtx?.orgId ?? null;
  const orgRole = orgCtx?.role ?? null;

  if (scope === "org") {
    if (!orgId) {
      throw new ScopedKeyStorageError(401, "No active organization");
    }
    return { scopeId: orgId, orgRole, orgId };
  }

  if (orgId) {
    return { scopeId: orgId, orgRole, orgId };
  }
  if (!email) {
    throw new ScopedKeyStorageError(401, "Sign in to save workspace keys");
  }
  return { scopeId: `solo:${email}`, orgRole: null, orgId: null };
}

function assertCanMutateScope(
  scope: SecretScope,
  scopeId: string,
  orgRole: string | null,
): void {
  if (scope === "user") return;
  if (scope === "workspace" && scopeId.startsWith("solo:")) return;
  if (orgRole === "owner" || orgRole === "admin") return;
  throw new ScopedKeyStorageError(
    403,
    scope === "org"
      ? "Only organization owners and admins can set org-scoped keys"
      : "Only organization owners and admins can set workspace-scoped keys",
  );
}

async function validateRegisteredSecret(
  secret: RegisteredSecret | undefined,
  value: string,
): Promise<void> {
  if (!secret) return;
  if (secret.kind === "oauth") {
    throw new ScopedKeyStorageError(
      400,
      `"${secret.key}" is an OAuth-kind secret and must be connected via OAuth`,
    );
  }
  if (!secret.validator) return;
  try {
    const result = await secret.validator(value);
    const ok = typeof result === "boolean" ? result : result?.ok === true;
    if (ok) return;
    const error =
      typeof result === "object" && result && result.error
        ? String(result.error)
        : "Validator rejected the value";
    throw new ScopedKeyStorageError(400, redactSecretFromMessage(error, value));
  } catch (err) {
    if (err instanceof ScopedKeyStorageError) throw err;
    const message =
      err instanceof Error
        ? `Validator threw: ${err.message}`
        : "Validator threw";
    throw new ScopedKeyStorageError(
      400,
      redactSecretFromMessage(message, value),
    );
  }
}

export async function saveKeyValuesToScopedSecrets(
  event: H3Event,
  vars: unknown,
  requestedScope?: ScopedKeySaveRequestScope,
): Promise<{ saved: string[]; rows: ScopedKeySaveRow[] }> {
  const normalized = normalizeKeyValueVars(vars);
  const rows: ScopedKeySaveRow[] = [];

  for (const entry of normalized) {
    const secret = getRequiredSecret(entry.key);
    const scope = resolveTargetScope(secret, requestedScope);
    const { scopeId, orgRole } = await resolveScopeId(event, scope);
    assertCanMutateScope(scope, scopeId, orgRole);
    await validateRegisteredSecret(secret, entry.value);
    await writeAppSecret({
      key: entry.key,
      value: entry.value,
      scope,
      scopeId,
    });
    rows.push({ key: entry.key, scope, scopeId });
  }

  return { saved: rows.map((row) => row.key), rows };
}
