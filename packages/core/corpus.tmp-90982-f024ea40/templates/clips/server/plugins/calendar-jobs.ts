/**
 * Nitro plugin — registers the recurring calendar polling and meeting
 * reminder jobs. Both jobs gate on `RUN_BACKGROUND_JOBS` (see
 * `templates/mail/server/plugins/mail-jobs.ts` for the same gating
 * pattern).
 */

import registerBuilderMediaCompressionJob from "../jobs/builder-media-compression.js";
import registerMeetingRemindersJob from "../jobs/meeting-reminders.js";
import registerPollCalendarsJob from "../jobs/poll-calendars.js";
import registerStaleMeetingSweeperJob from "../jobs/stale-meeting-sweeper.js";

export default () => {
  // The reminder job registers the `meeting-reminder` event on every
  // boot (idempotent), so other consumers can subscribe even when the
  // background loop is off.
  registerMeetingRemindersJob();
  registerBuilderMediaCompressionJob();
  registerPollCalendarsJob();
  registerStaleMeetingSweeperJob();
};
