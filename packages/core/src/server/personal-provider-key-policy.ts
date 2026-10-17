/**
 * "Restrict personal API keys": an organization policy that stops members from
 * using or adding their own model provider keys and personal Builder.io
 * connection. Owners and admins keep theirs. Nothing is deleted, so turning the
 * policy off restores every member's stored keys without re-entry.
 *
 * The resolvers (`resolveSecretDetailed`, `getOwnerApiKey`, the Builder
 * credential and OAuth reads) and the personal write paths all ask
 * `isPersonalProviderKeyUseRestricted`. Keep it the only place that decides.
 */

import type { H3Event } from "h3";

import {
  OLLAMA_BASE_URL_ENV_VAR,
  OPENAI_BASE_URL_ENV_VAR,
  PROVIDER_ENV_VARS,
} from "../agent/engine/provider-env-vars.js";
import { getDbExec } from "../db/client.js";
import type { OrgRole } from "../org/types.js";
import { getOrgSetting, mutateOrgSetting } from "../settings/org-settings.js";
import { BUILDER_CREDENTIAL_KEYS } from "./builder-credential-keys.js";
import {
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
} from "./request-context.js";

export const PERSONAL_PROVIDER_KEY_POLICY_SETTING_KEY =
  "restrict-personal-provider-keys";

export const PERSONAL_PROVIDER_KEYS_RESTRICTED_MESSAGE =
  "Owners and admins restricted personal API keys.";

export const PERSONAL_PROVIDER_KEYS_RESTRICTED_ERROR_CODE =
  "personal_provider_keys_restricted";

/**
 * Model provider keys, their endpoints, and the Builder.io key pair. Every
 * other personal secret (integrations, ad-hoc keys) is out of scope: the
 * policy is about who pays for and chooses the model, not a general lockout.
 */
const PERSONAL_PROVIDER_POLICY_KEYS: ReadonlySet<string> = new Set([
  ...PROVIDER_ENV_VARS,
  OPENAI_BASE_URL_ENV_VAR,
  OLLAMA_BASE_URL_ENV_VAR,
  "GEMINI_API_KEY",
  "VOYAGE_API_KEY",
  ...BUILDER_CREDENTIAL_KEYS,
]);

export function isPersonalProviderPolicyKey(key: string): boolean {
  return PERSONAL_PROVIDER_POLICY_KEYS.has(key);
}

export function listPersonalProviderPolicyKeys(): string[] {
  return [...PERSONAL_PROVIDER_POLICY_KEYS];
}

export interface PersonalProviderKeyPolicy {
  restricted: boolean;
  updatedAt: number | null;
  updatedBy: string | null;
}

export class PersonalProviderKeysRestrictedError extends Error {
  readonly statusCode = 403;
  readonly errorCode = PERSONAL_PROVIDER_KEYS_RESTRICTED_ERROR_CODE;
  constructor() {
    super(PERSONAL_PROVIDER_KEYS_RESTRICTED_MESSAGE);
    this.name = "PersonalProviderKeysRestrictedError";
  }
}

/** Throws when the settings store cannot be read; never reports "off" instead. */
export async function readPersonalProviderKeyPolicy(
  orgId: string,
): Promise<PersonalProviderKeyPolicy> {
  const row = await getOrgSetting(
    orgId,
    PERSONAL_PROVIDER_KEY_POLICY_SETTING_KEY,
  );
  return {
    restricted: row?.restricted === true,
    updatedAt: typeof row?.updatedAt === "number" ? row.updatedAt : null,
    updatedBy: typeof row?.updatedBy === "string" ? row.updatedBy : null,
  };
}

export async function writePersonalProviderKeyPolicy(
  orgId: string,
  input: { restricted: boolean; updatedBy: string },
): Promise<{ policy: PersonalProviderKeyPolicy; changed: boolean }> {
  let previous = false;
  const row = await mutateOrgSetting(
    orgId,
    PERSONAL_PROVIDER_KEY_POLICY_SETTING_KEY,
    (current) => {
      previous = current?.restricted === true;
      return {
        restricted: input.restricted,
        updatedAt: Date.now(),
        updatedBy: input.updatedBy,
      };
    },
  );
  forgetRequestRestrictions();
  return {
    policy: {
      restricted: row.restricted === true,
      updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : null,
      updatedBy: typeof row.updatedBy === "string" ? row.updatedBy : null,
    },
    changed: previous !== input.restricted,
  };
}

// One answer per (email, org) per request: a chat turn resolves several keys,
// and each would otherwise repeat the org and role reads.
const _requestRestrictions = new WeakMap<
  object,
  Map<string, Promise<boolean>>
>();

function requestRestrictionCache(): Map<string, Promise<boolean>> | null {
  const ctx = getRequestContext();
  if (!ctx || typeof ctx !== "object") return null;
  let cache = _requestRestrictions.get(ctx);
  if (!cache) {
    cache = new Map();
    _requestRestrictions.set(ctx, cache);
  }
  return cache;
}

function forgetRequestRestrictions(): void {
  const ctx = getRequestContext();
  if (ctx && typeof ctx === "object") _requestRestrictions.delete(ctx);
}

/** The member's role in `orgId`, or null when not a member. Throws when unreadable. */
export async function readOrgMemberRole(
  orgId: string,
  email: string,
): Promise<OrgRole | null> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT role FROM org_members
          WHERE org_id = ? AND LOWER(email) = ?
            AND federation_removal_pending_at IS NULL
          LIMIT 1`,
    args: [orgId, email.toLowerCase()],
  });
  const role = rows[0]?.role;
  return role === "owner" || role === "admin" || role === "member"
    ? role
    : null;
}

async function resolvePolicyOrgId(
  email: string,
  orgId: string | null | undefined,
): Promise<string | null> {
  if (orgId !== undefined) return orgId?.trim() || null;
  const requestEmail = getRequestUserEmail()?.trim().toLowerCase();
  if (requestEmail === email) {
    const requestOrgId = getRequestOrgId();
    if (requestOrgId) return requestOrgId;
  }
  const { resolveOrgIdForEmail } = await import("../org/context.js");
  return resolveOrgIdForEmail(email);
}

/**
 * True when `email`'s organization restricts personal provider keys and
 * `email` is not one of its owners or admins. `orgId` undefined means "the
 * org this person is working in": the request's org when it is their request,
 * otherwise their active org. `null` means no organization, which is never
 * restricted. Pass `role` when the caller already read it.
 *
 * Throws when the policy, the org, or the role cannot be read. Callers treat
 * that as a failed credential lookup, never as "not restricted".
 */
export async function isPersonalProviderKeyUseRestricted(input: {
  email: string;
  orgId?: string | null;
  role?: string | null;
}): Promise<boolean> {
  const email = input.email.trim().toLowerCase();
  if (!email) return false;
  const orgId = await resolvePolicyOrgId(email, input.orgId);
  if (!orgId) return false;

  const cache = requestRestrictionCache();
  const cacheKey = `${email}\u0000${orgId}`;
  const cached = cache?.get(cacheKey);
  if (cached) return cached;

  const pending = (async () => {
    const policy = await readPersonalProviderKeyPolicy(orgId);
    if (!policy.restricted) return false;
    const role =
      input.role !== undefined
        ? input.role
        : await readOrgMemberRole(orgId, email);
    return role !== "owner" && role !== "admin";
  })();
  if (cache) {
    cache.set(cacheKey, pending);
    // A failed read must be retried, not remembered.
    pending.catch(() => cache.delete(cacheKey));
  }
  return pending;
}

/**
 * Write-path check for saving a personal provider key. Returns the refusal
 * message, or null when the save may proceed.
 */
export async function personalProviderKeyWriteDenial(input: {
  key: string;
  email: string;
  orgId?: string | null;
  role?: string | null;
}): Promise<string | null> {
  if (!isPersonalProviderPolicyKey(input.key)) return null;
  return (await isPersonalProviderKeyUseRestricted(input))
    ? PERSONAL_PROVIDER_KEYS_RESTRICTED_MESSAGE
    : null;
}

/**
 * `personalProviderKeyWriteDenial` for a route saving `key` at user scope for
 * `email`, using the request's org and role. An unreadable org context throws
 * rather than letting the save through.
 */
export async function resolvePersonalProviderKeySaveDenial(
  event: H3Event,
  email: string,
  key: string,
): Promise<string | null> {
  if (!isPersonalProviderPolicyKey(key)) return null;
  const { getOrgContext } = await import("../org/context.js");
  const ctx = await getOrgContext(event);
  return personalProviderKeyWriteDenial({
    key,
    email,
    orgId: ctx.orgId ?? null,
    role: ctx.role ?? null,
  });
}
