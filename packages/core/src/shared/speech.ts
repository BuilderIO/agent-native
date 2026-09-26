/**
 * Limits the speech route and its client must agree on.
 *
 * Shared rather than duplicated because the client chunks a long script to fit
 * and the server rejects one that does not: two copies of this number means one
 * side silently sends what the other refuses.
 */

/** The provider's documented `input` ceiling for one synthesis request. */
export const SPEECH_MAX_CHARS = 4096;
