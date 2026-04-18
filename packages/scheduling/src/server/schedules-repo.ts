/**
 * Data access for schedules — the weekly-hours + date-override definitions
 * that event types reference.
 */
import { eq, and, inArray, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { accessFilter } from "@agent-native/core/sharing";
import type {
  Schedule,
  WeeklyAvailability,
  DateOverride,
  AvailabilityInterval,
} from "../shared/index.js";
import { getSchedulingContext } from "./context.js";

export async function listSchedules(
  ownerEmailOrParams:
    | string
    | {
        ownerEmail?: string;
        useAccessFilter?: boolean;
      },
): Promise<Schedule[]> {
  const params =
    typeof ownerEmailOrParams === "string"
      ? { ownerEmail: ownerEmailOrParams }
      : ownerEmailOrParams;
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  let where: SQL | undefined;
  if (params.useAccessFilter) {
    where = accessFilter(schema.schedules, schema.scheduleShares);
  } else if (params.ownerEmail) {
    where = eq(schema.schedules.ownerEmail, params.ownerEmail);
  }
  const scheduleRows = await db.select().from(schema.schedules).where(where);
  if (scheduleRows.length === 0) return [];
  const ids = scheduleRows.map((r: any) => r.id);
  const availabilityRows = await db
    .select()
    .from(schema.scheduleAvailability)
    .where(inArray(schema.scheduleAvailability.scheduleId, ids));
  const overrideRows = await db
    .select()
    .from(schema.dateOverrides)
    .where(inArray(schema.dateOverrides.scheduleId, ids));
  return scheduleRows.map((s: any) =>
    hydrateSchedule(s, availabilityRows, overrideRows),
  );
}

export async function getScheduleById(id: string): Promise<Schedule | null> {
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  const s = await db
    .select()
    .from(schema.schedules)
    .where(eq(schema.schedules.id, id));
  if (!s[0]) return null;
  const avail = await db
    .select()
    .from(schema.scheduleAvailability)
    .where(eq(schema.scheduleAvailability.scheduleId, id));
  const overrides = await db
    .select()
    .from(schema.dateOverrides)
    .where(eq(schema.dateOverrides.scheduleId, id));
  return hydrateSchedule(s[0], avail, overrides);
}

export async function createSchedule(input: {
  ownerEmail: string;
  orgId?: string;
  name: string;
  timezone: string;
  isDefault?: boolean;
  weeklyAvailability?: WeeklyAvailability[];
}): Promise<Schedule> {
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(schema.schedules).values({
    id,
    name: input.name,
    timezone: input.timezone,
    isDefault: Boolean(input.isDefault),
    ownerEmail: input.ownerEmail,
    orgId: input.orgId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  const weekly = input.weeklyAvailability ?? defaultWeeklyAvailability();
  for (const w of weekly) {
    for (const iv of w.intervals) {
      await db.insert(schema.scheduleAvailability).values({
        id: nanoid(),
        scheduleId: id,
        day: w.day,
        startTime: iv.startTime,
        endTime: iv.endTime,
        createdAt: now,
      });
    }
  }
  const out = await getScheduleById(id);
  if (!out) throw new Error("Failed to create schedule");
  return out;
}

export async function updateSchedule(
  id: string,
  patch: {
    name?: string;
    timezone?: string;
    weeklyAvailability?: WeeklyAvailability[];
    dateOverrides?: DateOverride[];
    isDefault?: boolean;
  },
): Promise<Schedule> {
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  const now = new Date().toISOString();
  const setClause: any = { updatedAt: now };
  if (patch.name != null) setClause.name = patch.name;
  if (patch.timezone != null) setClause.timezone = patch.timezone;
  if (patch.isDefault != null) setClause.isDefault = patch.isDefault;
  await db
    .update(schema.schedules)
    .set(setClause)
    .where(eq(schema.schedules.id, id));

  if (patch.weeklyAvailability) {
    await db
      .delete(schema.scheduleAvailability)
      .where(eq(schema.scheduleAvailability.scheduleId, id));
    for (const w of patch.weeklyAvailability) {
      for (const iv of w.intervals) {
        await db.insert(schema.scheduleAvailability).values({
          id: nanoid(),
          scheduleId: id,
          day: w.day,
          startTime: iv.startTime,
          endTime: iv.endTime,
          createdAt: now,
        });
      }
    }
  }
  if (patch.dateOverrides) {
    await db
      .delete(schema.dateOverrides)
      .where(eq(schema.dateOverrides.scheduleId, id));
    for (const o of patch.dateOverrides) {
      await db.insert(schema.dateOverrides).values({
        id: nanoid(),
        scheduleId: id,
        date: o.date,
        intervals: JSON.stringify(o.intervals),
        createdAt: now,
      });
    }
  }
  const updated = await getScheduleById(id);
  if (!updated) throw new Error("Failed to update schedule");
  return updated;
}

export async function deleteSchedule(id: string): Promise<void> {
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  await db
    .delete(schema.dateOverrides)
    .where(eq(schema.dateOverrides.scheduleId, id));
  await db
    .delete(schema.scheduleAvailability)
    .where(eq(schema.scheduleAvailability.scheduleId, id));
  await db.delete(schema.schedules).where(eq(schema.schedules.id, id));
}

export async function setDefaultSchedule(
  ownerEmail: string,
  scheduleId: string,
): Promise<void> {
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  const now = new Date().toISOString();
  const all = await db
    .select({ id: schema.schedules.id })
    .from(schema.schedules)
    .where(eq(schema.schedules.ownerEmail, ownerEmail));
  for (const row of all) {
    await db
      .update(schema.schedules)
      .set({ isDefault: row.id === scheduleId, updatedAt: now })
      .where(eq(schema.schedules.id, row.id));
  }
}

export async function upsertDateOverride(
  scheduleId: string,
  date: string,
  intervals: AvailabilityInterval[],
): Promise<void> {
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  const now = new Date().toISOString();
  await db
    .delete(schema.dateOverrides)
    .where(
      and(
        eq(schema.dateOverrides.scheduleId, scheduleId),
        eq(schema.dateOverrides.date, date),
      ),
    );
  await db.insert(schema.dateOverrides).values({
    id: nanoid(),
    scheduleId,
    date,
    intervals: JSON.stringify(intervals),
    createdAt: now,
  });
}

export async function removeDateOverride(
  scheduleId: string,
  date: string,
): Promise<void> {
  const { getDb, schema } = getSchedulingContext();
  await getDb()
    .delete(schema.dateOverrides)
    .where(
      and(
        eq(schema.dateOverrides.scheduleId, scheduleId),
        eq(schema.dateOverrides.date, date),
      ),
    );
}

function hydrateSchedule(
  s: any,
  availabilityRows: any[],
  overrideRows: any[],
): Schedule {
  const weekly = new Map<number, AvailabilityInterval[]>();
  for (const row of availabilityRows) {
    if (row.scheduleId !== s.id) continue;
    const day = row.day;
    if (!weekly.has(day)) weekly.set(day, []);
    weekly.get(day)!.push({ startTime: row.startTime, endTime: row.endTime });
  }
  const weeklyAvailability: WeeklyAvailability[] = Array.from(weekly.entries())
    .map(([day, intervals]) => ({ day, intervals }))
    .sort((a, b) => a.day - b.day);
  const dateOverrides: DateOverride[] = overrideRows
    .filter((r) => r.scheduleId === s.id)
    .map((r) => ({
      date: r.date,
      intervals: JSON.parse(r.intervals),
    }));
  return {
    id: s.id,
    name: s.name,
    timezone: s.timezone,
    ownerEmail: s.ownerEmail,
    isDefault: Boolean(s.isDefault),
    weeklyAvailability,
    dateOverrides,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function defaultWeeklyAvailability(): WeeklyAvailability[] {
  return [1, 2, 3, 4, 5].map((day) => ({
    day,
    intervals: [{ startTime: "09:00", endTime: "17:00" }],
  }));
}
