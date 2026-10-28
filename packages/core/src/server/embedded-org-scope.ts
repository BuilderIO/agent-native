import type { H3Event } from "h3";

import type { OrgContext } from "../org/types.js";
import type { AuthSession } from "./auth.js";
import { SessionResolutionLookupError } from "./session-resolution-errors.js";

interface EmbeddedHostScope {
  event: H3Event;
  email: string;
  orgId: string | undefined;
  orgRole: string | undefined;
  context: OrgContext;
}

// A configured host resolver is not proof that it supplied this request's
// identity. Bind its assertion to the returned session and request instead.
const scopes = new WeakMap<AuthSession, EmbeddedHostScope>();

export function bindEmbeddedHostOrgScope(
  event: H3Event,
  session: AuthSession,
  explicitPersonal: boolean,
): void {
  if (!session.orgId && !explicitPersonal) return;
  const role = session.orgId ? (session.orgRole ?? null) : null;
  if (
    role !== null &&
    role !== "owner" &&
    role !== "admin" &&
    role !== "member"
  ) {
    throw new SessionResolutionLookupError(
      new Error("Unsupported embedded organization role"),
    );
  }
  scopes.set(session, {
    event,
    email: session.email,
    orgId: session.orgId,
    orgRole: session.orgRole,
    context: {
      email: session.email,
      orgId: session.orgId ?? null,
      orgName: null,
      role,
    },
  });
}

export function getEmbeddedHostOrgScope(
  event: H3Event,
  session: AuthSession,
): OrgContext | undefined {
  const scope = scopes.get(session);
  if (
    !scope ||
    scope.event !== event ||
    scope.email !== session.email ||
    scope.orgId !== session.orgId ||
    scope.orgRole !== session.orgRole
  )
    return undefined;
  return { ...scope.context };
}

export function preserveEmbeddedHostOrgScope(
  event: H3Event,
  source: AuthSession,
  normalized: AuthSession,
): void {
  if (!getEmbeddedHostOrgScope(event, source)) return;
  if (
    source.email !== normalized.email ||
    source.orgId !== normalized.orgId ||
    source.orgRole !== normalized.orgRole
  )
    return;
  const scope = scopes.get(source);
  if (scope) scopes.set(normalized, scope);
}
