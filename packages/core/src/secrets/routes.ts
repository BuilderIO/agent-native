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
import { readBody } from "../server/h3-helpers.js";
import { DEV_MODE_USER_EMAIL, getSession } from "../server/auth.js";
import { getOrgContext } from "../org/context.js";
import {
  hasOAuthTokens,
  listOAuthAccountsByOwner,
} from "../oauth-tokens/store.js";
import {
  listRequiredSecrets,
  getRequiredSecret,
  type RegisteredSecret,
  type SecretScope,
} from "./register.js";
import {
  writeAppSecret,
  deleteAppSecret,
  getAppSecretMeta,
  readAppSecret,
  listAppSecretsForScope,
  type SecretMeta,
} from "./storage.js";

export interface SecretStatusPayload {
  key: string;
  label: string;
  description?: string;
  docsUrl?: string;
  scope: SecretScope;
  kind: "api-key" | "oauth";
  required: boolean;
  /** "set" = value present; "unset" = not configured; "invalid" = validator failed. */
  status: "set" | "unset" | "invalid";
  /** Last 4 chars — only populated when status === "set" for api-key kind. */
  last4?: string;
  /** Timestamp (ms) of the last write — only populated when status === "set". */
  updatedAt?: number;
  /** OAuth-kind: the provider id backing this secret. */
  oauthProvider?: string;
  /** OAuth-kind: url the Connect button should point at. */
  oauthConnectUrl?: string;
  /** Validator error message if status === "invalid". */
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
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return false;
  // hasOAuthTokens now requires an explicit owner — passing the dev sentinel
  // preserves the "any row exists" wildcard behaviour for local-dev only.
  if (session.email === DEV_MODE_USER_EMAIL) {
    return hasOAuthTokens(secret.oauthProvider, DEV_MODE_USER_EMAIL);
  }
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
  if (scope === "user") {
    const session = await getSession(event).catch(() => null);
    if (!session?.email) {
      return { scopeId: null, reason: "Authentication required" };
    }
    return { scopeId: session.email };
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
    if (getMethod(event) !== "GET") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }

    const secrets = listRequiredSecrets();
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

      // api-key: look up the stored row in app_secrets.
      const { scopeId } = await resolveScopeId(event, secret.scope);
      if (!scopeId) {
        payload.push(base);
        continue;
      }
      const meta = await getAppSecretMeta({
        key: secret.key,
        scope: secret.scope,
        scopeId,
      }).catch(() => null);
      if (meta) {
        base.status = "set";
        base.last4 = meta.last4;
        base.updatedAt = meta.updatedAt;
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
    return {
      error:
        err instanceof Error
          ? `Failed to save secret: ${err.message}`
          : "Failed to save secret",
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
  const removed = await deleteAppSecret({
    key: secret.key,
    scope: secret.scope,
    scopeId,
  });
  return { ok: true, removed };
}

/**
 * POST /_agent-native/secrets/:key/test — re-run the validator against the
 * current stored value without changing anything. Useful for the "Test" button.
 */
export function createTestSecretHandler() {
  return defineEventHandler(async (event: H3Event) => {
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
    if (!secret.validator) {
      return { ok: true, note: "No validator registered" };
    }
    const { scopeId } = await resolveScopeId(event, secret.scope);
    if (!scopeId) {
      setResponseStatus(event, 401);
      return { error: "Unable to resolve scope" };
    }
    const stored = await readAppSecret({
      key: secret.key,
      scope: secret.scope,
      scopeId,
    });
    if (!stored) {
      setResponseStatus(event, 404);
      return { error: "No value stored" };
    }
    try {
      const result = await secret.validator(stored.value);
      const ok = typeof result === "boolean" ? result : result?.ok === true;
      if (!ok) {
        const err =
          typeof result === "object" && result && result.error
            ? String(result.error)
            : "Validator rejected the value";
        return {
          ok: false,
          error: redactSecretFromMessage(err, stored.value),
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
        error: redactSecretFromMessage(message, stored.value),
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

  const registered = new Set(listRequiredSecrets().map((s) => s.key));
  const userRows = await listAppSecretsForScope("user", scopeId);
  const workspaceContext = await resolveScopeId(event, "workspace");
  const workspaceRows = workspaceContext.scopeId
    ? await listAppSecretsForScope("workspace", workspaceContext.scopeId)
    : [];

  const payload: AdHocSecretPayload[] = [];
  for (const row of [...userRows, ...workspaceRows]) {
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
    return {
      error:
        err instanceof Error
          ? `Failed to save secret: ${err.message}`
          : "Failed to save secret",
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
    const workspaceContext = await resolveScopeId(event, "workspace");
    if (workspaceContext.scopeId) {
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
