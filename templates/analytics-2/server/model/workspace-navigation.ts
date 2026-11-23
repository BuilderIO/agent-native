import { alias, and, eq, isNull, or, sql } from "@agent-native/core/db/schema";
import { organizations, orgMembers } from "@agent-native/core/org";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";
import { ensureAnalyticsDatabase } from "./database.js";
import type { WorkspaceScope } from "./scope.js";

export const workspaceNavigationSchema = z.object({
  library: z.boolean(),
  workspaces: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      memberCount: z.number().int().nonnegative(),
    }),
  ),
});

export async function readWorkspaceNavigation({
  ownerEmail,
  orgId,
}: WorkspaceScope) {
  const db = getDb();
  const members = alias(orgMembers, "active_members");
  const memberCount = db
    .select({ count: sql<number>`count(*)::int` })
    .from(members)
    .where(
      and(
        eq(members.orgId, organizations.id),
        isNull(members.federationRemovalPendingAt),
      ),
    );
  const statuses = schema.statuses;
  const [memberships, libraryStatuses] = await Promise.all([
    db
      .select({
        id: organizations.id,
        name: organizations.name,
        role: orgMembers.role,
        memberCount: sql<number>`(${memberCount})`,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(
        and(
          eq(orgMembers.email, ownerEmail),
          isNull(orgMembers.federationRemovalPendingAt),
        ),
      ),
    ensureAnalyticsDatabase().then(() =>
      db
        .select({ id: statuses.id })
        .from(statuses)
        .where(
          and(
            eq(statuses.orgId, orgId),
            or(eq(statuses.inLibrary, true), eq(statuses.endorsed, true)),
          ),
        )
        .limit(1),
    ),
  ]);
  return {
    library: libraryStatuses.length > 0,
    workspaces: memberships.map((item) => ({
      ...item,
      role: item.role === "owner" || item.role === "admin" ? "Admin" : "Member",
    })),
  };
}
