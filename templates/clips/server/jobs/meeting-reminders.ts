/**
 * meeting-reminders — recurring job (every 60s).
 *
 * Finds meetings whose `scheduledStart` falls within [now, now+5min] and
 * which haven't yet had a reminder fired (`reminderFiredAt IS NULL`).
 * Emits the `meeting-reminder` event on the framework event bus and
 * stamps `reminderFiredAt` so we don't re-fire on the next tick.
 *
 * Delivery contract:
 *   - The Tauri desktop tray watcher is the *primary* consumer today: it
 *     polls `list-meetings` directly (no event-bus subscription) and looks
 *     at `scheduledStart` / `reminderFiredAt` itself, so users see the tray
 *     banner / "Join + Record" button even when no listener is attached.
 *   - The bus event is intended for *future* server-side delivery channels
 *     (e.g. mobile push, Slack DMs, browser push) where a listener will
 *     subscribe in-process and fan-out to the appropriate transport.
 *   - The framework event bus is in-process only — there is no durable
 *     queue. Subscribers running on a different host won't see the event;
 *     they should query `list-meetings` on a poll instead.
 */

import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { emit, registerEvent } from "@agent-native/core/event-bus";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { getDb, schema } from "../db/index.js";

const REMINDER_INTERVAL_MS = 60 * 1000;
const REMINDER_WINDOW_MS = 5 * 60 * 1000;
let skippingLogged = false;

const meetingReminderSchema = z.object({
  meetingId: z.string(),
  title: z.string(),
  joinUrl: z.string().nullable(),
  scheduledStart: z.string(),
  ownerEmail: z.string().nullable(),
  organizationId: z.string().nullable(),
  platform: z.string(),
});

export function registerMeetingReminderEvent(): void {
  registerEvent({
    name: "meeting-reminder",
    description:
      "Fires once per upcoming meeting when its scheduled start falls within the next 5 minutes.",
    payloadSchema: meetingReminderSchema as any,
  });
}

export async function runMeetingRemindersOnce(): Promise<void> {
  await runWithRequestContext({}, async () => {
    const db = getDb();
    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MS);
    try {
      const due = await db
        .select()
        .from(schema.meetings)
        .where(
          and(
            isNull(schema.meetings.reminderFiredAt),
            // String ISO timestamps sort lexicographically the same as
            // chronologically, so `gte` / `lte` works on the text column.
            gte(schema.meetings.scheduledStart, now.toISOString()),
            lte(schema.meetings.scheduledStart, windowEnd.toISOString()),
          ),
        );
      for (const meeting of due) {
        try {
          emit("meeting-reminder", {
            meetingId: meeting.id,
            title: meeting.title,
            joinUrl: meeting.joinUrl ?? null,
            scheduledStart: meeting.scheduledStart ?? "",
            ownerEmail: meeting.ownerEmail ?? null,
            organizationId: meeting.organizationId ?? null,
            platform: meeting.platform,
          });
        } catch (err: any) {
          console.warn(
            `[meeting-reminders] emit failed for ${meeting.id}:`,
            err?.message ?? err,
          );
        }
        // Stamp so we don't re-fire next tick.
        await db
          .update(schema.meetings)
          .set({ reminderFiredAt: new Date().toISOString() })
          .where(eq(schema.meetings.id, meeting.id));
      }
    } catch (err: any) {
      // Swallow DB errors (e.g. tables not yet migrated). The job is best
      // effort and must never crash the host process.
      console.warn(`[meeting-reminders] tick failed:`, err?.message ?? err);
    }
  });
}

export default function registerMeetingRemindersJob(): void {
  registerMeetingReminderEvent();

  const isProd = process.env.NODE_ENV === "production";
  const flag = process.env.RUN_BACKGROUND_JOBS;
  const enabled = flag === "1" || (isProd && flag !== "0");
  if (!enabled) {
    if (!skippingLogged) {
      console.log(
        "[meeting-reminders] Skipping background reminders (set RUN_BACKGROUND_JOBS=1 to enable in dev).",
      );
      skippingLogged = true;
    }
    return;
  }
  setInterval(() => {
    runMeetingRemindersOnce().catch((err) =>
      console.error("[meeting-reminders] interval failed:", err),
    );
  }, REMINDER_INTERVAL_MS);
  console.log(
    `[meeting-reminders] Recurring meeting reminders every ${REMINDER_INTERVAL_MS / 1000}s.`,
  );
}
