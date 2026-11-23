import { defineAction, fail } from "@agent-native/core/action";
import {
  defineAutomation,
  updateAutomation,
} from "@agent-native/core/triggers";
import { z } from "zod";

/** The framework's scheduler evaluates a five-field cron in the task's timezone. */
export function taskScheduleCron(input: {
  cadence: "daily" | "weekly" | "monthly";
  hour: number;
  minute: number;
  dayOfWeek?: number | undefined;
  dayOfMonth?: number | undefined;
}): string {
  const { cadence, hour, minute } = input;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23)
    throw Object.assign(new Error("The hour must be between 0 and 23."), {
      statusCode: 400,
    });
  if (!Number.isInteger(minute) || minute < 0 || minute > 59)
    throw Object.assign(new Error("The minute must be between 0 and 59."), {
      statusCode: 400,
    });
  if (cadence === "daily") return `${minute} ${hour} * * *`;
  if (cadence === "weekly") {
    const day = input.dayOfWeek ?? 1;
    if (!Number.isInteger(day) || day < 0 || day > 6)
      throw Object.assign(new Error("Pick a day of the week."), {
        statusCode: 400,
      });
    return `${minute} ${hour} * * ${day}`;
  }
  const day = input.dayOfMonth ?? 1;
  if (!Number.isInteger(day) || day < 1 || day > 28)
    throw Object.assign(new Error("Pick a day of the month."), {
      statusCode: 400,
    });
  return `${minute} ${hour} ${day} * *`;
}

/** The offset a zone has at an instant, so a calendar date means that date there. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/**
 * The moment a calendar date ends in the task's own timezone: the last run must
 * still be able to happen on that day, and nothing after it.
 */
export function endOfDayInZone(date: string, timeZone: string): string {
  const trimmed = date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw Object.assign(new Error("The end date must be a calendar date."), {
      statusCode: 400,
    });
  }
  const naive = Date.parse(`${trimmed}T23:59:59.000Z`);
  if (
    Number.isNaN(naive) ||
    new Date(naive).toISOString().slice(0, 10) !== trimmed
  ) {
    throw Object.assign(new Error("The end date must be a calendar date."), {
      statusCode: 400,
    });
  }
  const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);
  const resolved = naive - zoneOffsetMs(new Date(firstPass), timeZone);
  return new Date(resolved).toISOString();
}

const scheduleSchema = z.object({
  cadence: z.enum(["daily", "weekly", "monthly"]),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  timezone: z.string().trim().min(1),
});

/**
 * A task is a recurring agent run: the framework's scheduler owns the clock and
 * the run, and this action only records what to ask on each run.
 */
export default defineAction({
  description:
    "Create, pause, resume or delete a scheduled task: an agent run that repeats on a cadence and asks the same prompt each time.",
  agentTool: true,
  schema: z.discriminatedUnion("operation", [
    z.object({
      operation: z.literal("create"),
      title: z.string().trim().min(1).max(120),
      prompt: z.string().trim().min(1).max(8000),
      schedule: scheduleSchema,
      // The dialog's model picker (source: TaskPromptSection's model picker) —
      // the run uses this model, so it is stored on the automation.
      model: z.string().trim().min(1).max(200).optional(),
      // The dialog's end date (source: TaskScheduleSection's expiration date).
      endDate: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      // The dialog's notification destination (source: Send after every run).
      notification: z
        .object({
          platform: z.string().trim().min(1).max(40),
          destination: z.string().trim().min(1).max(200),
        })
        .optional(),
      scope: z.enum(["personal", "organization"]).default("personal"),
    }),
    z.object({
      operation: z.enum(["pause", "resume"]),
      taskId: z.string().trim().min(1),
      scope: z.enum(["personal", "organization"]).default("personal"),
    }),
  ]),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");
    const actor = {
      userEmail,
      ...(ctx?.orgId ? { orgId: ctx.orgId } : {}),
      ...(ctx?.appId ? { appId: ctx.appId } : {}),
    };
    if (input.operation === "create") {
      let schedule: string;
      try {
        schedule = taskScheduleCron(input.schedule);
      } catch (error) {
        fail(String((error as Error).message), {
          statusCode: 400,
          errorCode: "task_schedule_invalid",
        });
      }
      const created = await defineAutomation(actor, {
        name: input.title,
        scope: input.scope,
        triggerType: "schedule",
        body: input.prompt,
        schedule,
        timezone: input.schedule.timezone,
        enabled: true,
        ...(input.model ? { model: input.model } : {}),
        ...(input.endDate
          ? {
              expiresAt: endOfDayInZone(input.endDate, input.schedule.timezone),
            }
          : {}),
        ...(input.notification
          ? {
              delivery: {
                platform: input.notification.platform,
                destination: input.notification.destination,
              },
            }
          : {}),
      });
      return {
        id: created.resourceId,
        name: created.name,
        schedule: created.meta.schedule ?? schedule,
        timezone: created.meta.timezone ?? input.schedule.timezone,
        enabled: created.meta.enabled !== false,
        model: created.meta.model ?? null,
        expiresAt: created.meta.expiresAt ?? null,
        delivery: created.meta.deliveryPlatform
          ? {
              platform: created.meta.deliveryPlatform,
              destination: created.meta.deliveryDestination ?? null,
            }
          : null,
        nextRun: created.meta.nextRun ?? null,
      };
    }
    const updated = await updateAutomation(actor, {
      resourceId: input.taskId,
      scope: input.scope,
      enabled: input.operation === "resume",
    });
    return {
      id: updated.resource.id,
      name: updated.name,
      enabled: updated.meta.enabled !== false,
      nextRun: updated.meta.nextRun ?? null,
    };
  },
});
