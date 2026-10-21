import { isActionContractError } from "../action.js";
import {
  redactSensitiveFields,
  sanitizeToolErrorText,
} from "./tool-error-redaction.js";

/** Longest serialized `details` an agent sees with a failed action. */
export const MAX_AGENT_ERROR_DETAILS_CHARS = 2_000;

/** A top-level entry longer than this is left out once the whole set is too long. */
const MAX_KEPT_ENTRY_CHARS = 300;

const MAX_LISTED_OMITTED_KEYS = 10;

const MAX_OMITTED_KEY_CHARS = 60;

export interface AgentErrorDetails {
  /** The `details` a `fail()` attached, as the browser receives them, redacted and bounded. */
  details: Record<string, unknown>;
  /**
   * Top-level keys left out to stay within the bound, or because they don't
   * serialize: up to ten names, each clipped, with the full count beside them.
   */
  omittedKeys?: string[];
  omittedKeyCount?: number;
  /** The line a text-only tool result carries, so text clients see the same data. */
  line: string;
}

/**
 * The structured `details` of a failed action, in the form an agent reads.
 *
 * Only a contract error (`fail()`) carries details meant for the caller; the
 * HTTP action route already returns them to the browser, so an agent acting
 * for the same user gets the same object. Values go through a JSON round trip
 * first, so a `Date` reads as the browser would see it rather than as `{}`.
 * When the whole object is too long, small top-level entries are kept in
 * order and the rest are named in `omittedKeys`: a retry id must survive next
 * to a large payload, and a cut must never read as a complete object.
 */
export function agentErrorDetails(
  error: unknown,
): AgentErrorDetails | undefined {
  if (!isActionContractError(error)) return undefined;
  const raw = error.details;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const entries: Array<[string, unknown]> = [];
  const omittedKeys: string[] = [];
  for (const key of Object.keys(raw)) {
    const clean = jsonSafeEntry(raw, key);
    if (clean === UNSERIALIZABLE) omittedKeys.push(key);
    else if (clean !== undefined) entries.push([key, clean]);
  }

  const cleaned = Object.fromEntries(entries);
  let details = cleaned;
  if (JSON.stringify(cleaned).length > MAX_AGENT_ERROR_DETAILS_CHARS) {
    details = {};
    let budget = MAX_AGENT_ERROR_DETAILS_CHARS - 2;
    for (const [key, value] of entries) {
      const size = JSON.stringify({ [key]: value }).length - 1;
      if (size <= MAX_KEPT_ENTRY_CHARS && size <= budget) {
        details[key] = value;
        budget -= size;
      } else {
        omittedKeys.push(key);
      }
    }
  }
  if (Object.keys(details).length === 0 && omittedKeys.length === 0) {
    return undefined;
  }

  const listed = omittedKeys
    .slice(0, MAX_LISTED_OMITTED_KEYS)
    .map((key) =>
      key.length > MAX_OMITTED_KEY_CHARS
        ? `${key.slice(0, MAX_OMITTED_KEY_CHARS)}…`
        : key,
    );
  const more =
    omittedKeys.length > listed.length
      ? `, and ${omittedKeys.length - listed.length} more`
      : "";
  return {
    details,
    ...(omittedKeys.length > 0
      ? { omittedKeys: listed, omittedKeyCount: omittedKeys.length }
      : {}),
    line: `Error details${
      listed.length > 0 ? ` (omitted: ${listed.join(", ")}${more})` : ""
    }: ${JSON.stringify(details)}`,
  };
}

const UNSERIALIZABLE = Symbol("unserializable");

function jsonSafeEntry(raw: object, key: string): unknown {
  let parsed: unknown;
  try {
    // A getter can throw. Reading it here names the key; reading it outside
    // would replace the action's own error.
    const json = JSON.stringify((raw as Record<string, unknown>)[key]);
    if (json === undefined) return undefined;
    parsed = JSON.parse(json);
  } catch {
    return UNSERIALIZABLE;
  }
  const redacted = redactSensitiveFields(
    { [key]: parsed },
    { compoundNames: true },
  ) as Record<string, unknown>;
  return sanitizeStrings(redacted[key]);
}

function sanitizeStrings(value: unknown): unknown {
  if (typeof value === "string") return sanitizeToolErrorText(value);
  if (Array.isArray(value)) return value.map(sanitizeStrings);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizeStrings(entry),
      ]),
    );
  }
  return value;
}
