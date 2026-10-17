import type { H3Event } from "h3";

import {
  getActiveOrgSettingForEvent,
  getOrgContext,
  listOrgMembershipsForEvent,
} from "../org/context.js";

export interface McpOrgOption {
  id: string;
  name: string;
  domain: string | null;
}

export interface McpOrgChoices {
  organizations: McpOrgOption[];
  defaultOrganizationId: string | undefined;
}

/**
 * The organizations an MCP connection (OAuth consent or device approval) can
 * be bound to, and the one to preselect. For an account with no memberships,
 * this resolves (and may create) its domain or default org the same way any
 * other page load would, so the connection isn't scoped to no org for its
 * whole life.
 *
 * `requestedOrganizationId`: `undefined` means no explicit pick (use the
 * caller's stored/session org), `null` means the OAuth caller explicitly
 * asked for personal scope, and a string is an explicit org pick to resolve
 * membership for.
 */
export async function resolveMcpOrgChoices(
  event: H3Event,
  session: { email: string; orgId?: string | null },
  requestedOrganizationId?: string | null,
): Promise<McpOrgChoices> {
  const activeOrgSetting = await getActiveOrgSettingForEvent(
    event,
    session.email,
  );
  let memberships = await listOrgMembershipsForEvent(
    event,
    session.email,
    requestedOrganizationId !== undefined
      ? requestedOrganizationId
      : (activeOrgSetting?.orgId ?? session.orgId ?? null),
  );
  // A token issued with no org stays org-less for its whole life, even after
  // the app later creates the org, so resolve an account without one to its
  // domain or default org before offering the choice.
  const ensuredOrgId =
    memberships?.length === 0 ? (await getOrgContext(event)).orgId : null;
  if (ensuredOrgId) {
    memberships = await listOrgMembershipsForEvent(
      event,
      session.email,
      ensuredOrgId,
    );
  }
  const organizations =
    memberships?.map((membership) => ({
      id: membership.orgId,
      name: membership.orgName,
      domain: membership.allowedDomain,
    })) ??
    (session.orgId
      ? [{ id: session.orgId, name: "Organization", domain: null }]
      : []);
  const defaultOrganizationId =
    [activeOrgSetting?.orgId, ensuredOrgId, session.orgId].find(
      (id) => id && organizations.some((org) => org.id === id),
    ) ?? organizations[0]?.id;
  return { organizations, defaultOrganizationId };
}
