import { fail } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";

import { getDb, schema } from "../db/index.js";
import { nanoid, nowIso, stableJson } from "./brain.js";
import { zoomApprovedMeetingIds } from "./zoom.js";

type BrainDb = ReturnType<typeof getDb>;

// Org owners and admins are the Brain admins: the Zoom token is account-wide, so
// only they may create a Zoom source, change its Zoom settings, or own one that
// syncs.
export async function isBrainAdmin(
  email: string | null | undefined,
  orgId: string | null | undefined,
): Promise<boolean> {
  const normalizedEmail = email?.trim();
  const normalizedOrgId = orgId?.trim();
  if (!normalizedEmail || !normalizedOrgId) return false;
  const { rows } = await getDbExec().execute({
    sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = LOWER(?) AND federation_removal_pending_at IS NULL LIMIT 1`,
    args: [normalizedOrgId, normalizedEmail],
  });
  const role = (rows[0] as { role?: unknown } | undefined)?.role;
  return role === "owner" || role === "admin";
}

export async function assertBrainAdmin(
  orgId: string | null | undefined = getRequestOrgId(),
): Promise<{ email: string; orgId: string }> {
  const email = getRequestUserEmail();
  if (!email || !orgId || !(await isBrainAdmin(email, orgId))) {
    fail(
      "Only Brain admins (organization owners and admins) can create Zoom sources or change their Zoom settings.",
      { errorCode: "brain_admin_required", statusCode: 403 },
    );
  }
  return { email, orgId };
}

export type ZoomAuditEventName =
  (typeof schema.brainZoomAuditEvents.$inferInsert)["event"];

export interface ZoomAuditEvent {
  orgId: string | null;
  sourceId: string;
  event: ZoomAuditEventName;
  actorEmail?: string | null;
  decision?: "allow" | "deny" | null;
  meetingId?: string | null;
  meetingUuid?: string | null;
  detail?: Record<string, unknown>;
}

export async function recordZoomAuditEvent(
  event: ZoomAuditEvent,
  db: BrainDb = getDb(),
): Promise<void> {
  await db.insert(schema.brainZoomAuditEvents).values({
    id: `zaudit_${nanoid(16)}`,
    orgId: event.orgId,
    sourceId: event.sourceId,
    actorEmail: event.actorEmail ?? null,
    event: event.event,
    decision: event.decision ?? null,
    meetingId: event.meetingId ?? null,
    meetingUuid: event.meetingUuid ?? null,
    detailJson: stableJson(event.detail ?? {}),
    createdAt: nowIso(),
  });
}

const ZOOM_SETTING_KEYS = ["lookbackDays", "userIds"] as const;

export function zoomAllowlistChange(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { added: string[]; removed: string[]; changedSettings: string[] } {
  const beforeIds = zoomApprovedMeetingIds(before);
  const afterIds = zoomApprovedMeetingIds(after);
  return {
    added: [...afterIds].filter((id) => !beforeIds.has(id)).sort(),
    removed: [...beforeIds].filter((id) => !afterIds.has(id)).sort(),
    changedSettings: ZOOM_SETTING_KEYS.filter(
      (key) =>
        stableJson(before[key] ?? null) !== stableJson(after[key] ?? null),
    ),
  };
}
