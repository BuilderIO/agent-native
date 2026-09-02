export interface GoogleCalendarSourceIdentity {
  accountEmail: string;
  calendarId: string;
}

/**
 * Calendar ids are provider data and may contain separators, so encode the
 * complete identity rather than joining two user-controlled strings.
 */
export function createGoogleCalendarSourceKey({
  accountEmail,
  calendarId,
}: GoogleCalendarSourceIdentity): string {
  return `google-calendar:${Buffer.from(
    JSON.stringify([accountEmail.trim().toLowerCase(), calendarId]),
  ).toString("base64url")}`;
}

export function parseGoogleCalendarSourceKey(
  sourceKey: string,
): GoogleCalendarSourceIdentity | null {
  const prefix = "google-calendar:";
  if (!sourceKey.startsWith(prefix)) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(sourceKey.slice(prefix.length), "base64url").toString("utf8"),
    );
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "string" ||
      typeof parsed[1] !== "string" ||
      !parsed[0].trim() ||
      !parsed[1]
    ) {
      return null;
    }
    return {
      accountEmail: parsed[0].trim().toLowerCase(),
      calendarId: parsed[1],
    };
  } catch {
    // coercion-ok: malformed opaque input is a typed invalid-key result.
    return null;
  }
}
