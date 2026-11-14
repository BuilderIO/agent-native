import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHuddleParticipantRows,
  clearSlackUserCache,
  fetchSlackPerson,
  isSlackMessageEventPayload,
  mergeSlackHuddles,
  parseSlackHuddleEvent,
  pickHuddleForMeeting,
  SlackTokenError,
  type SlackHuddle,
} from "./slack-huddles.js";

// Shaped like the real huddle of 12 Nov 2026 (channel C0CGLR8LS6P).
const ROOM = {
  id: "R0HUDDLE1",
  created_by: "U0OWNER",
  date_start: 1794473298,
  date_end: 0,
  participants: ["U0OWNER", "U0ANNA"],
  participant_history: ["U0OWNER", "U0ANNA", "U0BOB", "U0CARL"],
};

function huddleMessage(room: Record<string, unknown> = ROOM) {
  return {
    type: "event_callback",
    team_id: "T0TEAM",
    api_app_id: "A0APP",
    event: {
      type: "message",
      subtype: "huddle_thread",
      channel: "C0CGLR8LS6P",
      user: "U0OWNER",
      ts: "1794473298.000100",
      room,
    },
  };
}

function huddleEdit(room: Record<string, unknown>) {
  return {
    type: "event_callback",
    team_id: "T0TEAM",
    event: {
      type: "message",
      subtype: "message_changed",
      channel: "C0CGLR8LS6P",
      message: {
        type: "message",
        subtype: "huddle_thread",
        user: "U0OWNER",
        ts: "1794473298.000100",
        room,
      },
    },
  };
}

describe("parseSlackHuddleEvent", () => {
  it("reads a running huddle from its huddle_thread message", () => {
    expect(parseSlackHuddleEvent(huddleMessage())).toEqual({
      teamId: "T0TEAM",
      channelId: "C0CGLR8LS6P",
      messageTs: "1794473298.000100",
      dateStart: 1794473298,
      dateEnd: null,
      startedBy: "U0OWNER",
      participantIds: ["U0OWNER", "U0ANNA", "U0BOB", "U0CARL"],
    });
  });

  it("reads the end and late joiners from a message_changed edit", () => {
    const huddle = parseSlackHuddleEvent(
      huddleEdit({
        ...ROOM,
        date_end: 1794475234,
        participants: [],
        participant_history: ["U0OWNER", "U0ANNA", "U0DANA"],
      }),
    );
    expect(huddle?.messageTs).toBe("1794473298.000100");
    expect(huddle?.dateEnd).toBe(1794475234);
    expect(huddle?.participantIds).toEqual(["U0OWNER", "U0ANNA", "U0DANA"]);
  });

  it("ignores ordinary messages, edits of them and other events", () => {
    const plain = huddleMessage();
    delete (plain.event as { subtype?: string }).subtype;
    expect(parseSlackHuddleEvent(plain)).toBeNull();
    expect(
      parseSlackHuddleEvent({
        ...huddleEdit(ROOM),
        event: {
          type: "message",
          subtype: "message_changed",
          channel: "C1",
          message: { type: "message", ts: "1.2", text: "hi" },
        },
      }),
    ).toBeNull();
    expect(
      parseSlackHuddleEvent({ type: "event_callback", event: { type: "link_shared" } }),
    ).toBeNull();
    expect(parseSlackHuddleEvent({ type: "url_verification" })).toBeNull();
    expect(parseSlackHuddleEvent(null)).toBeNull();
  });

  it("drops a huddle without a start and ids that are not Slack users", () => {
    expect(
      parseSlackHuddleEvent(huddleMessage({ ...ROOM, date_start: 0 })),
    ).toBeNull();
    expect(
      parseSlackHuddleEvent(
        huddleMessage({ ...ROOM, participant_history: ["U0OWNER", "B0BOT", 7, "U0OWNER"] }),
      )?.participantIds,
    ).toEqual(["U0OWNER", "U0ANNA"]);
  });

  it("tells message events apart from link_shared", () => {
    expect(isSlackMessageEventPayload(huddleMessage())).toBe(true);
    expect(
      isSlackMessageEventPayload({
        type: "event_callback",
        event: { type: "link_shared" },
      }),
    ).toBe(false);
  });
});

describe("mergeSlackHuddles", () => {
  it("keeps everyone either message saw and the end once known", () => {
    const first = parseSlackHuddleEvent(huddleMessage())!;
    const edit = parseSlackHuddleEvent(
      huddleEdit({ ...ROOM, date_end: 1794475234, participant_history: ["U0EVE"] }),
    )!;
    const merged = mergeSlackHuddles(first, edit);
    expect(merged.dateEnd).toBe(1794475234);
    expect(merged.participantIds).toEqual([
      "U0OWNER",
      "U0ANNA",
      "U0BOB",
      "U0CARL",
      "U0EVE",
    ]);
    expect(mergeSlackHuddles(edit, first).dateEnd).toBe(1794475234);
  });
});

function huddle(
  dateStart: number,
  dateEnd: number | null,
  participantIds: string[],
): Pick<SlackHuddle, "dateStart" | "dateEnd" | "participantIds"> {
  return { dateStart, dateEnd, participantIds };
}

describe("pickHuddleForMeeting", () => {
  const real = huddle(1794473298, 1794475234, ["U0OWNER", "U0ANNA"]);

  it("matches the real huddle to the Clips meeting that started 10 s later", () => {
    expect(
      pickHuddleForMeeting(
        [real],
        { actualStart: "2026-11-12T08:48:28Z" },
        "U0OWNER",
      ),
    ).toBe(real);
  });

  it("needs the owner in the huddle", () => {
    expect(
      pickHuddleForMeeting(
        [real],
        { actualStart: "2026-11-12T08:48:28Z" },
        "U0STRANGER",
      ),
    ).toBeNull();
  });

  it("rejects a huddle that started more than two minutes after the meeting", () => {
    expect(
      pickHuddleForMeeting(
        [huddle(1794473298 + 180, null, ["U0OWNER"])],
        { actualStart: "2026-11-12T08:48:18Z" },
        "U0OWNER",
      ),
    ).toBeNull();
  });

  it("matches a huddle the owner joined late while it still ran", () => {
    const running = huddle(1794473298 - 20 * 60, 1794475234, ["U0OWNER"]);
    expect(
      pickHuddleForMeeting(
        [running],
        { actualStart: "2026-11-12T08:48:18Z" },
        "U0OWNER",
      ),
    ).toBe(running);
    const ended = huddle(1794473298 - 20 * 60, 1794473298 - 10 * 60, ["U0OWNER"]);
    expect(
      pickHuddleForMeeting(
        [ended],
        { actualStart: "2026-11-12T08:48:18Z" },
        "U0OWNER",
      ),
    ).toBeNull();
  });

  it("prefers the huddle that started with the meeting over an older running one", () => {
    const older = huddle(1794473298 - 30 * 60, null, ["U0OWNER"]);
    const close = huddle(1794473298 + 60, null, ["U0OWNER"]);
    const closer = huddle(1794473298 + 5, null, ["U0OWNER"]);
    expect(
      pickHuddleForMeeting(
        [older, close, closer],
        { actualStart: "2026-11-12T08:48:18Z" },
        "U0OWNER",
      ),
    ).toBe(closer);
  });
});

function slackResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("fetchSlackPerson", () => {
  beforeEach(() => clearSlackUserCache());

  it("reads name and e-mail and caches the answer", async () => {
    const fetchImpl = vi.fn(async () =>
      slackResponse({
        ok: true,
        user: {
          id: "U0ANNA",
          name: "anna",
          profile: { real_name: "Anna Smit", email: "Anna@Example.test" },
        },
      }),
    );
    const args = {
      token: "xoxp-test",
      teamId: "T0TEAM",
      slackUserId: "U0ANNA",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };
    expect(await fetchSlackPerson(args)).toEqual({
      slackUserId: "U0ANNA",
      name: "Anna Smit",
      email: "anna@example.test",
    });
    await fetchSlackPerson(args);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns null for bots and throws on a dead token", async () => {
    const bot = vi.fn(async () =>
      slackResponse({ ok: true, user: { id: "U0BOT", is_bot: true } }),
    );
    expect(
      await fetchSlackPerson({
        token: "t",
        teamId: "T0TEAM",
        slackUserId: "U0BOT",
        fetchImpl: bot as unknown as typeof fetch,
      }),
    ).toBeNull();

    const revoked = vi.fn(async () =>
      slackResponse({ ok: false, error: "token_revoked" }),
    );
    await expect(
      fetchSlackPerson({
        token: "t",
        teamId: "T0TEAM",
        slackUserId: "U0ANNA",
        fetchImpl: revoked as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(SlackTokenError);
  });
});

describe("buildHuddleParticipantRows", () => {
  it("adds people with an e-mail once, skips the ones already listed, marks the starter", () => {
    const rows = buildHuddleParticipantRows({
      meetingId: "m1",
      huddle: { dateStart: 1794473298, startedBy: "U0OWNER" },
      people: [
        { slackUserId: "U0OWNER", name: "Owner", email: "owner@example.test" },
        { slackUserId: "U0ANNA", name: "Anna", email: "anna@example.test" },
        { slackUserId: "U0GUEST", name: "Guest", email: null },
        { slackUserId: "U0ANNA2", name: "Anna again", email: "ANNA@example.test" },
        { slackUserId: "U0BOB", name: "Bob", email: "bob@example.test" },
      ],
      existingEmails: ["Bob@Example.test"],
    });
    expect(rows).toEqual([
      {
        meetingId: "m1",
        email: "owner@example.test",
        name: "Owner",
        isOrganizer: true,
        attendedAt: "2026-11-12T08:48:18.000Z",
      },
      {
        meetingId: "m1",
        email: "anna@example.test",
        name: "Anna",
        isOrganizer: false,
        attendedAt: "2026-11-12T08:48:18.000Z",
      },
    ]);
  });
});
