/**
 * Who was in a recorded Slack huddle.
 *
 * Slack posts a message with subtype `huddle_thread` in the channel or DM
 * where a huddle runs, and edits it (`message_changed`) while people join and
 * when it ends. Its `room` carries the start and end time and every user who
 * was ever in the huddle (`participant_history`). A connected user's message
 * events bring that message to Clips; this module reads it, picks the Clips
 * meeting it belongs to, and turns Slack users into meeting participants.
 *
 * Everything here is pure or takes its fetch as an argument, so it is tested
 * without a database or Slack. The database side is slack-huddles-store.ts.
 */

/** Slack user scopes "Connect Slack for huddles" asks for. */
export const SLACK_HUDDLE_USER_SCOPES = [
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "users:read",
  "users:read.email",
] as const;

/** A huddle starts within this long of the Clips meeting it was recorded in. */
export const HUDDLE_START_MATCH_WINDOW_MS = 2 * 60 * 1000;

/**
 * A meeting that starts later than the huddle (the owner joined a huddle that
 * was already running) still matches while the huddle runs, but never a
 * huddle that started longer ago than this: its end event may have been lost.
 */
export const HUDDLE_LATE_JOIN_MAX_MS = 12 * 60 * 60 * 1000;

export type SlackHuddle = {
  teamId: string;
  channelId: string;
  /** ts of the huddle_thread message: with team and channel, the huddle's id. */
  messageTs: string;
  /** Unix seconds. */
  dateStart: number;
  /** Unix seconds, null while the huddle runs. */
  dateEnd: number | null;
  startedBy: string | null;
  /** Everyone who was ever in the huddle, in Slack's order, no duplicates. */
  participantIds: string[];
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asUnixSeconds(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

const SLACK_USER_ID = /^[UW][A-Z0-9]{2,}$/;

function slackUserIds(...lists: unknown[]): string[] {
  const ids: string[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      if (typeof value === "string" && SLACK_USER_ID.test(value)) {
        if (!ids.includes(value)) ids.push(value);
      }
    }
  }
  return ids;
}

/** True for any Events API message event, huddle or not. */
export function isSlackMessageEventPayload(payload: unknown): boolean {
  const body = asRecord(payload);
  if (!body || body.type !== "event_callback") return false;
  return asRecord(body.event)?.type === "message";
}

/**
 * The huddle in a Slack Events API payload, or null when it is not a huddle
 * message. Reads both the first `huddle_thread` message and the
 * `message_changed` edits Slack sends while the huddle runs and when it ends.
 */
export function parseSlackHuddleEvent(payload: unknown): SlackHuddle | null {
  const body = asRecord(payload);
  if (!body || body.type !== "event_callback") return null;
  const event = asRecord(body.event);
  if (!event || event.type !== "message") return null;

  const message =
    event.subtype === "message_changed" ? asRecord(event.message) : event;
  if (!message || message.subtype !== "huddle_thread") return null;

  const room = asRecord(message.room);
  if (!room) return null;

  const teamId =
    asString(body.team_id) ?? asString(event.team) ?? asString(message.team);
  const channelId = asString(event.channel) ?? asString(message.channel);
  const messageTs = asString(message.ts);
  const dateStart = asUnixSeconds(room.date_start);
  if (!teamId || !channelId || !messageTs || !dateStart) return null;

  const dateEnd = asUnixSeconds(room.date_end);
  return {
    teamId,
    channelId,
    messageTs,
    dateStart,
    dateEnd: dateEnd && dateEnd >= dateStart ? dateEnd : null,
    startedBy: asString(room.created_by) ?? asString(message.user),
    participantIds: slackUserIds(room.participant_history, room.participants),
  };
}

/**
 * The same huddle seen twice (first message, then an edit): keep everyone
 * either one saw, the end once one has it, and the first starter.
 */
export function mergeSlackHuddles(
  existing: SlackHuddle,
  update: SlackHuddle,
): SlackHuddle {
  return {
    ...existing,
    dateStart: Math.min(existing.dateStart, update.dateStart),
    dateEnd: update.dateEnd ?? existing.dateEnd,
    startedBy: existing.startedBy ?? update.startedBy,
    participantIds: slackUserIds(existing.participantIds, update.participantIds),
  };
}

export type HuddleMatchMeeting = {
  /** ISO time the Clips recording of the meeting started. */
  actualStart: string;
};

type Ranked<T> = { huddle: T; exact: boolean; distanceMs: number };

function rankHuddle<T extends Pick<SlackHuddle, "dateStart" | "dateEnd" | "participantIds">>(
  huddle: T,
  meetingStartMs: number,
  slackUserId: string,
): Ranked<T> | null {
  if (!huddle.participantIds.includes(slackUserId)) return null;
  const startMs = huddle.dateStart * 1000;
  const diffMs = Math.abs(meetingStartMs - startMs);
  if (diffMs <= HUDDLE_START_MATCH_WINDOW_MS) {
    return { huddle, exact: true, distanceMs: diffMs };
  }
  // Joined a huddle that was already running: the meeting starts after the
  // huddle and before it ended.
  const lateMs = meetingStartMs - startMs;
  if (lateMs <= 0 || lateMs > HUDDLE_LATE_JOIN_MAX_MS) return null;
  if (
    huddle.dateEnd !== null &&
    meetingStartMs > huddle.dateEnd * 1000 + HUDDLE_START_MATCH_WINDOW_MS
  ) {
    return null;
  }
  return { huddle, exact: false, distanceMs: lateMs };
}

/**
 * The huddle a Clips meeting recorded, among the huddles this Slack user was
 * in. A huddle that started within two minutes of the recording wins; failing
 * that, the most recently started huddle that was still running when the
 * recording started (the owner joined late). Null when none fits.
 */
export function pickHuddleForMeeting<
  T extends Pick<SlackHuddle, "dateStart" | "dateEnd" | "participantIds">,
>(huddles: readonly T[], meeting: HuddleMatchMeeting, slackUserId: string): T | null {
  const meetingStartMs = Date.parse(meeting.actualStart);
  if (!Number.isFinite(meetingStartMs)) return null;

  let best: Ranked<T> | null = null;
  for (const huddle of huddles) {
    const ranked = rankHuddle(huddle, meetingStartMs, slackUserId);
    if (!ranked) continue;
    if (
      !best ||
      (ranked.exact && !best.exact) ||
      (ranked.exact === best.exact && ranked.distanceMs < best.distanceMs)
    ) {
      best = ranked;
    }
  }
  return best?.huddle ?? null;
}

export type SlackPerson = {
  slackUserId: string;
  name: string | null;
  email: string | null;
};

type CacheEntry = { person: SlackPerson | null; expiresAt: number };

const USER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const userCache = new Map<string, CacheEntry>();

/** Test hook: forget cached Slack users. */
export function clearSlackUserCache(): void {
  userCache.clear();
}

export class SlackTokenError extends Error {
  constructor(readonly slackError: string) {
    super(`Slack rejected the user token: ${slackError}`);
    this.name = "SlackTokenError";
  }
}

const TOKEN_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "missing_scope",
]);

/**
 * Name and e-mail for a Slack user from `users.info`, cached for six hours.
 * Null for bots, deleted users and users Slack will not describe. Throws
 * SlackTokenError when the token itself no longer works.
 */
export async function fetchSlackPerson(options: {
  token: string;
  teamId: string;
  slackUserId: string;
  fetchImpl?: typeof fetch;
  nowMs?: number;
}): Promise<SlackPerson | null> {
  const nowMs = options.nowMs ?? Date.now();
  const cacheKey = `${options.teamId}:${options.slackUserId}`;
  const cached = userCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) return cached.person;

  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `https://slack.com/api/users.info?user=${encodeURIComponent(options.slackUserId)}`;
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${options.token}` },
  });
  const body = asRecord(await response.json().catch(() => null));
  if (!body || body.ok !== true) {
    const error = asString(body?.error) ?? `http_${response.status}`;
    if (TOKEN_ERRORS.has(error)) throw new SlackTokenError(error);
    // user_not_found and friends: nothing to say about this user. Rate limits
    // and outages are not cached, so the next attempt asks again.
    if (error === "user_not_found" || error === "user_not_visible") {
      userCache.set(cacheKey, { person: null, expiresAt: nowMs + USER_CACHE_TTL_MS });
    }
    return null;
  }

  const user = asRecord(body.user);
  let person: SlackPerson | null = null;
  if (user && user.is_bot !== true && user.deleted !== true) {
    const profile = asRecord(user.profile);
    const email = asString(profile?.email)?.toLowerCase() ?? null;
    const name =
      asString(profile?.real_name) ??
      asString(user.real_name) ??
      asString(profile?.display_name) ??
      asString(user.name);
    person = { slackUserId: options.slackUserId, name, email };
  }
  userCache.set(cacheKey, { person, expiresAt: nowMs + USER_CACHE_TTL_MS });
  return person;
}

export type HuddleParticipantRow = {
  meetingId: string;
  email: string;
  name: string | null;
  isOrganizer: boolean;
  attendedAt: string;
};

/**
 * meeting_participants rows for the people of a huddle: one per e-mail, in
 * huddle order, skipping people without an e-mail (meeting_participants is
 * keyed by e-mail) and e-mails the meeting already lists.
 */
export function buildHuddleParticipantRows(options: {
  meetingId: string;
  huddle: Pick<SlackHuddle, "dateStart" | "startedBy">;
  people: readonly SlackPerson[];
  existingEmails: Iterable<string>;
}): HuddleParticipantRow[] {
  const seen = new Set(
    [...options.existingEmails].map((email) => email.trim().toLowerCase()),
  );
  const attendedAt = new Date(options.huddle.dateStart * 1000).toISOString();
  const rows: HuddleParticipantRow[] = [];
  for (const person of options.people) {
    const email = person.email?.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    rows.push({
      meetingId: options.meetingId,
      email,
      name: person.name,
      isOrganizer: person.slackUserId === options.huddle.startedBy,
      attendedAt,
    });
  }
  return rows;
}
