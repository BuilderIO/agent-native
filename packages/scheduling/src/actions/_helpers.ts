/**
 * Shared helpers for actions in this package.
 */
import { and, eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";

export function currentUserEmail(): string {
  const email = getSchedulingContext().getCurrentUserEmail();
  if (!email) throw new Error("Not authenticated");
  return email;
}

export function currentUserEmailOrNull(): string | null {
  return getSchedulingContext().getCurrentUserEmail() ?? null;
}

export function currentOrgId(): string | undefined {
  return getSchedulingContext().getCurrentOrgId?.();
}

export async function assertTeamAdmin(teamId: string): Promise<void> {
  const { getDb, schema } = getSchedulingContext();
  const email = currentUserEmail();
  const rows = await getDb()
    .select({ role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userEmail, email),
      ),
    )
    .limit(1);
  const role = rows[0]?.role;
  if (role !== "owner" && role !== "admin") {
    throw new Error("Forbidden: team owner or admin required");
  }
}

/**
 * Verify the current user is a member of the team (any role). Read-only
 * team resource listings should gate on this so that team IDs cannot be
 * enumerated by guessing. Throws "Not authenticated" if there is no
 * current user, and "Forbidden" if the user is not a member.
 */
export async function assertTeamMember(teamId: string): Promise<void> {
  const { getDb, schema } = getSchedulingContext();
  const email = currentUserEmail();
  const rows = await getDb()
    .select({ role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userEmail, email),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new Error("Forbidden: team member required");
  }
}
