/**
 * A mailbox copy sync gave up because the draft kept changing while it ran.
 * Each save that changed the draft syncs the copy after it, so the copy catches
 * up on its own and nothing failed that the person needs to hear about.
 */
export const DRAFT_MAILBOX_BUSY_ERROR_CODE = "draft_mailbox_busy";

/**
 * Gmail kept a save of the draft, but Mail couldn't confirm where the save
 * moved the draft's Gmail files. The draft names Gmail's draft by its real ID,
 * and the next save finds the files again.
 */
export const DRAFT_ATTACHMENTS_UNCONFIRMED_ERROR_CODE =
  "draft_attachments_unconfirmed";
