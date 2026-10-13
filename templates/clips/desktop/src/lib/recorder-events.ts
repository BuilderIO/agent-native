/**
 * Deletes the active recording. Only the recording toolbar emits it, after
 * its "Discard …?" confirmation. `clips:recorder-cancel` (the global cancel
 * shortcut) asks the toolbar for that confirmation instead, and cancels
 * directly only while nothing has been recorded yet.
 */
export const RECORDER_DISCARD_EVENT = "clips:recorder-discard";
