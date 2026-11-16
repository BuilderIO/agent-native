/**
 * The sentence a person reads when a form does not parse.
 *
 * Every rule in an app's schemas should carry its own copy. A library default
 * ("Too big: expected string to have <=100 characters", "Invalid input:
 * expected string, received number") is never UI copy, so it must never reach
 * the screen: a rule that still lacks a message falls back to the sentence the
 * caller passes. Several app forms shipped this same leak on their own, so the
 * guard lives here once.
 */
const LIBRARY_DEFAULT =
  /^(?:required$|invalid\b|too (?:small|big)\b|unrecognized key\b|expected\b)/i;

export interface IssueLike {
  message?: string | undefined;
}

/** True when a message is a library's own text rather than somebody's copy. */
export function isLibraryDefaultMessage(message: string | undefined): boolean {
  return !message || LIBRARY_DEFAULT.test(message.trim());
}

/**
 * The first issue's message when the schema author wrote it, else the caller's
 * fallback. Never returns a library default.
 */
export function firstSchemaMessage(
  issues: readonly IssueLike[] | null | undefined,
  fallback: string,
): string {
  const message = issues?.[0]?.message?.trim();
  if (!message || LIBRARY_DEFAULT.test(message)) return fallback;
  return message;
}
