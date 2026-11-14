/**
 * Connection credential profiles: the locked namespace helper plus the
 * fail-closed reader for credential refs explicitly marked as belonging to a
 * personal connection's own vault namespace.
 *
 * The marker is deliberately separate from the legacy `scope` field. A ref
 * without a marker keeps the historical multi-scope waterfall exactly; a ref
 * with `ref: "connection"` may only be answered from that single connection's
 * namespace and never falls back to a user/global/legacy value. Any other
 * marker value, or the marker combined with a non-user scope, is malformed and
 * must close before a value is read.
 *
 * The namespace is an internal storage identity, not an authentication
 * mechanism: knowing `connv1:...` is not a grant. Every marked read still
 * re-derives the actor from the strict request context and re-checks the
 * resolved connection row before touching the encrypted vault.
 */

import { createHash } from "node:crypto";

import { readAppSecret } from "../secrets/storage.js";
import {
  isPersonalProviderKeyUseRestricted,
  isPersonalProviderPolicyKey,
} from "../server/personal-provider-key-policy.js";
import {
  runWithRequestContext,
  type RequestContext,
} from "../server/request-context.js";

/** The only valid value of the optional `ref` field on a credential ref. */
export const CONNECTION_CREDENTIAL_REF_MARKER = "connection";

/** Prefix of the internal vault namespace derived from a connection row. */
export const CONNECTION_CREDENTIAL_SCOPE_PREFIX = "connv1:";

/**
 * Stable storage namespace for one personal connection's secret values.
 *
 * The namespace is derived from the owner email, org, and connection id so a
 * caller can never supply it. Values written under it live beside the generic
 * native `user` scope (whose scope id is the email) but are never reachable
 * through it.
 */
export function connectionCredentialScopeId(connection: {
  id: string;
  ownerEmail: string;
  orgId: string | null;
}): string {
  const ownerEmail = connection.ownerEmail.trim().toLowerCase();
  const payload = JSON.stringify([ownerEmail, connection.orgId, connection.id]);
  const digest = createHash("sha256").update(payload).digest("hex");
  return `${CONNECTION_CREDENTIAL_SCOPE_PREFIX}${digest}`;
}

export type ConnectionCredentialMarkerState =
  | "legacy"
  | "connection"
  | "invalid";

/**
 * Classify the optional `ref` field from a single snapshot read.
 *
 * `undefined` (or an absent own property) preserves the legacy path exactly; a
 * missing/foreign value is malformed. The input is treated as opaque so a
 * malformed stored shape or a throwing accessor closes as `invalid` instead of
 * escaping as a raw engine error.
 */
export function connectionCredentialMarkerState(
  ref: unknown,
): ConnectionCredentialMarkerState {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return "invalid";
  if (!Object.prototype.hasOwnProperty.call(ref, "ref")) return "legacy";
  let marker: unknown;
  try {
    marker = (ref as { ref?: unknown }).ref;
  } catch {
    return "invalid";
  }
  if (marker === undefined) return "legacy";
  return marker === CONNECTION_CREDENTIAL_REF_MARKER ? "connection" : "invalid";
}

export interface MarkedConnectionCredentialRefShape {
  key: string;
  scope?: string;
  provider?: string;
  ref?: unknown;
}

/** The subset of a resolved connection row a marked read is allowed to trust. */
export interface MarkedConnectionCredentialConnection {
  id: string;
  provider: string;
  ownerEmail: string;
  orgId: string | null;
  config?: Record<string, unknown> | null;
  appAccess?: { available?: boolean } | null;
}

export type MarkedConnectionCredentialRead =
  | {
      status: "resolved";
      key: string;
      value: string;
      namespace: string;
    }
  | { status: "invalid_ref"; reason: string }
  | { status: "missing_context"; reason: string }
  | { status: "not_available"; reason: string }
  | { status: "missing_secret"; reason: string }
  | { status: "error"; reason: string };

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

interface ConnectionCredentialRefSnapshot {
  key: string;
  scope?: string;
  provider?: string;
}

/**
 * Read the reference fields once and validate their runtime types. A stored ref
 * passes through JSON, so this normally sees strings; a constructed in-memory
 * object can carry the wrong type or a throwing accessor, and must close with a
 * static reason rather than a `TypeError`.
 */
function snapshotConnectionCredentialRef(
  ref: unknown,
):
  | { ok: true; snapshot: ConnectionCredentialRefSnapshot }
  | { ok: false; reason: string } {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
    return {
      ok: false,
      reason: "The connection credential reference is not a valid object.",
    };
  }
  let key: unknown;
  let scope: unknown;
  let provider: unknown;
  try {
    const record = ref as Record<string, unknown>;
    key = record.key;
    scope = record.scope;
    provider = record.provider;
  } catch {
    return {
      ok: false,
      reason: "The connection credential reference could not be read.",
    };
  }
  if (typeof key !== "string" || key.trim().length === 0) {
    return {
      ok: false,
      reason: "The connection credential reference has no valid key.",
    };
  }
  if (scope !== undefined && typeof scope !== "string") {
    return {
      ok: false,
      reason: "The connection credential reference has a malformed scope.",
    };
  }
  if (provider !== undefined && typeof provider !== "string") {
    return {
      ok: false,
      reason: "The connection credential reference has a malformed provider.",
    };
  }
  return {
    ok: true,
    snapshot: {
      key,
      ...(scope !== undefined ? { scope } : {}),
      ...(provider !== undefined ? { provider } : {}),
    },
  };
}

function snapshotConnectionRow(connection: unknown): {
  id: string;
  provider: string;
  ownerEmail: string;
  orgId: string | null;
  workspaceConnectionScope: unknown;
  appAvailable: unknown;
} | null {
  if (
    !connection ||
    typeof connection !== "object" ||
    Array.isArray(connection)
  ) {
    return null;
  }
  try {
    const record = connection as Record<string, unknown>;
    const id = record.id;
    const provider = record.provider;
    const ownerEmail = record.ownerEmail;
    const orgId = record.orgId;
    if (
      typeof id !== "string" ||
      typeof provider !== "string" ||
      typeof ownerEmail !== "string" ||
      (orgId !== null && typeof orgId !== "string")
    ) {
      return null;
    }
    const config = record.config;
    const workspaceConnectionScope =
      config && typeof config === "object" && !Array.isArray(config)
        ? (config as Record<string, unknown>).workspaceConnectionScope
        : undefined;
    const appAccess = record.appAccess;
    const appAvailable =
      appAccess && typeof appAccess === "object" && !Array.isArray(appAccess)
        ? (appAccess as { available?: unknown }).available
        : undefined;
    return {
      id,
      provider,
      ownerEmail,
      orgId,
      workspaceConnectionScope,
      appAvailable,
    };
  } catch {
    // coercion-ok: a throwing getter is a malformed row; callers refuse null rows
    return null;
  }
}

/**
 * Read one explicitly-marked connection credential.
 *
 * Order of checks matters and every one of them closes:
 *   1. marker/scope/provider well-formedness (no vault access on failure)
 *   2. strict request identity — the captured `getRequestContext()`, never the
 *      ambient `AGENT_USER_EMAIL` / `AGENT_ORG_ID` fallback
 *   3. resolved row ownership, org, personal scope, and native app access
 *   4. native personal-provider read policy on the canonical logical key
 *   5. exactly one encrypted-vault read in the connection's namespace
 *
 * The caller is responsible for matching `ref.key` to the requested key (the
 * two call sites do this with `credentialKeyMatches` / an exact key check);
 * this reader answers the canonical key the marked ref names.
 *
 * `requestContext` is the genuine request context captured by the public entry
 * point before any caller-supplied identity override was applied. It is passed
 * explicitly so a nested override wrapper can never satisfy a marked read; an
 * absent context (including the ambient deploy identity) closes the read. The
 * policy and vault operations run under this captured context so a caller
 * override cannot change the native implicit-org lookup or the usage actor.
 */
export async function readMarkedConnectionCredential(input: {
  connection: MarkedConnectionCredentialConnection;
  provider: string;
  ref: MarkedConnectionCredentialRefShape;
  requestContext: RequestContext | undefined;
}): Promise<MarkedConnectionCredentialRead> {
  const marker = connectionCredentialMarkerState(input.ref);
  if (marker !== "connection") {
    return {
      status: "invalid_ref",
      reason:
        "The connection credential reference has an invalid marker and cannot be read.",
    };
  }
  const refResult = snapshotConnectionCredentialRef(input.ref);
  if (!refResult.ok) {
    return { status: "invalid_ref", reason: refResult.reason };
  }
  const ref = refResult.snapshot;

  const connection = snapshotConnectionRow(input.connection);
  if (!connection) {
    return {
      status: "not_available",
      reason:
        "The connection row is malformed, so its credential cannot be read.",
    };
  }

  if (ref.scope !== undefined && ref.scope !== "user") {
    return {
      status: "invalid_ref",
      reason:
        "A connection credential reference must be user-scoped and cannot be read.",
    };
  }
  const requestedProvider = normalized(input.provider);
  if (
    !requestedProvider ||
    (ref.provider !== undefined &&
      normalized(ref.provider) !== requestedProvider) ||
    requestedProvider !== normalized(connection.provider)
  ) {
    return {
      status: "invalid_ref",
      reason:
        "The connection credential reference does not match the connection provider.",
    };
  }
  if (connection.appAvailable !== true) {
    return {
      status: "not_available",
      reason:
        "The connection is not available to the requesting app, so its credential cannot be read.",
    };
  }

  const requestContext = input.requestContext;
  if (!requestContext) {
    return {
      status: "missing_context",
      reason:
        "A connection credential requires an authenticated request context.",
    };
  }
  const actorEmail = normalized(requestContext.userEmail);
  if (!actorEmail) {
    return {
      status: "missing_context",
      reason:
        "A connection credential requires an authenticated request identity.",
    };
  }
  if (requestContext.credentialScope === "org") {
    return {
      status: "not_available",
      reason:
        "A personal connection credential is unavailable in an organization-only context.",
    };
  }
  const rawOrgId = requestContext.orgId;
  if (rawOrgId !== undefined && typeof rawOrgId !== "string") {
    return {
      status: "missing_context",
      reason: "The request organization is malformed.",
    };
  }
  // Ownership compares the raw request org (missing stays `null`, an explicit
  // empty string is never silently treated as "no org").
  const ownershipOrgId = typeof rawOrgId === "string" ? rawOrgId.trim() : null;
  // The native personal-provider policy resolves "the org this person is
  // working in" when the request has no org, so pass `undefined` — never a
  // synthesized `null` that would mean "no organization, never restricted".
  const policyOrgId =
    typeof rawOrgId === "string" && rawOrgId.trim().length > 0
      ? rawOrgId.trim()
      : undefined;

  if (normalized(connection.ownerEmail) !== actorEmail) {
    return {
      status: "not_available",
      reason:
        "The connection belongs to another member and its credential cannot be read.",
    };
  }
  if (connection.orgId !== ownershipOrgId) {
    return {
      status: "not_available",
      reason:
        "The connection belongs to another organization and its credential cannot be read.",
    };
  }
  if (connection.workspaceConnectionScope !== "user") {
    return {
      status: "not_available",
      reason:
        "Only a personal connection exposes a connection-scoped credential.",
    };
  }

  const namespace = connectionCredentialScopeId({
    id: connection.id,
    ownerEmail: connection.ownerEmail,
    orgId: connection.orgId,
  });

  return await runWithRequestContext(requestContext, () =>
    readMarkedConnectionCredentialValue({
      refKey: ref.key,
      actorEmail,
      policyOrgId,
      namespace,
    }),
  );
}

async function readMarkedConnectionCredentialValue(input: {
  refKey: string;
  actorEmail: string;
  policyOrgId: string | undefined;
  namespace: string;
}): Promise<MarkedConnectionCredentialRead> {
  if (isPersonalProviderPolicyKey(input.refKey)) {
    try {
      const restricted = await isPersonalProviderKeyUseRestricted({
        email: input.actorEmail,
        ...(input.policyOrgId !== undefined
          ? { orgId: input.policyOrgId }
          : {}),
      });
      if (restricted) {
        return {
          status: "not_available",
          reason:
            "The organization restricts this member's personal provider keys.",
        };
      }
    } catch {
      return {
        status: "error",
        reason:
          "The personal provider key policy could not be read, so the credential was not returned.",
      };
    }
  }

  try {
    const secret = await readAppSecret({
      key: input.refKey,
      scope: "user",
      scopeId: input.namespace,
    });
    if (!secret?.value) {
      return {
        status: "missing_secret",
        reason:
          "The connection's vault namespace does not hold the referenced credential.",
      };
    }
    return {
      status: "resolved",
      key: input.refKey,
      value: secret.value,
      namespace: input.namespace,
    };
  } catch {
    return {
      status: "error",
      reason: "The connection vault read failed.",
    };
  }
}
