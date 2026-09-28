/**
 * Credentials that are stored under more than one key name.
 *
 * Google Gemini is the one today: chat models always read
 * `GOOGLE_GENERATIVE_AI_API_KEY` (the AI SDK's name), while voice input,
 * embeddings, and image generation historically read `GEMINI_API_KEY`. Both
 * names hold the same Google AI Studio key, so every reader accepts either
 * and every writer uses the canonical name. Rows saved under the legacy name
 * keep working; nothing is moved or rewritten.
 *
 * Free of runtime imports so client code and boot-time registrations can use
 * it. The resolvers live in `server/secret-key-aliases.ts`.
 */

/** The one Gemini key name Settings registers and writes. */
export const GEMINI_API_KEY = "GOOGLE_GENERATIVE_AI_API_KEY";
/** Older name still read, never written. */
export const LEGACY_GEMINI_API_KEY = "GEMINI_API_KEY";

const SECRET_KEY_ALIASES: ReadonlyArray<readonly [string, ...string[]]> = [
  [GEMINI_API_KEY, LEGACY_GEMINI_API_KEY],
];

/**
 * Every stored name `key` answers to, canonical first. A key without aliases
 * returns just itself.
 */
export function secretKeyNames(key: string): readonly string[] {
  return SECRET_KEY_ALIASES.find((names) => names.includes(key)) ?? [key];
}

/** The name new rows for `key` are written under. */
export function canonicalSecretKey(key: string): string {
  return secretKeyNames(key)[0];
}
