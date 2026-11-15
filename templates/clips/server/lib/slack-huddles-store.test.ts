import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { clearSlackUserCache, SlackTokenError } from "./slack-huddles.js";
import {
  fillMeetingsForHuddle,
  fillSlackHuddleParticipantsForMeeting,
  handleSlackHuddleEvent,
  HUDDLE_SWEEP_WINDOW_MS,
  storeSlackHuddleEvent,
  sweepRecentSlackHuddles,
  huddleParticipantId,
  insertHuddleParticipants,
  upsertSlackHuddle,
  type HuddleDb,
  type HuddleDeps,
} from "./slack-huddles-store.js";

// Mirrors migrations v116 (slack_user_connections, slack_huddles) and the
// clips_meetings / meeting_participants columns the store reads, in
// server/plugins/db.ts.
const DDL = `
  CREATE TABLE clips_meetings (
    id TEXT PRIMARY KEY,
    organization_id TEXT,
    title TEXT NOT NULL DEFAULT 'Untitled meeting',
    scheduled_start TEXT,
    scheduled_end TEXT,
    actual_start TEXT,
    actual_end TEXT,
    capture_stop_revision INTEGER NOT NULL DEFAULT 0,
    end_reason TEXT,
    platform TEXT NOT NULL DEFAULT 'adhoc',
    join_url TEXT,
    calendar_event_id TEXT,
    recording_id TEXT,
    source TEXT NOT NULL DEFAULT 'adhoc',
    trashed_at TEXT,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  );
  CREATE TABLE meeting_participants (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    is_organizer BOOLEAN NOT NULL DEFAULT FALSE,
    attended_at TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE slack_user_connections (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    team_id TEXT NOT NULL,
    team_name TEXT,
    slack_user_id TEXT NOT NULL,
    token_secret_ref TEXT NOT NULL,
    scope TEXT,
    status TEXT NOT NULL DEFAULT 'connected',
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE UNIQUE INDEX slack_user_connections_team_user_unique_idx ON slack_user_connections (team_id, slack_user_id);
  CREATE TABLE slack_huddles (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_ts TEXT NOT NULL,
    date_start BIGINT NOT NULL,
    date_end BIGINT,
    started_by TEXT,
    participant_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE UNIQUE INDEX slack_huddles_message_unique_idx ON slack_huddles (team_id, channel_id, message_ts);
`;

const PEOPLE: Record<string, { name: string; email?: string }> = {
  U0OWNER: { name: "Nevil", email: "nevil@example.test" },
  U0ANNA: { name: "Anna", email: "anna@example.test" },
  U0BOB: { name: "Bob", email: "bob@example.test" },
  U0CARL: { name: "Carl", email: "carl@example.test" },
  U0DANA: { name: "Dana", email: "dana@example.test" },
};

function huddleEvent(options: {
  subtype?: "huddle_thread" | "message_changed";
  dateEnd?: number;
  history: string[];
}) {
  const message = {
    type: "message",
    subtype: "huddle_thread",
    user: "U0OWNER",
    ts: "1794473298.000100",
    room: {
      created_by: "U0OWNER",
      date_start: 1794473298,
      date_end: options.dateEnd ?? 0,
      participants: [],
      participant_history: options.history,
    },
  };
  return {
    type: "event_callback",
    team_id: "T0TEAM",
    event:
      options.subtype === "message_changed"
        ? {
            type: "message",
            subtype: "message_changed",
            channel: "C0CGLR8LS6P",
            message,
          }
        : { ...message, channel: "C0CGLR8LS6P" },
  };
}

let client: PGlite;
let db: HuddleDb;
let fetchImpl: ReturnType<typeof vi.fn>;
let deps: HuddleDeps;

async function rows<T>(query: string): Promise<T[]> {
  return (await client.query<T>(query)).rows;
}

// One database for the file (PGlite takes seconds to start), emptied per test.
beforeAll(async () => {
  client = await PGlite.create("memory://");
  await client.exec(DDL);
  db = drizzle(client) as unknown as HuddleDb;
}, 30_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  clearSlackUserCache();
  await client.exec(`
    DELETE FROM clips_meetings;
    DELETE FROM meeting_participants;
    DELETE FROM slack_user_connections;
    DELETE FROM slack_huddles;
    INSERT INTO clips_meetings (id, actual_start, actual_end, platform, source, owner_email)
    VALUES ('huddle-meeting', '2026-11-12T08:48:28.000Z', '2026-11-12T09:21:02.000Z', 'slack', 'adhoc', 'Nevil@Example.test'),
           ('zoom-meeting', '2026-11-12T08:48:20.000Z', NULL, 'zoom', 'adhoc', 'nevil@example.test');
    INSERT INTO slack_user_connections (id, owner_email, team_id, slack_user_id, token_secret_ref)
    VALUES ('conn-1', 'nevil@example.test', 'T0TEAM', 'U0OWNER', 'secret-ref');
  `);
  fetchImpl = vi.fn(async (url: string) => {
    const id = new URL(url).searchParams.get("user") ?? "";
    const person = PEOPLE[id];
    return new Response(
      JSON.stringify(
        person
          ? {
              ok: true,
              user: {
                id,
                profile: { real_name: person.name, email: person.email },
              },
            }
          : { ok: false, error: "user_not_found" },
      ),
    );
  });
  deps = {
    db,
    readToken: async () => "xoxp-test",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  };
});

type ParticipantRow = { email: string; name: string; is_organizer: boolean };

async function participants(meetingId = "huddle-meeting") {
  return rows<ParticipantRow>(
    `SELECT email, name, is_organizer FROM meeting_participants WHERE meeting_id = '${meetingId}' ORDER BY email`,
  );
}

describe("handleSlackHuddleEvent", () => {
  it("fills the matching Slack meeting, once, and adds late joiners on the edit", async () => {
    const first = huddleEvent({
      history: ["U0OWNER", "U0ANNA", "U0BOB", "U0CARL"],
    });
    expect(await handleSlackHuddleEvent(deps, first)).toEqual({
      huddle: true,
      filled: 4,
      pending: 0,
    });
    expect(await handleSlackHuddleEvent(deps, first)).toEqual({
      huddle: true,
      filled: 0,
      pending: 0,
    });

    const ended = huddleEvent({
      subtype: "message_changed",
      dateEnd: 1794475234,
      history: ["U0OWNER", "U0DANA"],
    });
    expect(await handleSlackHuddleEvent(deps, ended)).toEqual({
      huddle: true,
      filled: 1,
      pending: 0,
    });

    expect(await participants()).toEqual([
      { email: "anna@example.test", name: "Anna", is_organizer: false },
      { email: "bob@example.test", name: "Bob", is_organizer: false },
      { email: "carl@example.test", name: "Carl", is_organizer: false },
      { email: "dana@example.test", name: "Dana", is_organizer: false },
      { email: "nevil@example.test", name: "Nevil", is_organizer: true },
    ]);
    expect(await participants("zoom-meeting")).toEqual([]);

    const [stored] = await rows<{
      date_end: string;
      participant_ids_json: string;
    }>(`SELECT date_end, participant_ids_json FROM slack_huddles`);
    expect(Number(stored.date_end)).toBe(1794475234);
    expect(JSON.parse(stored.participant_ids_json)).toEqual([
      "U0OWNER",
      "U0ANNA",
      "U0BOB",
      "U0CARL",
      "U0DANA",
    ]);
  });

  it("stores nothing for a huddle without a connected participant", async () => {
    const result = await handleSlackHuddleEvent(
      deps,
      huddleEvent({ history: ["U0ANNA", "U0BOB"] }),
    );
    expect(result).toEqual({ huddle: true, filled: 0, pending: 0 });
    expect(await rows(`SELECT id FROM slack_huddles`)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignores a message that is not a huddle", async () => {
    const result = await handleSlackHuddleEvent(deps, {
      type: "event_callback",
      team_id: "T0TEAM",
      event: {
        type: "message",
        channel: "C1",
        user: "U0OWNER",
        ts: "1.1",
        text: "hi",
      },
    });
    expect(result).toEqual({ huddle: false, filled: 0, pending: 0 });
  });

  it("marks the connection failed when Slack revoked the token", async () => {
    fetchImpl.mockImplementation(
      async () =>
        new Response(JSON.stringify({ ok: false, error: "token_revoked" })),
    );
    await handleSlackHuddleEvent(
      deps,
      huddleEvent({ history: ["U0OWNER", "U0ANNA"] }),
    );
    expect(await participants()).toEqual([]);
    expect(
      await rows(`SELECT status, last_error FROM slack_user_connections`),
    ).toEqual([{ status: "error", last_error: "token_revoked" }]);
  });
});

describe("handleSlackHuddleEvent failures", () => {
  it("keeps the people Slack described when one lookup fails, and a later fill adds the rest", async () => {
    let limited = true;
    const answer = fetchImpl.getMockImplementation() as (
      url: string,
    ) => Promise<Response>;
    fetchImpl.mockImplementation(async (url: string) => {
      if (limited && new URL(url).searchParams.get("user") === "U0BOB") {
        return new Response(
          JSON.stringify({ ok: false, error: "ratelimited" }),
          { status: 429 },
        );
      }
      return answer(url);
    });
    const event = huddleEvent({ history: ["U0OWNER", "U0ANNA", "U0BOB"] });

    expect(await handleSlackHuddleEvent(deps, event)).toEqual({
      huddle: true,
      filled: 2,
      pending: 1,
    });
    expect((await participants()).map((p) => p.email)).toEqual([
      "anna@example.test",
      "nevil@example.test",
    ]);
    expect(await rows(`SELECT status FROM slack_user_connections`)).toEqual([
      { status: "connected" },
    ]);

    limited = false;
    expect(await handleSlackHuddleEvent(deps, event)).toEqual({
      huddle: true,
      filled: 1,
      pending: 0,
    });
  });

  it("keeps the connection when the token cannot be read right now", async () => {
    deps.readToken = async () => {
      throw new Error("secret store unavailable");
    };
    await expect(
      handleSlackHuddleEvent(
        deps,
        huddleEvent({ history: ["U0OWNER", "U0ANNA"] }),
      ),
    ).rejects.toThrow("secret store unavailable");
    expect(
      await rows(`SELECT status, last_error FROM slack_user_connections`),
    ).toEqual([{ status: "connected", last_error: null }]);
  });

  it("marks the connection failed when the token can never be decrypted", async () => {
    deps.readToken = async () => {
      throw new SlackTokenError("token_unreadable");
    };
    await handleSlackHuddleEvent(
      deps,
      huddleEvent({ history: ["U0OWNER", "U0ANNA"] }),
    );
    expect(
      await rows(`SELECT status, last_error FROM slack_user_connections`),
    ).toEqual([{ status: "error", last_error: "token_unreadable" }]);
  });

  it("marks the connection failed only when the token is really gone", async () => {
    deps.readToken = async () => null;
    await handleSlackHuddleEvent(
      deps,
      huddleEvent({ history: ["U0OWNER", "U0ANNA"] }),
    );
    expect(
      await rows(`SELECT status, last_error FROM slack_user_connections`),
    ).toEqual([{ status: "error", last_error: "token_missing" }]);
  });

  it("looks people up in parallel, a bounded number at a time", async () => {
    const ids = Array.from(
      { length: 20 },
      (_, i) => `U0P${String(i).padStart(2, "0")}`,
    );
    let inFlight = 0;
    let maxInFlight = 0;
    fetchImpl.mockImplementation(async (url: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      const id = new URL(url).searchParams.get("user") ?? "";
      return new Response(
        JSON.stringify({
          ok: true,
          user: {
            id,
            profile: {
              real_name: id,
              email: `${id.toLowerCase()}@example.test`,
            },
          },
        }),
      );
    });
    const result = await handleSlackHuddleEvent(
      deps,
      huddleEvent({ history: ["U0OWNER", ...ids] }),
    );
    expect(result.filled).toBe(21);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(8);
  });
});

describe("huddle participants reported after the meeting was shared", () => {
  it("hands every huddle e-mail to the share hook, also when a retry adds no rows", async () => {
    const shared: Array<{ meetingId: string; emails: string[] }> = [];
    deps.onHuddleParticipants = async (meetingId, emails) => {
      shared.push({ meetingId, emails: [...emails].sort() });
    };
    const ended = huddleEvent({
      subtype: "message_changed",
      dateEnd: 1794475234,
      history: ["U0OWNER", "U0ANNA", "U0DANA"],
    });
    await handleSlackHuddleEvent(deps, ended);
    await handleSlackHuddleEvent(deps, ended);
    const expected = {
      meetingId: "huddle-meeting",
      emails: ["anna@example.test", "dana@example.test", "nevil@example.test"],
    };
    expect(shared).toEqual([expected, expected]);
  });

  it("fails the event when sharing fails, so Slack retries it", async () => {
    deps.onHuddleParticipants = async () => {
      throw new Error("share failed");
    };
    await expect(
      handleSlackHuddleEvent(
        deps,
        huddleEvent({ history: ["U0OWNER", "U0ANNA"] }),
      ),
    ).rejects.toThrow("share failed");
  });
});

describe("storeSlackHuddleEvent + sweepRecentSlackHuddles", () => {
  it("stores the huddle without calling Slack, and the sweep fills it later", async () => {
    const event = huddleEvent({ history: ["U0OWNER", "U0ANNA"] });
    const stored = await storeSlackHuddleEvent(deps, event);
    expect(stored?.participantIds).toEqual(["U0OWNER", "U0ANNA"]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await participants()).toEqual([]);

    const swept = await sweepRecentSlackHuddles(deps);
    expect(swept).toMatchObject({
      huddles: 1,
      filled: 2,
      pending: 0,
      failed: 0,
    });
    expect((await participants()).map((p) => p.email)).toEqual([
      "anna@example.test",
      "nevil@example.test",
    ]);
  });

  it("retries a fill that failed after the webhook answered", async () => {
    const event = huddleEvent({ history: ["U0OWNER", "U0ANNA"] });
    const huddle = await storeSlackHuddleEvent(deps, event);
    const failing = {
      ...deps,
      readToken: async () => {
        throw new Error("secret store unavailable");
      },
    };
    await expect(fillMeetingsForHuddle(failing, huddle!)).rejects.toThrow(
      "secret store unavailable",
    );
    expect(await sweepRecentSlackHuddles(failing)).toMatchObject({
      huddles: 1,
      failed: 1,
    });
    expect(await participants()).toEqual([]);

    expect(await sweepRecentSlackHuddles(deps)).toMatchObject({
      filled: 2,
      failed: 0,
    });
  });

  it("leaves huddles older than the sweep window alone", async () => {
    await storeSlackHuddleEvent(deps, huddleEvent({ history: ["U0OWNER"] }));
    const later = Date.now() + HUDDLE_SWEEP_WINDOW_MS + 60_000;
    expect(await sweepRecentSlackHuddles(deps, later)).toMatchObject({
      huddles: 0,
    });
  });
});

describe("fillSlackHuddleParticipantsForMeeting", () => {
  it("adds the people Slack described at stop, and the sweep adds the rest", async () => {
    await client.exec(`
      INSERT INTO slack_huddles (id, team_id, channel_id, message_ts, date_start, date_end, started_by, participant_ids_json, updated_at)
      VALUES ('h1', 'T0TEAM', 'C0CGLR8LS6P', '1794473298.000100', 1794473298, 1794475234, 'U0OWNER', '["U0OWNER","U0ANNA","U0BOB"]', '${new Date().toISOString()}');
    `);
    let limited = true;
    const answer = fetchImpl.getMockImplementation() as (
      url: string,
    ) => Promise<Response>;
    fetchImpl.mockImplementation(async (url: string) =>
      limited && new URL(url).searchParams.get("user") === "U0BOB"
        ? new Response("upstream error", { status: 503 })
        : answer(url),
    );

    expect(
      await fillSlackHuddleParticipantsForMeeting(deps, "huddle-meeting"),
    ).toBe(2);
    limited = false;
    expect(await sweepRecentSlackHuddles(deps)).toMatchObject({ filled: 1 });
    expect((await participants()).map((p) => p.email)).toEqual([
      "anna@example.test",
      "bob@example.test",
      "nevil@example.test",
    ]);
  });

  it("fills a stopped Slack meeting from a huddle stored earlier, idempotently", async () => {
    await client.exec(`
      INSERT INTO slack_huddles (id, team_id, channel_id, message_ts, date_start, date_end, started_by, participant_ids_json)
      VALUES ('h1', 'T0TEAM', 'C0CGLR8LS6P', '1794473298.000100', 1794473298, 1794475234, 'U0OWNER', '["U0OWNER","U0ANNA"]');
    `);
    expect(
      await fillSlackHuddleParticipantsForMeeting(deps, "huddle-meeting"),
    ).toBe(2);
    expect(
      await fillSlackHuddleParticipantsForMeeting(deps, "huddle-meeting"),
    ).toBe(0);
    expect((await participants()).map((p) => p.email)).toEqual([
      "anna@example.test",
      "nevil@example.test",
    ]);
  });

  it("leaves a meeting that is not an adhoc Slack meeting alone", async () => {
    expect(
      await fillSlackHuddleParticipantsForMeeting(deps, "zoom-meeting"),
    ).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("insertHuddleParticipants", () => {
  it("never duplicates a participant, also when two fills race", async () => {
    const options = {
      meetingId: "huddle-meeting",
      huddle: { dateStart: 1794473298, startedBy: "U0OWNER" },
      people: [
        { slackUserId: "U0ANNA", name: "Anna", email: "anna@example.test" },
      ],
    };
    const counts = await Promise.all([
      insertHuddleParticipants(db, options),
      insertHuddleParticipants(db, options),
    ]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await rows(`SELECT id FROM meeting_participants`)).toEqual([
      { id: huddleParticipantId("huddle-meeting", "anna@example.test") },
    ]);
  });

  it("keeps a participant the calendar or bot already added", async () => {
    await client.exec(
      `INSERT INTO meeting_participants (id, meeting_id, email, name) VALUES ('cal-1', 'huddle-meeting', 'Anna@Example.test', 'Anna (calendar)')`,
    );
    const added = await insertHuddleParticipants(db, {
      meetingId: "huddle-meeting",
      huddle: { dateStart: 1794473298, startedBy: null },
      people: [
        { slackUserId: "U0ANNA", name: "Anna", email: "anna@example.test" },
      ],
    });
    expect(added).toBe(0);
    expect(await rows(`SELECT id, name FROM meeting_participants`)).toEqual([
      { id: "cal-1", name: "Anna (calendar)" },
    ]);
  });
});

describe("upsertSlackHuddle", () => {
  it("keeps both writes when the first message and its edit arrive at once", async () => {
    const base = {
      teamId: "T0TEAM",
      channelId: "C0CHAN",
      messageTs: "1794473298.000100",
      dateStart: 1794473298,
      startedBy: "U0OWNER",
    };
    await Promise.all([
      upsertSlackHuddle(db, {
        ...base,
        dateEnd: null,
        participantIds: ["U0OWNER", "U0ALICE"],
      }),
      upsertSlackHuddle(db, {
        ...base,
        dateEnd: 1794475234,
        participantIds: ["U0OWNER", "U0BOB"],
      }),
    ]);
    const [row] = await rows<{
      date_end: string | null;
      participant_ids_json: string;
    }>("SELECT date_end, participant_ids_json FROM slack_huddles");
    expect(Number(row.date_end)).toBe(1794475234);
    expect(JSON.parse(row.participant_ids_json).sort()).toEqual([
      "U0ALICE",
      "U0BOB",
      "U0OWNER",
    ]);
  });
});
