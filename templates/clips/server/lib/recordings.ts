import { and, eq } from "drizzle-orm";
import type { H3Event } from "h3";
import { getDb, schema } from "../db/index.js";
import { getSession } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

export function getCurrentOwnerEmail(): string {
  return getRequestUserEmail() || "local@localhost";
}

export async function getEventOwnerEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  return session?.email ?? "local@localhost";
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
