import { and, desc, eq } from "drizzle-orm";
import type { H3Event } from "h3";
import { getDb, getDbExec, schema } from "../db/index.js";
import { getSession } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { readAppState } from "@agent-native/core/application-state";

export function getCurrentOwnerEmail(): string {
  return getRequestUserEmail() || "local@localhost";
}

export async function getEventOwnerEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  return session?.email ?? "local@localhost";
}

/**
 * Resolve the caller's active organization id.
 *
 * Order of resolution:
 *   1. The current better-auth session's `activeOrganizationId` (when an
 *      H3Event is available — e.g. inside an HTTP action).
 *   2. A single org that the caller belongs to (convenience for dev /
 *      solo-mode where there's no session to read).
 *   3. The most-recently-created organization in the DB (fallback for the
 *      agent CLI, which doesn't have a request context).
 *   4. The legacy `current-workspace` application-state key (kept so the
 *      old UI's writes continue to work during the workspace → org transition).
 *
 * Returns `null` when no org exists at all.
 */
export async function getActiveOrganizationId(
  event?: H3Event,
): Promise<string | null> {
  if (event) {
    try {
      const session = await getSession(event);
      const orgId = (session as any)?.orgId ?? null;
      if (orgId) return orgId;
    } catch {
      // fall through
    }
  }

  const email = getRequestUserEmail();
  const exec = getDbExec();

  if (email) {
    try {
      const res = await exec.execute({
        sql: `SELECT m.organization_id AS id FROM member m JOIN "user" u ON u.id = m.user_id WHERE u.email = $1 ORDER BY m.created_at DESC LIMIT 1`,
        args: [email],
      });
      const row = (res.rows as Array<{ id?: string }>)[0];
      if (row?.id) return row.id;
    } catch {
      // SQLite — try again without the quoted identifier
      try {
        const res = await exec.execute({
          sql: `SELECT m.organization_id AS id FROM member m JOIN user u ON u.id = m.user_id WHERE u.email = ? ORDER BY m.created_at DESC LIMIT 1`,
          args: [email],
        });
        const row = (res.rows as Array<{ id?: string }>)[0];
        if (row?.id) return row.id;
      } catch {
        // fall through
      }
    }
  }

  try {
    const res = await exec.execute(
      `SELECT id FROM organization ORDER BY created_at DESC LIMIT 1`,
    );
    const row = (res.rows as Array<{ id?: string }>)[0];
    if (row?.id) return row.id;
  } catch {
    // fall through
  }

  // Legacy fallback: the old workspace UI wrote `current-workspace` to app
  // state. Keep reading it so in-flight sessions don't lose their context
  // between the workspace → org deploy.
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
