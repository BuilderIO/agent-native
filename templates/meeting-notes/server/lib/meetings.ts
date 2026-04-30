import { desc } from "drizzle-orm";
import { getDb, getDbExec } from "../db/index.js";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { readAppState } from "@agent-native/core/application-state";
import { isPostgres } from "@agent-native/core/db";

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
  const exec = getDbExec();

  try {
    const ph = isPostgres() ? "$1" : "?";
    const res = await exec.execute({
      sql: `SELECT org_id AS id FROM org_members WHERE LOWER(email) = ${ph} ORDER BY joined_at DESC LIMIT 1`,
      args: [email.toLowerCase()],
    });
    const row = (res.rows as Array<{ id?: string }>)[0];
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
