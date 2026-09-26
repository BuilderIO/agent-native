import { readAppState } from "@agent-native/core/application-state";
import {
  implicitServiceOrgRole,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { getSession } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { getUserSetting } from "@agent-native/core/settings";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { HTTPError, type H3Event } from "h3";

import {
  CLIPS_USER_PREFS_KEY,
  DEFAULT_CLIPS_RECORDING_VISIBILITY,
  type ClipsUserPrefs,
} from "../../shared/clips-ai-prefs.js";
import { getDb, schema } from "../db/index.js";

export function getCurrentOwnerEmail(): string {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return normalizeOwnerEmail(email);
}

export function normalizeOwnerEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function ownerEmailMatches(column: unknown, email: string) {
  return sql`lower(${column as any}) = ${normalizeOwnerEmail(email)}`;
}

export function sameOwnerEmail(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return normalizeOwnerEmail(a) === normalizeOwnerEmail(b);
}

export async function getEventOwnerContext(event: H3Event): Promise<{
  userEmail: string;
  orgId?: string;
  authUserId?: string;
}> {
  const session = await getSession(event);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  let orgId = session.orgId ?? null;
  if (!orgId) {
    try {
      const { getOrgContext } = await import("@agent-native/core/org");
      const ctx = await getOrgContext(event);
      orgId = ctx?.orgId ?? null;
    } catch {
      // Keep the auth context usable even if org resolution is unavailable.
    }
  }
  return {
    userEmail: session.email,
    orgId: orgId ?? undefined,
    ...(session.authUserId ? { authUserId: session.authUserId } : {}),
  };
}

export async function getEventOwnerEmail(event: H3Event): Promise<string> {
  return (await getEventOwnerContext(event)).userEmail;
}

export type OrganizationAccessRole = "owner" | "admin" | "member";

export type RecordingVisibility = "private" | "org" | "public";

export const DEFAULT_RECORDING_VISIBILITY: RecordingVisibility =
  DEFAULT_CLIPS_RECORDING_VISIBILITY;

export function isRecordingVisibility(
  value: unknown,
): value is RecordingVisibility {
  return value === "private" || value === "org" || value === "public";
}

export function resolveRecordingVisibility(
  explicit: RecordingVisibility | null | undefined,
  configured: unknown,
): RecordingVisibility {
  if (explicit) return explicit;
  return isRecordingVisibility(configured)
    ? configured
    : DEFAULT_RECORDING_VISIBILITY;
}

export async function getOrganizationDefaultVisibility(
  organizationId: string | null | undefined,
): Promise<RecordingVisibility> {
  if (!organizationId) return DEFAULT_RECORDING_VISIBILITY;

  try {
    const [row] = await getDb()
      .select({
        defaultVisibility: schema.organizationSettings.defaultVisibility,
      })
      .from(schema.organizationSettings)
      .where(eq(schema.organizationSettings.organizationId, organizationId))
      .limit(1);
    return resolveRecordingVisibility(undefined, row?.defaultVisibility);
  } catch {
    return DEFAULT_RECORDING_VISIBILITY;
  }
}

export async function getDefaultRecordingVisibility(
  organizationId: string | null | undefined,
  userEmail: string | null | undefined = getRequestUserEmail(),
): Promise<RecordingVisibility> {
  const email = userEmail;
  if (email) {
    const prefs = (await getUserSetting(
      normalizeOwnerEmail(email),
      CLIPS_USER_PREFS_KEY,
    )) as ClipsUserPrefs | null;
    const preferred = prefs?.defaultRecordingVisibility;
    if (isRecordingVisibility(preferred)) return preferred;
  }
  return getOrganizationDefaultVisibility(organizationId);
}

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
  const lowerEmail = email.toLowerCase();

  try {
    const [row] = await getDb()
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.orgId, organizationId),
          sql`lower(${orgMembers.email}) = ${lowerEmail}`,
        ),
      )
      .limit(1);
    if (row?.role) return normalizeOrganizationRole(row.role);
  } catch {
    // org_members table may not exist yet on first boot before migrations finish.
  }

  return implicitServiceOrgRole({
    email,
    orgId: organizationId,
    requestOrgId: getRequestOrgId(),
  });
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
    throw new HTTPError({
      statusCode: 403,
      statusMessage: "Organization not found or access denied",
    });
  }
  return { organizationId: resolvedOrganizationId, email, role };
}

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

  const ctxOrgId = getRequestOrgId();
  if (ctxOrgId) return ctxOrgId;

  const email = getRequestUserEmail();

  if (email) {
    let resolved: string | null | undefined;
    try {
      const { resolveOrgIdForEmail } = await import("@agent-native/core/org");
      resolved = await resolveOrgIdForEmail(email);
    } catch {
      // coercion-ok: the framework helper is unavailable in this context, and
      // leaving `resolved` undefined is the typed "could not answer" the check
      // below keeps distinct from a definite null.
    }
    if (resolved) return resolved;
    // A definite null covers both no membership and an explicit Personal
    // selection, and the legacy sources below cannot improve on either: they
    // are not scoped to a caller, so they would either hand over an org this
    // caller has no relationship with or reactivate scope the user opted out
    // of. Migration v61 seeds `org_members` for every legacy workspace owner
    // and member, so a real legacy user resolves here rather than below.
    if (resolved === null) return null;
  }

  try {
    const legacy = (await readAppState("current-workspace")) as {
      id?: string;
    } | null;
    const legacyOrgId = await legacyOrganizationIdForCaller(legacy?.id, email);
    if (legacyOrgId) return legacyOrgId;
  } catch {
    // fall through
  }

  try {
    const [row] = await getDb()
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .orderBy(desc(schema.workspaces.createdAt))
      .limit(1);
    const legacyOrgId = await legacyOrganizationIdForCaller(row?.id, email);
    if (legacyOrgId) return legacyOrgId;
  } catch {
    // fall through
  }

  return null;
}

async function legacyOrganizationIdForCaller(
  organizationId: string | null | undefined,
  email: string | undefined,
): Promise<string | null> {
  if (!organizationId) return null;

  const [row] = await getDb()
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!row) return null;

  if (!email) return organizationId;
  const role = await getOrganizationRoleForEmail(organizationId, email);
  return role ? organizationId : null;
}

export async function requireActiveOrganizationId(
  event?: H3Event,
): Promise<string> {
  const id = await getActiveOrganizationId(event);
  if (!id) {
    throw new HTTPError({
      statusCode: 409,
      statusMessage:
        "No active organization yet. Reload the page, then try again.",
    });
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

export interface RecordingRow {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  animatedThumbnailUrl: string | null;
  durationMs: number;
  videoUrl: string | null;
  status: "uploading" | "processing" | "ready" | "failed";
  visibility: RecordingVisibility;
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
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
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

export function shouldCountView(
  totalWatchMs: number,
  completedPct: number,
  scrubbedToEnd: boolean,
): boolean {
  return totalWatchMs >= 5000 || completedPct >= 75 || scrubbedToEnd;
}

export function countedViewCondition() {
  return eq(schema.recordingViewers.countedView, true);
}

export async function countRecordingViews(
  recordingId: string,
): Promise<number> {
  const db = getDb();
  const [viewerRow] = await db
    .select({ value: count() })
    .from(schema.recordingViewers)
    .where(
      and(
        eq(schema.recordingViewers.recordingId, recordingId),
        countedViewCondition(),
      ),
    );
  const [viewLogRow] = await db
    .select({ value: count() })
    .from(schema.recordingViews)
    .where(eq(schema.recordingViews.recordingId, recordingId));

  // `recording_views` only exists from migration v46, so clips recorded before
  // it have zero log rows. Floor the total at the counted-viewer count so those
  // clips keep reporting a real number instead of dropping to 0, and so the
  // total can never read below the unique-viewer count beside it.
  return Math.max(
    Number(viewLogRow?.value ?? 0),
    Number(viewerRow?.value ?? 0),
  );
}
