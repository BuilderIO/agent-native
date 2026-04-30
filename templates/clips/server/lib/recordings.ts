import { and, desc, eq } from "drizzle-orm";
import type { H3Event } from "h3";
import { getDb, getDbExec, schema } from "../db/index.js";
import { getSession } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { readAppState } from "@agent-native/core/application-state";
import { isPostgres } from "@agent-native/core/db";

export function getCurrentOwnerEmail(): string {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return email;
}

export async function getEventOwnerEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}

export type OrganizationAccessRole = "owner" | "admin" | "member";

const ORG_ROLE_RANK: Record<OrganizationAccessRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

function normalizeOrganizationRole(
  role: string | null | undefined,
): OrganizationAccessRole {
  if (role === "owner" || role === "admin") return role;
  return "member";
}

function organizationRoleAllowed(
  actual: OrganizationAccessRole,
  allowed: OrganizationAccessRole[],
): boolean {
  const required = Math.min(...allowed.map((role) => ORG_ROLE_RANK[role]));
  return ORG_ROLE_RANK[actual] >= required;
}

export async function getOrganizationRoleForEmail(
  organizationId: string,
  email: string,
): Promise<OrganizationAccessRole | null> {
  const exec = getDbExec();
  const pg = isPostgres();
  const lowerEmail = email.toLowerCase();

  try {
    const res = await exec.execute({
      sql: pg
        ? `SELECT role FROM org_members WHERE org_id = $1 AND LOWER(email) = $2 LIMIT 1`
        : `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [organizationId, lowerEmail],
    });
    const row = (res.rows as Array<{ role?: string }>)[0];
    if (row?.role) return normalizeOrganizationRole(row.role);
  } catch {
    // Older DBs may not have the framework org_members table yet. Fall back
    // to better-auth's member table below.
  }

  try {
    const res = await exec.execute({
      sql: pg
        ? `SELECT m.role FROM member m JOIN "user" u ON u.id = m.user_id WHERE m.organization_id = $1 AND LOWER(u.email) = $2 LIMIT 1`
        : `SELECT m.role FROM member m JOIN user u ON u.id = m.user_id WHERE m.organization_id = ? AND LOWER(u.email) = ? LIMIT 1`,
      args: [organizationId, lowerEmail],
    });
    const row = (res.rows as Array<{ role?: string }>)[0];
    if (row?.role) return normalizeOrganizationRole(row.role);
  } catch {
    // No better-auth membership table yet.
  }

  return null;
}

export async function requireOrganizationAccess(
  organizationId?: string | null,
  allowedRoles: OrganizationAccessRole[] = ["member"],
  event?: H3Event,
): Promise<{
  organizationId: string;
  email: string;
  role: OrganizationAccessRole;
}> {
  const resolvedOrganizationId =
    organizationId || (await requireActiveOrganizationId(event));
  const email = getCurrentOwnerEmail();
  const role = await getOrganizationRoleForEmail(resolvedOrganizationId, email);
  if (!role || !organizationRoleAllowed(role, allowedRoles)) {
    throw new Error("Organization not found or access denied");
  }
  return { organizationId: resolvedOrganizationId, email, role };
}

/**
 * Resolve the caller's active organization id.
 *
 * Resolution order:
 *   1. When an H3Event is available: the framework `getOrgContext()` resolves
 *      the active org via `active-org-id` user-setting, with membership
 *      cross-checked against `org_members`.
 *   2. CLI / no-event: the caller's most recent `org_members` row for their
 *      request email.
 *   3. Any org in the DB (dev / solo fallback).
 *   4. Legacy `current-workspace` app-state key or latest `workspaces` row
 *      (back-compat for in-flight sessions spanning the migration).
 */
export async function getActiveOrganizationId(
  event?: H3Event,
): Promise<string | null> {
  if (event) {
    try {
      const { getOrgContext } = await import("@agent-native/core/org");
      const ctx = await getOrgContext(event);
      if (ctx?.orgId) return ctx.orgId;
    } catch {
      // framework helper not available in this context — fall through
    }
  }

  // Request-context ALS stores the orgId resolved by the framework middleware
  // (e.g. from better-auth session). This covers action calls where the H3
  // event isn't forwarded.
  const ctxOrgId = getRequestOrgId();
  if (ctxOrgId) return ctxOrgId;

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

  // Legacy fallback: old workspace UI's `current-workspace` app-state key,
  // and the deprecated `workspaces` table.
  try {
    const legacy = (await readAppState("current-workspace")) as {
      id?: string;
    } | null;
    if (legacy?.id) return legacy.id;
  } catch {
    // fall through
  }

  try {
    const [row] = await getDb()
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .orderBy(desc(schema.workspaces.createdAt))
      .limit(1);
    if (row?.id) return row.id;
  } catch {
    // fall through
  }

  return null;
}

/**
 * Like `getActiveOrganizationId` but throws if there's no active org — use
 * in mutations where a null org id should never reach the SQL layer.
 */
export async function requireActiveOrganizationId(
  event?: H3Event,
): Promise<string> {
  const id = await getActiveOrganizationId(event);
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

export interface RecordingRow {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  animatedThumbnailUrl: string | null;
  durationMs: number;
  videoUrl: string | null;
  status: "uploading" | "processing" | "ready" | "failed";
  visibility: "private" | "org" | "public";
  ownerEmail: string;
  folderId: string | null;
  spaceIds: string[];
  password: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  trashedAt: string | null;
  hasAudio: boolean;
  hasCamera: boolean;
  width: number;
  height: number;
  defaultSpeed: string;
  animatedThumbnailEnabled: boolean;
  enableComments: boolean;
  enableReactions: boolean;
  enableDownloads: boolean;
}

export function parseSpaceIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function stringifySpaceIds(ids: string[] | undefined): string {
  return JSON.stringify(ids ?? []);
}

export async function getRecordingOrThrow(id: string): Promise<RecordingRow> {
  const db = getDb();
  const ownerEmail = getCurrentOwnerEmail();
  const [row] = await db
    .select()
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, id),
        // visibility check happens at the action layer via the framework
        // sharing helpers; this is just the ownership-or-visible fallback.
        eq(schema.recordings.ownerEmail, ownerEmail),
      ),
    );
  if (!row) throw new Error(`Recording not found: ${id}`);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    thumbnailUrl: row.thumbnailUrl,
    animatedThumbnailUrl: row.animatedThumbnailUrl,
    durationMs: row.durationMs,
    videoUrl: row.videoUrl,
    status: row.status as any,
    visibility: row.visibility as any,
    ownerEmail: row.ownerEmail,
    folderId: row.folderId,
    spaceIds: parseSpaceIds(row.spaceIds),
    password: row.password,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    trashedAt: row.trashedAt,
    hasAudio: Boolean(row.hasAudio),
    hasCamera: Boolean(row.hasCamera),
    width: row.width,
    height: row.height,
    defaultSpeed: row.defaultSpeed,
    animatedThumbnailEnabled: Boolean(row.animatedThumbnailEnabled),
    enableComments: Boolean(row.enableComments),
    enableReactions: Boolean(row.enableReactions),
    enableDownloads: Boolean(row.enableDownloads),
  };
}

/**
 * Count a view if it meets the view-counting rule:
 *   ≥ 5 seconds watched, OR ≥ 75% of video, OR scrubbed to end.
 */
export function shouldCountView(
  totalWatchMs: number,
  completedPct: number,
  scrubbedToEnd: boolean,
): boolean {
  return totalWatchMs >= 5000 || completedPct >= 75 || scrubbedToEnd;
}
