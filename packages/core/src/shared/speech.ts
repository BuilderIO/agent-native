/**
 * Limits the speech route and its client must agree on.
 *
 * Shared rather than duplicated because the client chunks a long script to fit
 * and the server rejects one that does not: two copies of this number means one
 * side silently sends what the other refuses.
 */

/** The provider's documented `input` ceiling for one synthesis request. */
export const SPEECH_MAX_CHARS = 4096;

/** Delivery direction, not content: a script belongs in `text`. */
export const SPEECH_MAX_INSTRUCTION_CHARS = 1_000;

/**
 * Byte ceiling for one request body, checked before it is parsed. Four bytes
 * per character covers the widest UTF-8 code point plus JSON escaping, so a
 * body inside this can still carry a full-length script and instructions.
 */
export const SPEECH_MAX_BODY_BYTES =
  (SPEECH_MAX_CHARS + SPEECH_MAX_INSTRUCTION_CHARS) * 4 + 1_024;
