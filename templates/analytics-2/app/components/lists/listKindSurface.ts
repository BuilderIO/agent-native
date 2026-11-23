/**
 * Which list kinds the shell can actually render.
 *
 * Tasks has no surface yet. Its dialog needs a schedule end date and a
 * notification destination, and the shared automation model carries neither:
 * the original's create modal (title "New task") defaults `expirationDate` to
 * today + 90 days and gives each task a `userIds`/`groupIds`/`slackChannel`/
 * `slackDmUserId`/`automaticNotificationsDisabled` destination, while our
 * `manage-automation` action accepts no such fields. Until that backing exists
 * the shell renders nothing for tasks (and navigation keeps the row hidden)
 * instead of a dead frame.
 *
 * Sprint: sprint-analytics-2#221.
 */
export function listKindHasSurface(kind: string | undefined): boolean {
  return kind !== "tasks";
}
