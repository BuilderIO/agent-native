import { getDbExec } from "../db/client.js";

/**
 * First-touch marketing parameters persisted on the Better Auth `user` row at
 * signup, so retention and acquisition can be joined to the account itself
 * instead of only to a buffered analytics event. These are campaign tags and
 * a referring host, never an email, name, or full referring URL.
 *
 * The columns are deliberately absent from the Better Auth Drizzle schema:
 * its adapter selects every declared column, and a deploy that reaches a
 * database before this migration would otherwise break every sign-in.
 */
const USER_FIRST_TOUCH_COLUMNS = {
  utm_source: "first_touch_utm_source",
  utm_medium: "first_touch_utm_medium",
  utm_campaign: "first_touch_utm_campaign",
  utm_term: "first_touch_utm_term",
  gclid: "first_touch_gclid",
  msclkid: "first_touch_msclkid",
  vector_source: "first_touch_vector_source",
  landing_referrer: "first_touch_referrer",
} as const;

const MAX_FIRST_TOUCH_VALUE_CHARS = 120;

export function userFirstTouchColumnValues(
  attribution: Record<string, string | undefined> | undefined,
): Array<[column: string, value: string]> {
  if (!attribution) return [];
  return Object.entries(USER_FIRST_TOUCH_COLUMNS).flatMap(([key, column]) => {
    const value = attribution[key]
      ?.trim()
      .slice(0, MAX_FIRST_TOUCH_VALUE_CHARS);
    return value ? [[column, value] as [string, string]] : [];
  });
}

/** First touch wins: a value already on the row is never overwritten. */
export async function persistUserFirstTouchAttribution(
  userId: string,
  attribution: Record<string, string | undefined> | undefined,
  exec: Pick<ReturnType<typeof getDbExec>, "execute"> = getDbExec(),
): Promise<boolean> {
  const values = userFirstTouchColumnValues(attribution);
  if (values.length === 0) return false;
  await exec.execute({
    sql: `UPDATE "user" SET ${values
      .map(([column]) => `"${column}" = COALESCE("${column}", ?)`)
      .join(", ")} WHERE id = ?`,
    args: [...values.map(([, value]) => value), userId],
  });
  return true;
}
