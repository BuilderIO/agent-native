/**
 * Implicit org membership for synthetic service-token identities.
 *
 * Org service tokens authenticate as `svc-<name>@service.<orgId>` and are
 * deliberately never inserted into `org_members` (see
 * `mcp/actions/service-token-access.ts`), so any template that authorizes by
 * looking up a physical membership row rejects them. The ownable/sharing layer
 * already admits them via the signed `org_id` claim; this closes the gap for
 * the role-lookup layer.
 *
 * Two constraints are load-bearing and must survive future edits:
 *
 * 1. The implicit role is always `member`, never admin or owner. Member-gated
 *    actions (create/read org data) work; admin-gated ones (invite/remove
 *    members, change roles, org settings, minting further service tokens) stay
 *    closed, so a leaked service token cannot escalate.
 * 2. `requestOrgId` must independently agree with the target org. The email
 *    alone is not proof: a human account registered under a `@service.<orgId>`
 *    address would otherwise mint itself membership. A signed-in user's request
 *    org id is membership-derived through `getOrgContext`, so a non-member
 *    cannot present the target org id, while a service token carries it in its
 *    signed `org_id` claim.
 */
import type { OrgRole } from "./types.js";

const SERVICE_IDENTITY_PATTERN = /^svc-([a-z0-9-]+)@service\.(.+)$/;

/**
 * Parse `svc-<name>@service.<orgId>` into its parts, or null when the address
 * is not a service identity. Counterpart to `serviceIdentityEmail()` in
 * `mcp/connect-store.ts`.
 */
export function parseServiceIdentityEmail(
  email: string | null | undefined,
): { serviceName: string; orgId: string } | null {
  const trimmed = email?.trim();
  if (!trimmed) return null;
  const match = SERVICE_IDENTITY_PATTERN.exec(trimmed.toLowerCase());
  if (!match) return null;
  const orgId = trimmed.slice(trimmed.length - match[2].length);
  if (!orgId) return null;
  return { serviceName: match[1], orgId };
}

/**
 * Resolve the implicit org role for a service-token caller, or null when the
 * caller is not a service identity acting for the org it was minted against.
 */
export function implicitServiceOrgRole(params: {
  email: string | null | undefined;
  orgId: string | null | undefined;
  requestOrgId: string | null | undefined;
}): OrgRole | null {
  const orgId = params.orgId?.trim();
  if (!orgId) return null;
  if (params.requestOrgId?.trim() !== orgId) return null;
  const parsed = parseServiceIdentityEmail(params.email);
  if (!parsed || parsed.orgId !== orgId) return null;
  return "member";
}
