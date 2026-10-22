import {
  hasAttributionSource,
  type AttributionTouch,
} from "./attribution-source.js";

/**
 * The durable copy of first touch. Our server sets it, because Safari caps
 * cookies written by page JavaScript at seven days; the browser's own `an_ft`
 * cookie and localStorage copy stay the immediate, 30-day copies. Signup and
 * the browser both pick between the copies with `preferFirstTouch`, so they
 * agree on which visit is first touch.
 */
export const FIRST_TOUCH_SERVER_COOKIE_NAME = "an_fts";
export const FIRST_TOUCH_SERVER_COOKIE_VERSION = "1";
export const FIRST_TOUCH_SERVER_PATH = "/_agent-native/auth/attribution";
/** Counted from the first visit, never extended by later ones. */
export const FIRST_TOUCH_SERVER_LIFETIME_SECONDS = 365 * 24 * 60 * 60;
/** `name=value` budget, so this and the browser's cookies fit one header. */
export const FIRST_TOUCH_SERVER_COOKIE_MAX_BYTES = 1500;

export interface TimedFirstTouch extends AttributionTouch {
  landed_at?: string;
}

// A record with no readable visit time was trimmed to fit its cookie, so it
// was stored before any dated record it is compared with.
function landedAtMs(touch: TimedFirstTouch): number {
  const time = Date.parse(touch.landed_at ?? "");
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/**
 * Which of two records is first touch: the first visit that had a source,
 * else the first visit. `incumbent` wins a tie, so a copy never displaces the
 * value it came from.
 */
export function preferFirstTouch<T extends TimedFirstTouch>(
  incumbent: T | null | undefined,
  challenger: T | null | undefined,
): T | null {
  if (!incumbent) return challenger ?? null;
  if (!challenger) return incumbent;
  const incumbentSourced = hasAttributionSource(incumbent);
  if (incumbentSourced !== hasAttributionSource(challenger)) {
    return incumbentSourced ? incumbent : challenger;
  }
  return landedAtMs(challenger) < landedAtMs(incumbent)
    ? challenger
    : incumbent;
}

/** Whether two records are the same visit, however each copy was trimmed. */
export function isSameFirstTouch(
  a: TimedFirstTouch | null | undefined,
  b: TimedFirstTouch | null | undefined,
): boolean {
  return !!a?.landed_at && a.landed_at === b?.landed_at;
}

/**
 * When the durable copy expires: a year after the visit, or `null` once that
 * year is over. A missing or future visit time counts from now.
 */
export function firstTouchServerExpiry(
  touch: TimedFirstTouch,
  now = Date.now(),
): Date | null {
  const landed = Date.parse(touch.landed_at ?? "");
  const start = Number.isFinite(landed) && landed <= now ? landed : now;
  const expires = start + FIRST_TOUCH_SERVER_LIFETIME_SECONDS * 1000;
  return expires > now ? new Date(expires) : null;
}
