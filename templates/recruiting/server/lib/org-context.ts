import type { H3Event, EventHandler } from "h3";
import { defineEventHandler } from "h3";
import { getSession } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { withOrgContext as withOrgALS } from "./greenhouse-api.js";

export interface OrgContext {
  email: string;
  orgId: string | null;
  orgName: string | null;
  role: "owner" | "admin" | "member" | null;
}

/**
 * Resolve the current user's organization context from their session.
 * Uses the user's "active org" setting if they belong to multiple orgs.
 * Returns orgId: null when the user has no org (solo mode / dev mode).
 */
export async function getOrgContext(event: H3Event): Promise<OrgContext> {
  const session = await getSession(event);
  const email = session?.email ?? "local@localhost";

  if (email === "local@localhost") {
    return { email, orgId: null, orgName: null, role: null };
  }

  // Get all orgs this user belongs to
  const memberships = await db
    .select({
      orgId: schema.orgMembers.orgId,
      role: schema.orgMembers.role,
      orgName: schema.organizations.name,
    })
    .from(schema.orgMembers)
    .innerJoin(
      schema.organizations,
      eq(schema.orgMembers.orgId, schema.organizations.id),
    )
    .where(eq(schema.orgMembers.email, email));

  if (memberships.length === 0) {
    return { email, orgId: null, orgName: null, role: null };
  }

  // If user has multiple orgs, check their active org preference
  if (memberships.length > 1) {
    const activeOrgSetting = (await getUserSetting(email, "active-org-id")) as {
      orgId: string;
    } | null;
    if (activeOrgSetting?.orgId) {
      const active = memberships.find(
        (m) => m.orgId === activeOrgSetting.orgId,
      );
      if (active) {
        return {
          email,
          orgId: active.orgId,
          orgName: active.orgName,
          role: active.role as OrgContext["role"],
        };
      }
    }
  }

  // Default to first org
  return {
    email,
    orgId: memberships[0].orgId,
    orgName: memberships[0].orgName,
    role: memberships[0].role as OrgContext["role"],
  };
}

/**
 * Wrap a route handler so it runs inside the user's org context.
 * The Greenhouse API client automatically uses the org-scoped API key.
 */
export function defineOrgHandler(
  handler: (event: H3Event) => Promise<any>,
): EventHandler {
  return defineEventHandler(async (event) => {
    const ctx = await getOrgContext(event);
    event.context.org = ctx;
    if (ctx.orgId) {
      return withOrgALS(ctx.orgId, () => handler(event));
    }
    return handler(event);
  });
}
