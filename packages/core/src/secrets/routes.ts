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
  setResponseStatus,
  type H3Event,
} from "h3";

import type { ResolvedSecretDetail } from "../server/credential-provider.js";
import { readBody } from "../server/h3-helpers.js";
import { runWithRequestContext } from "../server/request-context.js";

async function canMutateWorkspaceScope(
  event: H3Event,
  scopeId: string,
): Promise<boolean> {
  if (scopeId.startsWith("solo:")) return true;
  const { getOrgContext } = await import("../org/context.js");
  const ctx = await getOrgContext(event).catch(() => null);
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
  listRequiredSecrets,
  getRequiredSecret,
  type RegisteredSecret,
  type SecretScope,
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

const NOT_RESOLVED: ResolvedSecretDetail = { value: null, lookupFailed: false };

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
  status: "set" | "unset" | "invalid" | "unknown";
  effectiveScope?: SecretScope;
  source?: SecretSource;
  managedHere?: boolean;
  overrides?: Exclude<SecretSource, "personal">;
  overriddenScope?: Exclude<SecretScope, "user">;
  last4?: string;
  updatedAt?: number;
  oauthProvider?: string;
  oauthConnectUrl?: string;
  error?: string;
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
    const ctx = await getOrgContext(event).catch(() => null);
    if (ctx?.orgId) return { scopeId: ctx.orgId };
    return { scopeId: null, reason: "No active organization" };
  }
  const ctx = await getOrgContext(event).catch(() => null);
  if (ctx?.orgId) return { scopeId: ctx.orgId };
  const session = await getSession(event).catch(() => null);
  if (session?.email) return { scopeId: `solo:${session.email}` };
  return { scopeId: null, reason: "No workspace or session context" };
}

export function createListSecretsHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const { prefetchSecrets, resolveSecretDetailed } =
      await import("../server/credential-provider.js");
    if (getMethod(event) !== "GET") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }

    const secrets = listRequiredSecrets();
    const apiKeys = secrets
      .filter((secret) => secret.kind !== "oauth")
      .map((secret) => secret.key);
    const resolved = await asRequestUser(
      event,
      async () => {
        await prefetchSecrets(apiKeys);
        return new Map(
          await Promise.all(
            apiKeys.map(
              async (key) => [key, await resolveSecretDetailed(key)] as const,
            ),
          ),
        );
      },
      new Map<string, ResolvedSecretDetail>(),
    );
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
      base.status = "set";
      const hit = {
        key: secret.key,
        scope: effective.source,
        scopeId: effective.scopeId,
      };
      base.effectiveScope = hit.scope;
      const meta = await readAppSecretMeta(hit);
      base.last4 = meta?.last4 || last4(effective.value);
      base.updatedAt = meta?.updatedAt;
      base.source = secretSource(hit.scope, meta?.description);
      base.managedHere = hit.scope === secret.scope && hit.scopeId === scopeId;
      if (base.managedHere && secret.scope === "user") {
        const shared = await asRequestUser(
          event,
          () => resolveSecretDetailed(secret.key, { skipUserScope: true }),
          NOT_RESOLVED,
        );
        if (shared.value && shared.source && shared.source !== "env") {
          if (shared.source === "org" || shared.source === "workspace") {
            base.overriddenScope = shared.source;
          }
          const sharedMeta = shared.scopeId
            ? await readAppSecretMeta({
                key: secret.key,
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
  const removed = await deleteAppSecret({
    key: secret.key,
    scope: secret.scope,
    scopeId,
  });
  return { ok: true, removed };
}

export function createTestSecretHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const { resolveSecretDetailed } =
      await import("../server/credential-provider.js");
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
      const stored = await asRequestUser(
        event,
        () => resolveSecretDetailed(secret.key),
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
}

const AD_HOC_NAME_REGEX = /^[A-Za-z0-9_-]+$/;

function metaToPayload(meta: SecretMeta): AdHocSecretPayload {
  return {
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

  const registered = new Set(listRequiredSecrets().map((s) => s.key));
  const userRows = await listAppSecretsForScope("user", scopeId);
  const workspaceContext = await resolveScopeId(event, "workspace");
  const workspaceRows = workspaceContext.scopeId
    ? await listAppSecretsForScope("workspace", workspaceContext.scopeId)
    : [];
  const orgContext = await resolveScopeId(event, "org");
  const orgRows = orgContext.scopeId
    ? await listAppSecretsForScope("org", orgContext.scopeId)
    : [];

  const payload: AdHocSecretPayload[] = [];
  for (const row of [...userRows, ...workspaceRows, ...orgRows]) {
    if (registered.has(row.key)) continue;
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
  const scope: SecretScope = "user";
  const { scopeId, reason } = await resolveScopeId(event, scope);
  if (!scopeId) {
    setResponseStatus(event, 401);
    return { error: reason ?? "Unable to resolve scope" };
  }
  const removed = await deleteAppSecret({ key: name, scope, scopeId });
  if (!removed) {
    // Fall back to workspace scope so the agent / UI can clean up shared keys.
    // Gate the fallback behind the org-admin check so a regular member can't
    // DoS every other member's automations by deleting shared workspace keys.
    const workspaceContext = await resolveScopeId(event, "workspace");
    if (workspaceContext.scopeId) {
      if (!(await canMutateWorkspaceScope(event, workspaceContext.scopeId))) {
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
