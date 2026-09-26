/**
 * H3 event handlers for the framework secrets registry.
 *
 * Mounted under `/_agent-native/secrets/*` by `core-routes-plugin`.
 *
 * NEVER return a secret's plain-text value from any of these handlers.
 */

import {
  defineEventHandler,
  getMethod,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import { readBody } from "../server/h3-helpers.js";
import { runWithRequestContext } from "../server/request-context.js";
import type { ResolvedAliasedSecret } from "../server/secret-key-aliases.js";

/**
 * Workspace-scoped secret writes/deletes are deployment-wide for every
 * org member who shares the resolved scopeId — a curious or malicious
 * member could otherwise overwrite `OPENAI_API_KEY` (or any unregistered
 * key) with their own value, redirecting every other member's automations
 * through their key for skimming, billing abuse, or DoS by deletion.
 *
 * Allow workspace-scope writes only for org owners/admins. The "solo"
 * fallback scopeId (`solo:<email>`) is single-user, so it bypasses the
 * check. A normal session with no active org also passes — there's no
 * privilege gradient to enforce in that case.
 *
 * Returns true if the request is allowed to write/delete this scope.
 */
async function canMutateWorkspaceScope(
  event: H3Event,
  scopeId: string,
): Promise<boolean> {
  // Solo / dev fallback scope — single user, no privilege gradient.
  if (scopeId.startsWith("solo:")) return true;
  const { getOrgContext } = await import("../org/context.js");
  const ctx = await getOrgContext(event).catch(() => null);
  // No active org — single-tenant flow, allow.
  if (!ctx?.orgId) return true;
  return ctx.role === "owner" || ctx.role === "admin";
}

/**
 * Org-scoped secrets (`scope: "org"`) live alongside `workspace` scope but
 * are stricter: they always require an active org and an owner/admin role.
 * No solo fallback — if the caller has no org, an org-scoped write makes no
 * sense and we refuse rather than write to an ambiguous row.
 */
async function canMutateOrgScope(
  event: H3Event,
  scopeId: string,
): Promise<boolean> {
  const { getOrgContext } = await import("../org/context.js");
  const ctx = await getOrgContext(event).catch(() => null);
  if (!ctx?.orgId || ctx.orgId !== scopeId) return false;
  return ctx.role === "owner" || ctx.role === "admin";
}
import { listOAuthAccountsByOwner } from "../oauth-tokens/store.js";
import {
  PERSONAL_PROVIDER_KEYS_RESTRICTED_ERROR_CODE,
  resolvePersonalProviderKeySaveDenial,
} from "../server/personal-provider-key-policy.js";
import { canonicalSecretKey, secretKeyNames } from "./key-aliases.js";
import {
  isManagedDeleteAllowed,
  managedDeleteRefusal,
  resolveSecretManagedBy,
} from "./managed-keys.js";
import {
  listRequiredSecrets,
  getRequiredSecret,
  type RegisteredSecret,
  type SecretManagedBy,
  type SecretScope,
  type SecretUsage,
} from "./register.js";
import {
  writeAppSecret,
  deleteAppSecret,
  last4,
  listAppSecretsForScope,
  readAppSecretMeta,
  VAULT_SYNC_DESCRIPTION_PREFIX,
  type SecretMeta,
} from "./storage.js";
import { describeSecretUsage } from "./usage.js";

/**
 * Where a stored value came from, as shown in Settings. `personal` and
 * `workspace` rows were saved from an app's Keys section; `vault` rows were
 * synced from the Dispatch workspace Vault and are managed there.
 */
export type SecretSource = "personal" | "workspace" | "vault";

function secretSource(
  scope: SecretScope,
  description: string | null | undefined,
): SecretSource {
  if (scope === "user") return "personal";
  return description?.startsWith(VAULT_SYNC_DESCRIPTION_PREFIX)
    ? "vault"
    : "workspace";
}

const NOT_RESOLVED: ResolvedAliasedSecret = {
  value: null,
  lookupFailed: false,
};

/**
 * Run `fn` as the signed-in caller so `resolveSecret`'s precedence applies —
 * then Settings never reports a Vault- or env-provided key as "unset" and
 * invites a duplicate. Anonymous requests get nothing: the resolver's
 * env fallback would otherwise leak deployment-key suffixes to the public.
 */
async function asRequestUser<T>(
  event: H3Event,
  fn: () => Promise<T>,
  anonymous: T,
): Promise<T> {
  const [{ getSession }, { getOrgContext }] = await Promise.all([
    import("../server/auth.js"),
    import("../org/context.js"),
  ]);
  const session = await getSession(event);
  if (!session?.email) return anonymous;
  const ctx = await getOrgContext(event);
  return runWithRequestContext(
    { userEmail: session.email, orgId: ctx?.orgId ?? undefined },
    fn,
  );
}

export interface SecretStatusPayload {
  key: string;
  label: string;
  description?: string;
  docsUrl?: string;
  scope: SecretScope;
  kind: "api-key" | "oauth";
  required: boolean;
  /**
   * "set" = value present; "unset" = not configured; "invalid" = the
   * provider rejected the value in effect (see `rejectedAt`); "unknown" = the
   * credential store could not be read.
   */
  status: "set" | "unset" | "invalid" | "unknown";
  /**
   * When the provider last rejected the value in effect (ms). Stays until a
   * call with it succeeds or the value is replaced. Metadata such as `last4`
   * is still reported so the row can offer Replace.
   */
  rejectedAt?: number;
  /** Exact stored scope supplying the runtime value, without exposing its id. */
  effectiveScope?: SecretScope;
  /** Where the effective value comes from — only when status is "set" or "invalid". */
  source?: SecretSource;
  /**
   * True when the effective value is the row this UI writes for the
   * registered scope, so it can be rotated or removed here. False when a
   * Vault, workspace, or env value is in use instead.
   */
  managedHere?: boolean;
  /** A shared value this row overrides; removing the row falls back to it. */
  overrides?: Exclude<SecretSource, "personal">;
  /** Scope of a shared value hidden by this user's personal row. */
  overriddenScope?: Exclude<SecretScope, "user">;
  /** Last 4 chars — for api-key kind when status is "set" or "invalid". */
  last4?: string;
  /** Timestamp (ms) of the last write — when status is "set" or "invalid". */
  updatedAt?: number;
  /** OAuth-kind: the provider id backing this secret. */
  oauthProvider?: string;
  /** OAuth-kind: url the Connect button should point at. */
  oauthConnectUrl?: string;
  /** Validator error message if status === "invalid". */
  error?: string;
  /** What uses the key, per app and feature. Empty when nothing is known to. */
  usedFor: SecretUsage[];
  /** Present when another Settings surface owns this key. */
  managedBy?: SecretManagedBy;
}

function redactSecretFromMessage(message: string, secretValue: string): string {
  if (!message || !secretValue) return message;
  return message.split(secretValue).join("[redacted]");
}

async function hasOAuthSecretForEvent(
  event: H3Event,
  secret: RegisteredSecret,
): Promise<boolean> {
  if (!secret.oauthProvider) return false;
  const { getSession } = await import("../server/auth.js");
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return false;
  const accounts = await listOAuthAccountsByOwner(
    secret.oauthProvider,
    session.email,
  );
  return accounts.length > 0;
}

/** Resolve the scopeId for a given scope, given the current session. */
async function resolveScopeId(
  event: H3Event,
  scope: SecretScope,
): Promise<{ scopeId: string | null; reason?: string }> {
  const [{ getSession }, { getOrgContext }] = await Promise.all([
    import("../server/auth.js"),
    import("../org/context.js"),
  ]);
  if (scope === "user") {
    const session = await getSession(event).catch(() => null);
    if (!session?.email) {
      return { scopeId: null, reason: "Authentication required" };
    }
    return { scopeId: session.email };
  }
  if (scope === "org") {
    // Org-scoped secrets require an active org — there's no solo fallback
    // because an "org" key without an org would land in an ambiguous row.
    const ctx = await getOrgContext(event).catch(() => null);
    if (ctx?.orgId) return { scopeId: ctx.orgId };
    return { scopeId: null, reason: "No active organization" };
  }
  // workspace
  const ctx = await getOrgContext(event).catch(() => null);
  if (ctx?.orgId) return { scopeId: ctx.orgId };
  // Fall back to session email in solo/dev mode so secrets still work without
  // an active organisation.
  const session = await getSession(event).catch(() => null);
  if (session?.email) return { scopeId: `solo:${session.email}` };
  return { scopeId: null, reason: "No workspace or session context" };
}

/** GET /_agent-native/secrets — list registered secrets with status. */
export function createListSecretsHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const [
      { prefetchSecrets, readProviderCredentialRejections },
      { resolveSecretWithAliasesDetailed },
    ] = await Promise.all([
      import("../server/credential-provider.js"),
      import("../server/secret-key-aliases.js"),
    ]);
    if (getMethod(event) !== "GET") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }

    const secrets = listRequiredSecrets();
    const apiKeys = secrets
      .filter((secret) => secret.kind !== "oauth")
      .map((secret) => secret.key);
    // One batched read per scope primes the request cache, so resolving
    // every registered key below costs a handful of queries, not N×scopes.
    const resolved = await asRequestUser(
      event,
      async () => {
        await prefetchSecrets(apiKeys.flatMap((key) => secretKeyNames(key)));
        return new Map(
          await Promise.all(
            apiKeys.map(
              async (key) =>
                [key, await resolveSecretWithAliasesDetailed(key)] as const,
            ),
          ),
        );
      },
      new Map<string, ResolvedAliasedSecret>(),
    );
    // null means the markers couldn't be read: the keys report "unknown"
    // rather than "set", since nobody knows whether they still work.
    let rejections: Awaited<
      ReturnType<typeof readProviderCredentialRejections>
    > | null;
    try {
      rejections = await readProviderCredentialRejections(
        [...resolved].flatMap(([key, detail]) =>
          detail.value && detail.source && detail.source !== "env"
            ? [{ key, value: detail.value }]
            : [],
        ),
      );
    } catch (error) {
      console.warn("[secrets] could not read provider rejection markers", {
        error: error instanceof Error ? error.message : String(error),
      });
      rejections = null;
    }
    const payload: SecretStatusPayload[] = [];

    for (const secret of secrets) {
      const base: SecretStatusPayload = {
        key: secret.key,
        label: secret.label,
        description: secret.description,
        docsUrl: secret.docsUrl,
        scope: secret.scope,
        kind: secret.kind,
        required: !!secret.required,
        status: "unset",
        usedFor: describeSecretUsage(secret.key),
        ...(secret.managedBy ? { managedBy: secret.managedBy } : {}),
      };

      if (secret.kind === "oauth") {
        base.oauthProvider = secret.oauthProvider;
        base.oauthConnectUrl = secret.oauthConnectUrl;
        if (secret.oauthProvider) {
          try {
            const has = await hasOAuthSecretForEvent(event, secret);
            base.status = has ? "set" : "unset";
          } catch {
            base.status = "unset";
          }
        }
        payload.push(base);
        continue;
      }

      // api-key: report saved user/workspace values and Vault values, but keep
      // deploy environment configuration out of user key settings.
      const { scopeId } = await resolveScopeId(event, secret.scope);
      const effective = resolved.get(secret.key) ?? NOT_RESOLVED;
      if (!effective.value) {
        if (effective.lookupFailed) {
          base.status = "unknown";
          base.error = "Could not read the credential store";
        }
        payload.push(base);
        continue;
      }
      if (
        !effective.source ||
        effective.source === "env" ||
        !effective.scopeId
      ) {
        if (effective.lookupFailed) {
          base.status = "unknown";
          base.error = "Could not read the credential store";
        }
        payload.push(base);
        continue;
      }
      const rejection = rejections?.get(secret.key);
      if (!rejections) {
        base.status = "unknown";
        base.error = "Could not check whether the provider rejected this key";
      } else if (rejection) {
        base.status = "invalid";
        base.error = "The provider rejected this key";
        base.rejectedAt = rejection.at;
      } else {
        base.status = "set";
      }
      const hit = {
        key: effective.key ?? secret.key,
        scope: effective.source,
        scopeId: effective.scopeId,
      };
      base.effectiveScope = hit.scope;
      const meta = await readAppSecretMeta(hit);
      base.last4 = meta?.last4 || last4(effective.value);
      base.updatedAt = meta?.updatedAt;
      base.source = secretSource(hit.scope, meta?.description);
      base.managedHere = hit.scope === secret.scope && hit.scopeId === scopeId;
      // A personal key hides the shared one; say so, so the fix is "remove
      // this" rather than "edit the Vault and wonder why nothing changed".
      if (base.managedHere && secret.scope === "user") {
        const shared = await asRequestUser(
          event,
          () =>
            resolveSecretWithAliasesDetailed(secret.key, {
              skipUserScope: true,
            }),
          NOT_RESOLVED,
        );
        if (shared.value && shared.source && shared.source !== "env") {
          if (shared.source === "org" || shared.source === "workspace") {
            base.overriddenScope = shared.source;
          }
          const sharedMeta = shared.scopeId
            ? await readAppSecretMeta({
                key: shared.key ?? secret.key,
                scope: shared.source,
                scopeId: shared.scopeId,
              })
            : null;
          const sharedSource = secretSource(
            shared.source,
            sharedMeta?.description,
          );
          base.overrides = sharedSource === "vault" ? "vault" : "workspace";
        }
      }
      payload.push(base);
    }

    return payload;
  });
}

/** POST /_agent-native/secrets/:key — write a secret. */
export function createWriteSecretHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const method = getMethod(event);
    const key = extractKeyFromEvent(event);

    if (!key) {
      setResponseStatus(event, 400);
      return { error: "Secret key required" };
    }

    const secret = getRequiredSecret(key);
    if (!secret) {
      setResponseStatus(event, 404);
      return { error: `Secret "${key}" is not registered` };
    }

    if (method === "POST" || method === "PUT") {
      return handleWrite(event, secret);
    }
    if (method === "DELETE") {
      return handleDelete(event, secret);
    }
    setResponseStatus(event, 405);
    return { error: "Method not allowed" };
  });
}

async function handleWrite(event: H3Event, secret: RegisteredSecret) {
  if (secret.kind === "oauth") {
    setResponseStatus(event, 400);
    return {
      error: `"${secret.key}" is an OAuth-kind secret — connect via ${secret.oauthConnectUrl ?? "the OAuth flow"} instead`,
    };
  }
  const body = (await readBody(event).catch(() => ({}))) as {
    value?: unknown;
  };

  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (!value) {
    setResponseStatus(event, 400);
    return { error: "value is required" };
  }

  const { scopeId, reason } = await resolveScopeId(event, secret.scope);
  if (!scopeId) {
    setResponseStatus(event, 401);
    return { error: reason ?? "Unable to resolve scope" };
  }

  if (
    secret.scope === "workspace" &&
    !(await canMutateWorkspaceScope(event, scopeId))
  ) {
    setResponseStatus(event, 403);
    return {
      error:
        "Only organization owners and admins can set workspace-scoped secrets",
    };
  }
  if (secret.scope === "org" && !(await canMutateOrgScope(event, scopeId))) {
    setResponseStatus(event, 403);
    return {
      error: "Only organization owners and admins can set org-scoped secrets",
    };
  }
  if (secret.scope === "user") {
    const denial = await resolvePersonalProviderKeySaveDenial(
      event,
      scopeId,
      secret.key,
    );
    if (denial) {
      setResponseStatus(event, 403);
      return {
        error: denial,
        errorCode: PERSONAL_PROVIDER_KEYS_RESTRICTED_ERROR_CODE,
      };
    }
  }

  // Run validator if registered — return the validator's error on failure.
  if (secret.validator) {
    try {
      const result = await secret.validator(value);
      const ok = typeof result === "boolean" ? result : result?.ok === true;
      if (!ok) {
        setResponseStatus(event, 400);
        const err =
          typeof result === "object" && result && result.error
            ? String(result.error)
            : "Validator rejected the value";
        return { error: redactSecretFromMessage(err, value) };
      }
    } catch (err) {
      setResponseStatus(event, 400);
      const message =
        err instanceof Error
          ? `Validator threw: ${err.message}`
          : "Validator threw";
      return {
        error: redactSecretFromMessage(message, value),
      };
    }
  }

  try {
    await writeAppSecret({
      key: secret.key,
      value,
      scope: secret.scope,
      scopeId,
    });
  } catch (err) {
    // Scrub: never surface the value in any error path.
    setResponseStatus(event, 500);
    const message =
      err instanceof Error
        ? `Failed to save secret: ${err.message}`
        : "Failed to save secret";
    return {
      error: redactSecretFromMessage(message, value),
    };
  }

  return { ok: true, status: "set" };
}

async function handleDelete(event: H3Event, secret: RegisteredSecret) {
  if (secret.kind === "oauth") {
    setResponseStatus(event, 400);
    return {
      error: `"${secret.key}" is an OAuth-kind secret — disconnect via the OAuth flow instead`,
    };
  }
  const refusal = refuseManagedDelete(event, secret.key);
  if (refusal) return refusal;
  const { scopeId, reason } = await resolveScopeId(event, secret.scope);
  if (!scopeId) {
    setResponseStatus(event, 401);
    return { error: reason ?? "Unable to resolve scope" };
  }
  if (
    secret.scope === "workspace" &&
    !(await canMutateWorkspaceScope(event, scopeId))
  ) {
    setResponseStatus(event, 403);
    return {
      error:
        "Only organization owners and admins can delete workspace-scoped secrets",
    };
  }
  if (secret.scope === "org" && !(await canMutateOrgScope(event, scopeId))) {
    setResponseStatus(event, 403);
    return {
      error:
        "Only organization owners and admins can delete org-scoped secrets",
    };
  }
  // Removing a key removes it under every name it is stored as, or a row saved
  // under an older name would keep the credential working after "Remove".
  const removals = await Promise.all(
    secretKeyNames(secret.key).map((key) =>
      deleteAppSecret({ key, scope: secret.scope, scopeId }),
    ),
  );
  return { ok: true, removed: removals.some(Boolean) };
}

/**
 * A managed key is removed from its owner surface, which names itself with
 * `?managedBy=<id>`. Returns the 409 body to send, or null to continue.
 */
function refuseManagedDelete(event: H3Event, key: string) {
  const managedBy = resolveSecretManagedBy(key);
  if (!managedBy) return null;
  const requestedBy = getQuery(event).managedBy;
  if (
    isManagedDeleteAllowed(
      managedBy,
      typeof requestedBy === "string" ? requestedBy : null,
    )
  ) {
    return null;
  }
  setResponseStatus(event, 409);
  return managedDeleteRefusal(key, managedBy);
}

/**
 * POST /_agent-native/secrets/:key/test — validate an optional candidate value
 * or the current stored value without changing anything.
 */
export function createTestSecretHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const { resolveSecretWithAliasesDetailed } =
      await import("../server/secret-key-aliases.js");
    if (getMethod(event) !== "POST") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }
    const key = extractKeyFromEvent(event, { suffix: "/test" });
    if (!key) {
      setResponseStatus(event, 400);
      return { error: "Secret key required" };
    }
    const secret = getRequiredSecret(key);
    if (!secret) {
      setResponseStatus(event, 404);
      return { error: `Secret "${key}" is not registered` };
    }
    if (secret.kind === "oauth") {
      // For OAuth we just report whether tokens exist.
      const has = await hasOAuthSecretForEvent(event, secret).catch(
        () => false,
      );
      return { ok: has };
    }

    const body = (await readBody(event).catch(() => ({}))) as {
      value?: unknown;
    };
    const hasCandidateValue = Object.hasOwn(body, "value");
    const candidateValue =
      typeof body.value === "string" ? body.value.trim() : undefined;

    if (hasCandidateValue && !candidateValue) {
      setResponseStatus(event, 400);
      return { error: "value must be a non-empty string" };
    }

    const { scopeId, reason } = await resolveScopeId(event, secret.scope);
    if (!scopeId) {
      setResponseStatus(event, 401);
      return { error: reason ?? "Unable to resolve scope" };
    }
    if (
      secret.scope === "workspace" &&
      !(await canMutateWorkspaceScope(event, scopeId))
    ) {
      setResponseStatus(event, 403);
      return {
        error:
          "Only organization owners and admins can set workspace-scoped secrets",
      };
    }
    if (secret.scope === "org" && !(await canMutateOrgScope(event, scopeId))) {
      setResponseStatus(event, 403);
      return {
        error: "Only organization owners and admins can set org-scoped secrets",
      };
    }

    if (!secret.validator) {
      return { ok: true, note: "No validator registered" };
    }

    let value = candidateValue;
    if (!value) {
      // Test what the runtime uses, which may be a Vault or env value rather
      // than a row saved from this UI.
      const stored = await asRequestUser(
        event,
        () => resolveSecretWithAliasesDetailed(secret.key),
        NOT_RESOLVED,
      );
      if (!stored.value) {
        setResponseStatus(event, 404);
        return { error: "No value stored" };
      }
      value = stored.value;
    }

    try {
      const result = await secret.validator(value);
      const ok = typeof result === "boolean" ? result : result?.ok === true;
      if (!ok) {
        const err =
          typeof result === "object" && result && result.error
            ? String(result.error)
            : "Validator rejected the value";
        return {
          ok: false,
          error: redactSecretFromMessage(err, value),
        };
      }
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof Error
          ? `Validator threw: ${err.message}`
          : "Validator threw";
      return {
        ok: false,
        error: redactSecretFromMessage(message, value),
      };
    }
  });
}

// ---------------------------------------------------------------------------
// Ad-hoc secrets — user-/agent-created keys not in the registry
// ---------------------------------------------------------------------------

export interface AdHocSecretPayload {
  name: string;
  scope: SecretScope;
  scopeId: string;
  source: Exclude<SecretSource, "env">;
  description: string | null;
  last4: string;
  urlAllowlist: string[] | null;
  createdAt: number;
  updatedAt: number;
  /** What uses the key. Empty when nothing is known to. */
  usedFor: SecretUsage[];
  /** Present when another Settings surface owns this key. */
  managedBy?: SecretManagedBy;
}

const AD_HOC_NAME_REGEX = /^[A-Za-z0-9_-]+$/;

function metaToPayload(meta: SecretMeta): AdHocSecretPayload {
  const managedBy = resolveSecretManagedBy(meta.key);
  return {
    usedFor: describeSecretUsage(canonicalSecretKey(meta.key)),
    ...(managedBy ? { managedBy } : {}),
    name: meta.key,
    scope: meta.scope,
    scopeId: meta.scopeId,
    source: secretSource(meta.scope, meta.description),
    description: meta.description,
    last4: meta.last4,
    urlAllowlist: meta.urlAllowlist,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

/**
 * Handler for `/_agent-native/secrets/adhoc[/:name]`.
 *
 * - GET (no name) — list all ad-hoc keys for the user's scope
 * - POST (no name) — create or update an ad-hoc key
 * - DELETE (with name) — delete an ad-hoc key
 *
 * Ad-hoc keys are arbitrary named secrets users or the agent create at
 * runtime for automation use (e.g. "SLACK_WEBHOOK", "HUBSPOT_API_KEY").
 * They differ from registered secrets (`registerRequiredSecret`) in that
 * they have no template-defined metadata, validator, or onboarding step.
 */
export function createAdHocSecretHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const method = getMethod(event);
    const name = extractAdHocName(event);

    if (method === "GET" && !name) {
      return handleAdHocList(event);
    }
    if (method === "POST" && !name) {
      return handleAdHocWrite(event);
    }
    if (method === "DELETE" && name) {
      return handleAdHocDelete(event, name);
    }
    setResponseStatus(event, 405);
    return { error: "Method not allowed" };
  });
}

async function handleAdHocList(event: H3Event) {
  const scope: SecretScope = "user";
  const { scopeId, reason } = await resolveScopeId(event, scope);
  if (!scopeId) {
    setResponseStatus(event, 401);
    return { error: reason ?? "Unable to resolve scope" };
  }

  const registeredScope = new Map(
    listRequiredSecrets().map((s) => [s.key, s.scope] as const),
  );
  const userRows = await listAppSecretsForScope("user", scopeId);
  const workspaceContext = await resolveScopeId(event, "workspace");
  const workspaceRows = workspaceContext.scopeId
    ? await listAppSecretsForScope("workspace", workspaceContext.scopeId)
    : [];
  // Org rows are the Dispatch Vault's sync target. `${keys.NAME}` resolves
  // them, so list them here or people cannot see which keys they already have.
  const orgContext = await resolveScopeId(event, "org");
  const orgRows = orgContext.scopeId
    ? await listAppSecretsForScope("org", orgContext.scopeId)
    : [];

  const payload: AdHocSecretPayload[] = [];
  for (const row of [...userRows, ...workspaceRows, ...orgRows]) {
    if (registeredScope.has(row.key)) continue;
    // A row under an older name of a registered key (GEMINI_API_KEY) at that
    // key's scope already shows as its status, and the key's Remove clears
    // it. At any other scope (Brain once saved GEMINI_API_KEY for the whole
    // workspace) this list is the only place it can be removed.
    if (registeredScope.get(canonicalSecretKey(row.key)) === row.scope) {
      continue;
    }
    payload.push(metaToPayload(row));
  }
  return payload;
}

async function handleAdHocWrite(event: H3Event) {
  const body = (await readBody(event).catch(() => ({}))) as {
    name?: unknown;
    value?: unknown;
    description?: unknown;
    scope?: unknown;
    urlAllowlist?: unknown;
  };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || !AD_HOC_NAME_REGEX.test(name)) {
    setResponseStatus(event, 400);
    return {
      error:
        "name is required and may only contain letters, digits, underscores, and dashes",
    };
  }
  if (getRequiredSecret(name)) {
    setResponseStatus(event, 400);
    return {
      error: `"${name}" is a registered secret — use POST /_agent-native/secrets/${name} instead`,
    };
  }

  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (!value) {
    setResponseStatus(event, 400);
    return { error: "value is required" };
  }

  const scope: SecretScope = body.scope === "workspace" ? "workspace" : "user";

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : undefined;

  let urlAllowlistJson: string | undefined;
  if (body.urlAllowlist !== undefined && body.urlAllowlist !== null) {
    const normalized = normalizeUrlAllowlist(body.urlAllowlist);
    if (normalized.ok === false) {
      setResponseStatus(event, 400);
      return { error: normalized.error };
    }
    urlAllowlistJson = JSON.stringify(normalized.origins);
  }

  const { scopeId, reason } = await resolveScopeId(event, scope);
  if (!scopeId) {
    setResponseStatus(event, 401);
    return { error: reason ?? "Unable to resolve scope" };
  }

  if (
    scope === "workspace" &&
    !(await canMutateWorkspaceScope(event, scopeId))
  ) {
    setResponseStatus(event, 403);
    return {
      error:
        "Only organization owners and admins can set workspace-scoped secrets",
    };
  }

  try {
    await writeAppSecret({
      key: name,
      value,
      scope,
      scopeId,
      description,
      urlAllowlist: urlAllowlistJson,
    });
  } catch (err) {
    setResponseStatus(event, 500);
    const message =
      err instanceof Error
        ? `Failed to save secret: ${err.message}`
        : "Failed to save secret";
    return {
      error: redactSecretFromMessage(message, value),
    };
  }

  return { ok: true, key: name };
}

async function handleAdHocDelete(event: H3Event, name: string) {
  if (getRequiredSecret(name)) {
    setResponseStatus(event, 400);
    return {
      error: `"${name}" is a registered secret — delete via the registered route instead`,
    };
  }
  const refusal = refuseManagedDelete(event, name);
  if (refusal) return refusal;
  // The list can hold a personal and a workspace row under one name, so the
  // row's own scope says which one to remove. Without it, personal first.
  const requestedScope = getQuery(event).scope;
  if (
    requestedScope !== undefined &&
    requestedScope !== "user" &&
    requestedScope !== "workspace"
  ) {
    setResponseStatus(event, 400);
    return { error: 'scope must be "user" or "workspace"' };
  }
  if (requestedScope === "workspace") {
    const { scopeId, reason } = await resolveScopeId(event, "workspace");
    if (!scopeId) {
      setResponseStatus(event, 401);
      return { error: reason ?? "Unable to resolve scope" };
    }
    if (!(await canMutateWorkspaceScope(event, scopeId))) {
      setResponseStatus(event, 403);
      return {
        error:
          "Only organization owners and admins can delete workspace-scoped secrets",
      };
    }
    const removed = await deleteAppSecret({
      key: name,
      scope: "workspace",
      scopeId,
    });
    return { ok: true, removed };
  }
  const scope: SecretScope = "user";
  const { scopeId, reason } = await resolveScopeId(event, scope);
  if (!scopeId) {
    setResponseStatus(event, 401);
    return { error: reason ?? "Unable to resolve scope" };
  }
  const removed = await deleteAppSecret({ key: name, scope, scopeId });
  if (requestedScope === "user") return { ok: true, removed };
  if (!removed) {
    // Fall back to workspace scope so the agent / UI can clean up shared keys.
    // Gate the fallback behind the org-admin check so a regular member can't
    // DoS every other member's automations by deleting shared workspace keys.
    const workspaceContext = await resolveScopeId(event, "workspace");
    if (workspaceContext.scopeId) {
      if (!(await canMutateWorkspaceScope(event, workspaceContext.scopeId))) {
        // No-op silently for non-admins — the user-scope row didn't exist
        // and they don't have permission to touch the workspace row, so
        // there's nothing to remove from their point of view.
        return { ok: true, removed: false };
      }
      const removedWorkspace = await deleteAppSecret({
        key: name,
        scope: "workspace",
        scopeId: workspaceContext.scopeId,
      });
      return { ok: true, removed: removedWorkspace };
    }
  }
  return { ok: true, removed };
}

function extractAdHocName(event: H3Event): string | null {
  const pathname = (event.url?.pathname || "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!pathname) return null;
  const parts = pathname.split("/");
  // The router strips the `/secrets/adhoc` prefix, so `parts[0]` (if present)
  // is the name. When the request is the bare `/adhoc` listing, parts is empty.
  const candidate = parts[0];
  if (!candidate) return null;
  return AD_HOC_NAME_REGEX.test(candidate) ? candidate : null;
}

function normalizeUrlAllowlist(
  input: unknown,
): { ok: true; origins: string[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || !input.every((v) => typeof v === "string")) {
    return { ok: false, error: "urlAllowlist must be an array of strings" };
  }

  const origins: string[] = [];
  for (const raw of input) {
    const value = raw.trim();
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return {
        ok: false,
        error: `urlAllowlist entry "${value}" is not a valid URL`,
      };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return {
        ok: false,
        error: `urlAllowlist entry "${value}" must use http or https`,
      };
    }
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  return { ok: true, origins };
}

/** Extract the key from `/:key` or `/:key/test` after the `/secrets` prefix strip. */
function extractKeyFromEvent(
  event: H3Event,
  opts: { suffix?: string } = {},
): string | null {
  const pathname = (event.url?.pathname || "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!pathname) return null;
  const parts = pathname.split("/");
  if (opts.suffix === "/test") {
    if (parts.length < 2 || parts[parts.length - 1] !== "test") return null;
    return parts[0];
  }
  return parts[0];
}
