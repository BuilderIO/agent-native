import {
  registerRecurringSweepHandler,
  scheduledTriggerAvailability,
  type RecurringSweepContext,
} from "@agent-native/core/server";
import { startIntervalJob } from "@agent-native/core/server/interval-job";

import {
  nextBookingReminderDueAt,
  runBookingRemindersOnce,
} from "../lib/booking-reminders.js";

const INTERVAL_MS = 60_000;

const runRegisteredBookingReminders = async (
  context: RecurringSweepContext,
): Promise<void> => {
  await runBookingRemindersOnce(context.signal);
};

let unregisterRecurringSweepHandler: (() => void) | undefined;

export default function registerBookingReminders() {
  unregisterRecurringSweepHandler ??= registerRecurringSweepHandler(
    "calendar-booking-reminders",
    runRegisteredBookingReminders,
    { nextDueAt: () => nextBookingReminderDueAt() },
  );
  const availability = scheduledTriggerAvailability();
  if (!availability.available || availability.driver !== "in-process") return;
  startIntervalJob(
    async (signal) => {
      await runBookingRemindersOnce(signal);
    },
    {
      intervalMs: INTERVAL_MS,
      leading: false,
      onError: (error) =>
        console.error("[calendar-booking-reminders] sweep failed:", error),
    },
  );
}
