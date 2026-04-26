import { desc } from "drizzle-orm";
import { getDb, getDbExec } from "../db/index.js";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { readAppState } from "@agent-native/core/application-state";
import { isPostgres } from "@agent-native/core/db";

export function getCurrentOwnerEmail(): string {
  return getRequestUserEmail() || "local@localhost";
}

/**
 * Resolve the caller's active organization id.
 *
 * Resolution order:
 *   1. The caller's most recent `org_members` row for their request email.
 *   2. Any org in the DB (dev / solo fallback).
 */
export async function getActiveOrganizationId(): Promise<string | null> {
  const email = getRequestUserEmail();
  const exec = getDbExec();

  if (email) {
    try {
      const ph = isPostgres() ? "$1" : "?";
      const res = await exec.execute({
        sql: `SELECT org_id AS id FROM org_members WHERE LOWER(email) = ${ph} ORDER BY joined_at DESC LIMIT 1`,
        args: [email.toLowerCase()],
      });
      const row = (res.rows as Array<{ id?: string }>)[0];
      if (row?.id) return row.id;
    } catch {
      // fall through
    }
  }

  try {
    const res = await exec.execute(
      `SELECT id FROM organizations ORDER BY created_at DESC LIMIT 1`,
    );
    const row = (res.rows as Array<{ id?: string }>)[0];
    if (row?.id) return row.id;
  } catch {
    // fall through
  }

  return null;
}

/**
 * Like `getActiveOrganizationId` but throws if there's no active org.
 */
export async function requireActiveOrganizationId(): Promise<string> {
  const id = await getActiveOrganizationId();
  if (!id) throw new Error("No active organization");
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
