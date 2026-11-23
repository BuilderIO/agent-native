import { isValidCron, nextOccurrence } from "@agent-native/core/jobs/cron";
import { z } from "zod";

const id = z.string().min(1).max(128);
const key = z.uuid();
const revision = z.string().regex(/^\d+$/);
const instant = z.iso.datetime();
const minute = z.int().min(0).max(59);
const clock = { hour: z.int().min(0).max(23), minute };

export function isIanaTimeZone(zone: string) {
  if (!zone || /^[+-]/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return false;
  }
}

function isFiveFieldCron(value: string) {
  return value.split(/\s+/).length === 5 && isValidCron(value);
}

export const scheduleCadence = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("hourly"), minute }),
  z.strictObject({ kind: z.literal("daily"), ...clock }),
  z.strictObject({
    kind: z.literal("weekly"),
    weekday: z.int().min(1).max(7),
    ...clock,
  }),
  z.strictObject({
    kind: z.literal("monthly"),
    day: z.int().min(1).max(31),
    ...clock,
  }),
  z.strictObject({
    kind: z.literal("custom"),
    cron: z.string().trim().max(120).refine(isFiveFieldCron),
  }),
]);
export type ScheduleCadence = z.infer<typeof scheduleCadence>;

export function normalizedScheduleCron(cadence: ScheduleCadence) {
  switch (cadence.kind) {
    case "hourly":
      return `${cadence.minute} * * * *`;
    case "daily":
      return `${cadence.minute} ${cadence.hour} * * *`;
    case "weekly":
      return `${cadence.minute} ${cadence.hour} * * ${cadence.weekday}`;
    case "monthly":
      return `${cadence.minute} ${cadence.hour} ${cadence.day} * *`;
    case "custom":
      return cadence.cron.trim().replace(/\s+/g, " ");
  }
}

const scheduleWallTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function getScheduleWallTimeFormatter(timezone: string): Intl.DateTimeFormat {
  let cached = scheduleWallTimeFormatters.get(timezone);
  if (cached) return cached;
  if (scheduleWallTimeFormatters.size >= 64) {
    const oldest = scheduleWallTimeFormatters.keys().next().value;
    if (oldest !== undefined) scheduleWallTimeFormatters.delete(oldest);
  }
  cached = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  scheduleWallTimeFormatters.set(timezone, cached);
  return cached;
}

export function nextScheduleFire(
  cadence: ScheduleCadence,
  timezone: string,
  after: Date,
) {
  const cron = normalizedScheduleCron(cadence);
  if (!isFiveFieldCron(cron) || !isIanaTimeZone(timezone)) return null;
  const formatter = getScheduleWallTimeFormatter(timezone);
  const wallTime = (value: number) => {
    const parts = new Map(
      formatter
        .formatToParts(value)
        .map(({ type, value }) => [type, Number(value)]),
    );
    return Date.UTC(
      Number(parts.get("year")),
      Number(parts.get("month")) - 1,
      Number(parts.get("day")),
      Number(parts.get("hour")),
      Number(parts.get("minute")),
      Number(parts.get("second")),
    );
  };
  const hourMs = 3_600_000;
  const afterMs = after.getTime();
  let wall = wallTime(afterMs);
  const end = new Date(wall);
  end.setUTCFullYear(end.getUTCFullYear() + 5);
  while (wall < end.getTime()) {
    try {
      wall = nextOccurrence(cron, new Date(wall), "UTC").getTime();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Out of the time span range"
      )
        return null;
      throw error;
    }
    if (wall > end.getTime()) return null;
    const offsets = new Set(
      [-36, 0, 36].map((hours) => {
        const sample = wall + hours * hourMs;
        return wallTime(sample) - sample;
      }),
    );
    const candidate = Math.min(
      ...[...offsets]
        .map((offset) => wall - offset)
        .filter((utc) => wallTime(utc) === wall),
    );
    if (Number.isFinite(candidate) && candidate > afterMs)
      return new Date(candidate);
  }
  return null;
}

export const scheduleIso = (date: Date) =>
  date.toISOString().replace(/\.000Z$/, "Z");

export const scheduleRecipient = z.strictObject({
  memberId: id,
  on: z.enum(["success", "failure", "both"]).default("both"),
});
export type ScheduleRecipient = z.infer<typeof scheduleRecipient>;
export const publishedAppScheduleConfig = z.strictObject({
  cadence: scheduleCadence,
  timezone: z.string().max(80).refine(isIanaTimeZone),
  target: z.literal("default").default("default"),
  updatePublishedResults: z.boolean().default(true),
  useCachedSqlResults: z.boolean().default(false),
  recipients: z
    .array(scheduleRecipient)
    .max(20)
    .refine(
      (rows) =>
        new Set(rows.map(({ memberId }) => memberId)).size === rows.length,
    ),
});
export type PublishedAppScheduleConfig = z.infer<
  typeof publishedAppScheduleConfig
>;

const scheduleRevision = { scheduleId: id, expectedRevision: revision };
export const setScheduleInput = z.strictObject({
  projectId: id,
  opId: key,
  change: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("create"),
      scheduleId: key,
      config: publishedAppScheduleConfig,
    }),
    z.strictObject({
      kind: z.literal("edit"),
      ...scheduleRevision,
      config: publishedAppScheduleConfig,
    }),
    z.strictObject({
      kind: z.enum(["pause", "resume", "delete"]),
      ...scheduleRevision,
    }),
  ]),
});
export const scheduleView = z.strictObject({
  scheduleId: id,
  revision,
  enabled: z.boolean(),
  deleted: z.boolean(),
  config: publishedAppScheduleConfig,
  nextFireAt: instant.nullable(),
  normalizedCron: z.string(),
});
export const setScheduleOutput = z.strictObject({
  opId: key,
  effect: z.enum([
    "created",
    "updated",
    "paused",
    "resumed",
    "deleted",
    "no_change",
  ]),
  schedule: scheduleView,
  committedAt: instant,
});
const page = {
  projectId: id,
  cursor: id.optional(),
  limit: z.int().min(1).max(50).default(25),
};
export const listSchedulesInput = z.strictObject({
  ...page,
  filter: z.enum(["all", "mine"]).default("all"),
});
export const listSchedulesOutput = z.strictObject({
  schedules: z.array(scheduleView).max(50),
  nextCursor: id.nullable(),
  canManage: z.boolean(),
  notificationsAvailable: z.boolean(),
});
export const listScheduleRunsInput = z.strictObject({
  ...page,
  scheduleId: id.optional(),
});
export const scheduleTickStatus = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "stopping",
  "cancelled",
  "cancel_unknown",
  "skipped",
]);
export const scheduleCacheStatus = z.enum([
  "pending",
  "updated",
  "preserved",
  "superseded",
]);
export const scheduleDiagnostic = z.strictObject({
  code: z.string().min(1).max(128),
});
export const scheduleDeliveryOutcome = z.enum([
  "pending",
  "sent",
  "failed",
  "unverified",
  "recipient_unavailable",
]);
export const scheduleTickView = z.strictObject({
  tickId: id,
  scheduleId: id,
  dueAt: instant,
  releaseId: id.nullable(),
  runId: id.nullable(),
  status: scheduleTickStatus,
  diagnostic: scheduleDiagnostic.nullable(),
  cache: scheduleCacheStatus,
  deliveries: z
    .array(
      z.strictObject({
        memberId: id,
        outcome: scheduleDeliveryOutcome,
        sentAt: instant.optional(),
      }),
    )
    .max(20),
});
export const listScheduleRunsOutput = z.strictObject({
  runs: z.array(scheduleTickView).max(50),
  nextCursor: id.nullable(),
});
export const stopScheduleRunInput = z.strictObject({
  projectId: id,
  tickId: id,
  opId: key,
});
export const stopScheduleRunOutput = z.strictObject({
  opId: key,
  tickId: id,
  outcome: z.enum([
    "requested",
    "cancelled",
    "completion_won",
    "cancel_unknown",
  ]),
});
export const scheduleRecipientsInput = z.strictObject({
  ...page,
  search: z.string().trim().max(128).optional(),
});
export const scheduleRecipientsOutput = z.strictObject({
  members: z
    .array(z.strictObject({ memberId: id, email: z.email(), name: z.string() }))
    .max(50),
  nextCursor: id.nullable(),
});
