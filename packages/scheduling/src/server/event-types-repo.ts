/**
 * Data access for event types.
 *
 * All write paths funnel through here so ownership, slug uniqueness, and
 * redirect history are handled consistently.
 */
import { eq, and, or, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { accessFilter } from "@agent-native/core/sharing";
import type { EventType, Location, CustomField } from "../shared/index.js";
import { getSchedulingContext } from "./context.js";

function keyFor(
  ownerEmail: string | null,
  teamId: string | null,
  slug: string,
): string {
  if (teamId) return `team:${teamId}:${slug}`;
  return `user:${ownerEmail ?? ""}:${slug}`;
}

function rowToEventType(row: any): EventType {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description ?? undefined,
    length: row.length,
    durations: parseJson<number[]>(row.durations),
    hidden: Boolean(row.hidden),
    position: row.position,
    schedulingType: row.schedulingType,
    ownerEmail: row.ownerEmail ?? undefined,
    teamId: row.teamId ?? undefined,
    scheduleId: row.scheduleId ?? undefined,
    locations: parseJson<Location[]>(row.locations) ?? [],
    customFields: parseJson<CustomField[]>(row.customFields) ?? [],
    minimumBookingNotice: row.minimumBookingNotice,
    beforeEventBuffer: row.beforeEventBuffer,
    afterEventBuffer: row.afterEventBuffer,
    slotInterval: row.slotInterval ?? null,
    periodType: row.periodType,
    periodDays: row.periodDays ?? undefined,
    periodStartDate: row.periodStartDate ?? undefined,
    periodEndDate: row.periodEndDate ?? undefined,
    seatsPerTimeSlot: row.seatsPerTimeSlot ?? undefined,
    requiresConfirmation: Boolean(row.requiresConfirmation),
    disableGuests: Boolean(row.disableGuests),
    hideCalendarNotes: Boolean(row.hideCalendarNotes),
    successRedirectUrl: row.successRedirectUrl ?? undefined,
    bookingLimits: parseJson(row.bookingLimits),
    lockTimeZoneToggle: Boolean(row.lockTimeZoneToggle),
    color: row.color ?? undefined,
    eventName: row.eventName ?? undefined,
    recurringEvent: parseJson(row.recurringEvent),
    metadata: parseJson(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseJson<T = any>(str: string | null | undefined): T | undefined {
  if (!str) return undefined;
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}

export async function listEventTypes(params: {
  /**
   * If provided and `useAccessFilter` is not true, narrow rows to this owner.
   * For org-aware list calls, prefer `useAccessFilter: true` instead.
   */
  ownerEmail?: string;
  teamId?: string;
  includeHidden?: boolean;
  /**
   * When true, apply the framework `accessFilter` (owner OR shared OR
   * org-visibility OR public) instead of plain ownerEmail equality. This is
   * the right mode for any UI/agent listing, since it admits org-shared and
   * explicitly-shared event types in addition to the user's own.
   */
  useAccessFilter?: boolean;
}): Promise<EventType[]> {
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  let rows: any[];
  if (params.teamId) {
    // Team-scoped listings. Callers are responsible for asserting team
    // membership before invoking — the repo does not (it runs without a
    // request context in some paths, e.g. public booking pages that
    // explicitly pass a teamId).
    rows = await db
      .select()
      .from(schema.eventTypes)
      .where(eq(schema.eventTypes.teamId, params.teamId));
  } else if (params.useAccessFilter) {
    rows = await db
      .select()
      .from(schema.eventTypes)
      .where(accessFilter(schema.eventTypes, schema.eventTypeShares));
  } else if (params.ownerEmail) {
    rows = await db
      .select()
      .from(schema.eventTypes)
      .where(eq(schema.eventTypes.ownerEmail, params.ownerEmail));
  } else {
    // Refuse to return unscoped results. Callers must supply at least
    // one of: teamId, useAccessFilter, or ownerEmail.
    return [];
  }
  return rows
    .filter((r: any) => (params.includeHidden ? true : !r.hidden))
    .sort((a: any, b: any) => a.position - b.position)
    .map(rowToEventType);
}

export async function getEventTypeById(id: string): Promise<EventType | null> {
  const { getDb, schema } = getSchedulingContext();
  const rows = await getDb()
    .select()
    .from(schema.eventTypes)
    .where(eq(schema.eventTypes.id, id));
  return rows[0] ? rowToEventType(rows[0]) : null;
}

export async function getEventTypeBySlug(params: {
  ownerEmail?: string;
  teamId?: string;
  slug: string;
}): Promise<EventType | null> {
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  let rows: any[];
  if (params.teamId) {
    rows = await db
      .select()
      .from(schema.eventTypes)
      .where(
        and(
          eq(schema.eventTypes.teamId, params.teamId),
          eq(schema.eventTypes.slug, params.slug),
        ),
      );
  } else if (params.ownerEmail) {
    rows = await db
      .select()
      .from(schema.eventTypes)
      .where(
        and(
          eq(schema.eventTypes.ownerEmail, params.ownerEmail),
          eq(schema.eventTypes.slug, params.slug),
        ),
      );
  } else {
    return null;
  }
  return rows[0] ? rowToEventType(rows[0]) : null;
}

export async function createEventType(input: {
  ownerEmail?: string;
  teamId?: string;
  orgId?: string;
  title: string;
  slug: string;
  length: number;
  description?: string;
  schedulingType?: EventType["schedulingType"];
  locations?: Location[];
  customFields?: CustomField[];
  scheduleId?: string;
  color?: string;
}): Promise<EventType> {
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  const now = new Date().toISOString();
  const id = nanoid();
  await db.insert(schema.eventTypes).values({
    id,
    title: input.title,
    slug: input.slug,
    description: input.description ?? null,
    length: input.length,
    position: 0,
    hidden: false,
    schedulingType: input.schedulingType ?? "personal",
    ownerEmail: input.ownerEmail ?? null,
    teamId: input.teamId ?? null,
    scheduleId: input.scheduleId ?? null,
    locations: input.locations
      ? JSON.stringify(input.locations)
      : JSON.stringify([{ kind: "cal-video" }]),
    customFields: input.customFields
      ? JSON.stringify(input.customFields)
      : JSON.stringify([]),
    minimumBookingNotice: 0,
    beforeEventBuffer: 0,
    afterEventBuffer: 0,
    slotInterval: null,
    periodType: "rolling",
    periodDays: 60,
    requiresConfirmation: false,
    disableGuests: false,
    hideCalendarNotes: false,
    lockTimeZoneToggle: false,
    color: input.color ?? null,
    createdAt: now,
    updatedAt: now,
    orgId: input.orgId ?? null,
  });
  const created = await getEventTypeById(id);
  if (!created) throw new Error("Failed to create event type");
  return created;
}

export async function updateEventType(
  id: string,
  patch: Partial<EventType>,
): Promise<EventType> {
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  const current = await getEventTypeById(id);
  if (!current) throw new Error(`Event type ${id} not found`);

  const dbPatch: Record<string, any> = {};
  if (patch.title != null) dbPatch.title = patch.title;
  if (patch.slug != null && patch.slug !== current.slug) {
    // Record slug redirect
    const oldKey = keyFor(
      current.ownerEmail ?? null,
      current.teamId ?? null,
      current.slug,
    );
    const newKey = keyFor(
      current.ownerEmail ?? null,
      current.teamId ?? null,
      patch.slug,
    );
    await db
      .insert(schema.eventTypeSlugRedirects)
      .values({
        oldKey,
        newKey,
        eventTypeId: id,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing?.();
    dbPatch.slug = patch.slug;
  }
  if (patch.description !== undefined)
    dbPatch.description = patch.description ?? null;
  if (patch.length != null) dbPatch.length = patch.length;
  if (patch.durations !== undefined)
    dbPatch.durations = patch.durations
      ? JSON.stringify(patch.durations)
      : null;
  if (patch.hidden != null) dbPatch.hidden = patch.hidden;
  if (patch.position != null) dbPatch.position = patch.position;
  if (patch.schedulingType != null)
    dbPatch.schedulingType = patch.schedulingType;
  if (patch.scheduleId !== undefined)
    dbPatch.scheduleId = patch.scheduleId ?? null;
  if (patch.locations !== undefined)
    dbPatch.locations = JSON.stringify(patch.locations ?? []);
  if (patch.customFields !== undefined)
    dbPatch.customFields = JSON.stringify(patch.customFields ?? []);
  if (patch.minimumBookingNotice != null)
    dbPatch.minimumBookingNotice = patch.minimumBookingNotice;
  if (patch.beforeEventBuffer != null)
    dbPatch.beforeEventBuffer = patch.beforeEventBuffer;
  if (patch.afterEventBuffer != null)
    dbPatch.afterEventBuffer = patch.afterEventBuffer;
  if (patch.slotInterval !== undefined)
    dbPatch.slotInterval = patch.slotInterval;
  if (patch.periodType != null) dbPatch.periodType = patch.periodType;
  if (patch.periodDays !== undefined)
    dbPatch.periodDays = patch.periodDays ?? null;
  if (patch.periodStartDate !== undefined)
    dbPatch.periodStartDate = patch.periodStartDate ?? null;
  if (patch.periodEndDate !== undefined)
    dbPatch.periodEndDate = patch.periodEndDate ?? null;
  if (patch.seatsPerTimeSlot !== undefined)
    dbPatch.seatsPerTimeSlot = patch.seatsPerTimeSlot ?? null;
  if (patch.requiresConfirmation != null)
    dbPatch.requiresConfirmation = patch.requiresConfirmation;
  if (patch.disableGuests != null) dbPatch.disableGuests = patch.disableGuests;
  if (patch.hideCalendarNotes != null)
    dbPatch.hideCalendarNotes = patch.hideCalendarNotes;
  if (patch.successRedirectUrl !== undefined)
    dbPatch.successRedirectUrl = patch.successRedirectUrl ?? null;
  if (patch.bookingLimits !== undefined)
    dbPatch.bookingLimits = patch.bookingLimits
      ? JSON.stringify(patch.bookingLimits)
      : null;
  if (patch.lockTimeZoneToggle != null)
    dbPatch.lockTimeZoneToggle = patch.lockTimeZoneToggle;
  if (patch.color !== undefined) dbPatch.color = patch.color ?? null;
  if (patch.eventName !== undefined)
    dbPatch.eventName = patch.eventName ?? null;
  if (patch.recurringEvent !== undefined)
    dbPatch.recurringEvent = patch.recurringEvent
      ? JSON.stringify(patch.recurringEvent)
      : null;
  if (patch.metadata !== undefined)
    dbPatch.metadata = patch.metadata ? JSON.stringify(patch.metadata) : null;

  dbPatch.updatedAt = new Date().toISOString();

  await db
    .update(schema.eventTypes)
    .set(dbPatch)
    .where(eq(schema.eventTypes.id, id));
  const updated = await getEventTypeById(id);
  if (!updated) throw new Error("Failed to update event type");
  return updated;
}

export async function deleteEventType(id: string): Promise<void> {
  const { getDb, schema } = getSchedulingContext();
  await getDb().delete(schema.eventTypes).where(eq(schema.eventTypes.id, id));
}

export async function resolveEventTypeSlug(params: {
  ownerEmail?: string;
  teamId?: string;
  slug: string;
}): Promise<EventType | null> {
  const direct = await getEventTypeBySlug(params);
  if (direct) return direct;
  const { getDb, schema } = getSchedulingContext();
  const oldKey = keyFor(
    params.ownerEmail ?? null,
    params.teamId ?? null,
    params.slug,
  );
  const redirects = await getDb()
    .select()
    .from(schema.eventTypeSlugRedirects)
    .where(eq(schema.eventTypeSlugRedirects.oldKey, oldKey));
  if (redirects[0]?.eventTypeId) {
    return getEventTypeById(redirects[0].eventTypeId);
  }
  return null;
}
