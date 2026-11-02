import registerBrainExportJob from "../jobs/brain-export.js";
import registerBuilderMediaCompressionJob from "../jobs/builder-media-compression.js";
import registerDiagnosticContextCleanup from "../jobs/diagnostic-context-cleanup.js";
import registerMediaVerificationJob from "../jobs/media-verification.js";
import registerMeetingRemindersJob from "../jobs/meeting-reminders.js";
import registerPollCalendarsJob from "../jobs/poll-calendars.js";
import registerRecordingFailureBackfillJob from "../jobs/recording-failure-backfill.js";
import registerStaleMeetingSweeperJob from "../jobs/stale-meeting-sweeper.js";
import registerThumbnailSweeperJob from "../jobs/thumbnail-sweeper.js";
import registerTransactionalEmailsJob from "../jobs/transactional-emails.js";

export default () => {
  registerDiagnosticContextCleanup();
  registerMeetingRemindersJob();
  registerBuilderMediaCompressionJob();
  registerBrainExportJob();
  registerMediaVerificationJob();
  registerPollCalendarsJob();
  registerRecordingFailureBackfillJob();
  registerStaleMeetingSweeperJob();
  registerThumbnailSweeperJob();
  registerTransactionalEmailsJob();
};
