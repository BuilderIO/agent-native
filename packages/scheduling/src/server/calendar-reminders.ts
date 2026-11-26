/**
 * The reminder a booking carries onto the destination calendar.
 *
 * The reference lets the owner pick a default reminder next to the destination
 * calendar ("Use default reminders", "Just in time", 10/30/60 minutes before) and
 * passes it to the calendar provider on the write. The package must not read the host's
 * profile itself, so the host installs a loader and the booking writer asks it.
 *
 * Three states, and they are not the same thing:
 *   - `undefined`: the host chose the calendar's own default, so nothing is sent;
 *   - `null`: reminders are off for this event;
 *   - a list of minutes: those reminders replace the calendar's default.
 */
export type CalendarReminderOverride = number[] | null | undefined;

export type CalendarReminderSource = (input: {
  hostEmail: string;
}) => Promise<CalendarReminderOverride>;

let source: CalendarReminderSource | null = null;

/** Install the host's reminder loader. */
export function setCalendarReminderSource(
  next: CalendarReminderSource | null,
): void {
  source = next;
}

export function getCalendarReminderSource(): CalendarReminderSource | null {
  return source;
}

/**
 * Ask the host what reminder a booking should carry. A loader that throws is treated
 * as "no opinion" rather than failing the booking: a reminder is a detail of the
 * calendar event, not the booking itself.
 */
export async function reminderOverrideFor(
  hostEmail: string,
): Promise<CalendarReminderOverride> {
  if (!source) return undefined;
  try {
    const value = await source({ hostEmail });
    if (value === null) return null;
    if (!Array.isArray(value)) return undefined;
    return value.filter((minutes) => Number.isFinite(minutes) && minutes >= 0);
  } catch {
    // coercion-ok: a throwing loader means "no opinion", per the contract above
    return undefined;
  }
}
