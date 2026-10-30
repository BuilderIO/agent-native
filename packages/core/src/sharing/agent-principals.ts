/**
 * Org service principals (`svc-<name>@service.<orgId>`) as share recipients.
 *
 * A service principal authenticates as its synthetic email, so an ordinary
 * `user` share to that address is enforced by `accessFilter` / `resolveAccess`
 * with no new principal type. These helpers decide which principals may
 * receive one and how the share surface names them.
 *
 * Agents that connect over MCP or OAuth sign in as the person who connected
 * them and already carry that person's access, so they are deliberately not
 * listed here: a grant to them would control nothing.
 */
import { getDbExec } from "../db/client.js";
import {
  listOrgServiceTokens,
  serviceIdentityEmail,
} from "../mcp/connect-store.js";
import { isMissingOrganizationTableError } from "../org/membership.js";
import { parseServiceIdentityEmail } from "../org/service-identity.js";
import { listServicePrincipalPolicies } from "../org/service-principal-policy.js";

export interface ShareableAgent {
  email: string;
  name: string;
}

/**
 * Principals that can act right now: at least one live token, and not
 * retired. A suspended principal stays listed so a suspension does not
 * silently drop it from the people a resource can be shared with.
 */
export async function listShareableAgents(
  orgId: string,
): Promise<ShareableAgent[]> {
  const [tokens, policies] = await Promise.all([
    listOrgServiceTokens(orgId),
    listServicePrincipalPolicies(orgId),
  ]);
  const retired = new Set(
    policies
      .filter((policy) => policy.lifecycle === "retired")
      .map((policy) => policy.serviceName),
  );
  const names = new Set<string>();
  for (const token of tokens) {
    if (token.revokedAt != null || !token.serviceName) continue;
    if (retired.has(token.serviceName)) continue;
    names.add(token.serviceName);
  }
  return [...names].sort().map((name) => ({
    email: serviceIdentityEmail(name, orgId),
    name,
  }));
}

export async function isShareableAgent(
  orgId: string,
  email: string,
): Promise<boolean> {
  if (orgAgentName(email, orgId) === null) return false;
  const agents = await listShareableAgents(orgId);
  const normalized = email.trim().toLowerCase();
  return agents.some((agent) => agent.email.toLowerCase() === normalized);
}

/**
 * The service name when `email` is an agent of `orgId`, or null. Only the
 * resource's own org can have agents on it; anyone else whose address merely
 * looks like `svc-<name>@service.<domain>` is a person and is emailed as one.
 */
export function orgAgentName(
  email: string,
  orgId: string | null | undefined,
): string | null {
  const parsed = parseServiceIdentityEmail(email);
  // User principals are stored lowercased, org ids are not.
  if (!parsed || !orgId || parsed.orgId.toLowerCase() !== orgId.toLowerCase()) {
    return null;
  }
  return parsed.serviceName;
}

/**
 * Whether `email` is the service identity of any existing org. Notifications
 * check this rather than only the resource's org, so an agent shared on a
 * resource with no org is never emailed either, while a person whose address
 * merely looks like one (`svc-bob@service.example.com`) still is.
 */
export async function isAnyOrgAgent(email: string): Promise<boolean> {
  const parsed = parseServiceIdentityEmail(email);
  if (!parsed) return false;
  try {
    // raw-sql-ok: a static statement; the org id is a bound argument.
    const { rows } = await getDbExec().execute({
      sql: "SELECT 1 FROM organizations WHERE LOWER(id) = LOWER(?) LIMIT 1",
      args: [parsed.orgId],
    });
    return rows.length > 0;
  } catch (error) {
    if (isMissingOrganizationTableError(error)) return false;
    throw error;
  }
}
