/**
 * What makes a meeting worth showing in history.
 *
 * A calendar-sourced `clips_meetings` row is created as soon as the user
 * records or edits an event, so the table also holds bare husks that carry
 * nothing a user would ever reopen. Two places need that distinction and they
 * MUST agree:
 *
 *   1. this predicate, for rows already in memory, and
 *   2. `meetingHasContentFilter()` in `../list-meetings.ts`, its SQL mirror.
 *
 * The same rule decides which rows the history list returns AND which
 * persisted rows a live calendar event may supersede. Let the two drift and
 * history rows start vanishing behind their own calendar events — which is the
 * bug that made `recordedOnly` look like a reasonable filter in the first
 * place. `recordingId` alone is NOT the rule: desktop live notes produce a
 * meeting with a summary and no linked recording.
 */
export interface MeetingContentFields {
  recordingId?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  summaryMd?: string | null;
  userNotesMd?: string | null;
  bulletsJson?: string | null;
  actionItemsJson?: string | null;
}

export function meetingRowHasContent(row: MeetingContentFields): boolean {
  return Boolean(
    row.recordingId ||
    row.actualStart ||
    row.actualEnd ||
    (row.summaryMd ?? "").trim() ||
    (row.userNotesMd ?? "").trim() ||
    (row.bulletsJson ?? "[]") !== "[]" ||
    (row.actionItemsJson ?? "[]") !== "[]",
  );
}
