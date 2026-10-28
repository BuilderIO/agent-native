import type { H3Event } from "h3";

import { isAnonymousWaitlistSessionEmail } from "../server/anonymous-identity.js";
import { getRequestContext } from "../server/request-context.js";

export interface McpPrincipal {
  userEmail: string;
  orgId: string | null;
}

export interface McpRequestPrincipal extends McpPrincipal {
  role: string | null;
}

export function normalizeMcpPrincipal(principal: {
  userEmail?: string | null;
  orgId?: string | null;
}): McpPrincipal | null {
  const userEmail = principal.userEmail?.trim().toLowerCase();
  if (
    !userEmail ||
    isAnonymousWaitlistSessionEmail(userEmail) ||
    getRequestContext()?.agentRunAnonymous === true
  ) {
    return null;
  }
  return {
    userEmail,
    orgId: principal.orgId?.trim() || null,
  };
}

export function principalFromRequestContext(): McpPrincipal | null {
  const context = getRequestContext();
  if (!context) return null;
  return normalizeMcpPrincipal({
    userEmail: context.userEmail,
    orgId: context.orgId,
  });
}

export async function resolveMcpPrincipalForEvent(
  event: H3Event,
): Promise<McpRequestPrincipal | null> {
  if (getRequestContext()?.agentRunAnonymous === true) return null;

  const { getSession } = await import("../server/auth.js");
  const session = await getSession(event);

  const normalized = normalizeMcpPrincipal({ userEmail: session?.email });
  if (!normalized) return null;

  const { getOrgContext } = await import("../org/context.js");
  const org = await getOrgContext(event);
  return { ...normalized, orgId: org.orgId, role: org.role };
}
