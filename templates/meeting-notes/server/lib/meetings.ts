import { desc, sql } from "drizzle-orm";
import { orgMembers } from "@agent-native/core/org";
import { getDb } from "../db/index.js";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { readAppState } from "@agent-native/core/application-state";

export function getCurrentOwnerEmail(): string {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return email;
}

/**
 * Resolve the caller's active organization id.
 *
 * Resolution: returns the most recent `org_members` row for the request
 * email. If the user has no membership, returns null -- callers MUST handle
 * the null case (either fall back to per-user filtering, or surface a
 * "no active org" error). NEVER falls back to "any org in the DB" -- that
 * silently joined brand-new users into another tenant's data.
 */
export async function getActiveOrganizationId(): Promise<string | null> {
  const email = getRequestUserEmail();
  if (!email) return null;

  try {
    const [row] = await getDb()
      .select({ id: orgMembers.orgId })
      .from(orgMembers)
      .where(sql`lower(${orgMembers.email}) = ${email.toLowerCase()}`)
      .orderBy(desc(orgMembers.joinedAt))
      .limit(1);
    if (row?.id) return row.id;
  } catch {
    // fall through -- table may not exist yet on first boot
  }

  return null;
}

/**
 * Like `getActiveOrganizationId` but throws if there's no active org.
 * Use this for write actions where data MUST be tenanted (create-template,
 * create-meeting). The thrown error tells the user to create or join an org
 * first instead of silently planting data in someone else's tenant.
 */
export async function requireActiveOrganizationId(): Promise<string> {
  const id = await getActiveOrganizationId();
  if (!id) {
    throw new Error(
      "No active organization. Create or join an organization before creating tenant-scoped resources.",
    );
  }
  return id;
}

export function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}
