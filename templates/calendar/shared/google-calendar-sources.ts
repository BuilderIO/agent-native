export interface GoogleCalendarSourceIdentity {
  accountEmail: string;
  calendarId: string;
}

export interface GoogleAccountEventIdentity {
  accountEmail: string;
  googleEventId: string;
}

const GOOGLE_ACCOUNT_EVENT_PREFIX = "google-account-event:";

export function createGoogleAccountEventId({
  accountEmail,
  googleEventId,
}: GoogleAccountEventIdentity): string {
  return `${GOOGLE_ACCOUNT_EVENT_PREFIX}${Buffer.from(
    JSON.stringify([accountEmail.trim().toLowerCase(), googleEventId]),
  ).toString("base64url")}`;
}

export function parseGoogleAccountEventId(
  id: string,
): GoogleAccountEventIdentity | null {
  if (!id.startsWith(GOOGLE_ACCOUNT_EVENT_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(
        id.slice(GOOGLE_ACCOUNT_EVENT_PREFIX.length),
        "base64url",
      ).toString("utf8"),
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
      googleEventId: parsed[1],
    };
  } catch {
    // coercion-ok: malformed opaque input is a typed invalid-id result.
    return null;
  }
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

/** A stable client identity for one provider calendar across account paths. */
export function createGoogleCalendarCanonicalKey(calendarId: string): string {
  return `google-calendar-canonical:${Buffer.from(
    JSON.stringify([calendarId]),
  ).toString("base64url")}`;
}
