/**
 * A mailbox copy sync gave up because the draft kept changing while it ran.
 * Each save that changed the draft syncs the copy after it, so the copy catches
 * up on its own and nothing failed that the person needs to hear about.
 */
export const DRAFT_MAILBOX_BUSY_ERROR_CODE = "draft_mailbox_busy";
