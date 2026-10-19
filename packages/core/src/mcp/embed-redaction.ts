/**
 * What MCP results redact before a model or client sees them. The redaction
 * itself runs in `build-server.ts`; an opted-in action's advertised output
 * contract is derived through the same rules (`action-output-contract.ts`),
 * so both read them from here.
 */

/** Replaces an embed start URL that cannot simply be dropped (an array item). */
export const HIDDEN_EMBED_URL = "[hidden embed URL]";

/** Replaces a value already being serialized higher up the same result. */
export const CIRCULAR_RESULT = "[circular result]";

/** Keys removed from every result object, whatever their value. */
export const EMBED_RESULT_SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "embedTargetPath",
  "embedExpiresAt",
  "embedTicket",
]);

/** Keys removed from an object that carries an embed routing signal. */
export function isEmbedCredentialKey(key: string): boolean {
  return key === "ticket" || /Ticket$/.test(key);
}

export function isEmbedStartUrl(value: string): boolean {
  try {
    const base = "http://agent-native.invalid";
    const url = value.startsWith("/") ? new URL(value, base) : new URL(value);
    return url.pathname.includes("/_agent-native/embed/start");
  } catch {
    return value.includes("/_agent-native/embed/start");
  }
}
