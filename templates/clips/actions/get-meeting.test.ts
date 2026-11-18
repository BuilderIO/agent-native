import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transcript: null as { segmentsJson: string; fullText?: string } | null,
  stored: { bulletsJson: "[]", actionItemsJson: "[]" },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: async () => ({ role: "owner" }),
}));

vi.mock("../server/db/index.js", () => {
  const rows = () => [
    { id: "meeting-1", ...mocks.stored, recordingId: "recording-1" },
  ];
  return {
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: () =>
            Object.assign(Promise.resolve([]), { limit: async () => rows() }),
        }),
      }),
    }),
    schema: {
      meetings: { id: "id", trashedAt: "trashedAt" },
      meetingParticipants: { meetingId: "meetingId" },
      meetingActionItems: { meetingId: "meetingId" },
    },
  };
});

vi.mock("../server/lib/calendar-event-meetings.js", () => ({
  materializeCalendarMeetingFromVirtualId: async () => null,
  parseCalendarMeetingId: () => null,
}));

vi.mock("../server/lib/meeting-recording-access.js", () => ({
  loadMeetingRecordingContent: async () => ({
    recording: null,
    transcript: mocks.transcript,
  }),
}));

import getMeeting from "./get-meeting";
import { AGENT_TRANSCRIPT_MAX_CHARS } from "./lib/transcript-preview";

const earlier = {
  startMs: 0,
  endMs: 300_000,
  text: "Earlier",
  recovered: true,
};

async function minutes() {
  const result = await getMeeting.run({ id: "meeting-1" });
  return "earlierAudioMinutes" in result ? result.earlierAudioMinutes : null;
}

describe("get-meeting earlierAudioMinutes", () => {
  beforeEach(() => {
    mocks.transcript = null;
  });

  it("reports how much earlier audio the transcript holds", async () => {
    mocks.transcript = { segmentsJson: JSON.stringify([earlier]) };

    await expect(minutes()).resolves.toBe(5);
  });

  it("still reports it when another segment can't be read", async () => {
    mocks.transcript = {
      segmentsJson: JSON.stringify([
        earlier,
        { startMs: "not a time", endMs: 400_000, text: "Unreadable" },
      ]),
    };

    await expect(minutes()).resolves.toBe(5);
  });

  it("says when the transcript can't be read instead of reporting none", async () => {
    mocks.transcript = { segmentsJson: "not json" };

    const result = await getMeeting.run({ id: "meeting-1" });

    expect(result).toHaveProperty("earlierAudioMinutes", null);
  });

  it("reports none when there's no earlier audio or no transcript", async () => {
    await expect(minutes()).resolves.toBe(0);

    mocks.transcript = {
      segmentsJson: JSON.stringify([
        { startMs: 0, endMs: 1000, text: "The meeting itself" },
      ]),
    };

    await expect(minutes()).resolves.toBe(0);
  });
});

describe("get-meeting transcript", () => {
  const fullText = `Me: ${"a".repeat(AGENT_TRANSCRIPT_MAX_CHARS)}\n\nThem: tail`;
  const segmentsJson = JSON.stringify([
    earlier,
    { startMs: 300_000, endMs: 301_000, text: "tail", source: "system" },
  ]);
  const agentCall = (caller: string, transcriptOffset?: number) =>
    getMeeting.run({ id: "meeting-1", transcriptOffset }, { caller } as never);

  beforeEach(() => {
    mocks.transcript = { fullText, segmentsJson };
    mocks.stored = { bulletsJson: "[]", actionItemsJson: "[]" };
  });

  it.each(["mcp", "a2a", "tool", "webmcp"])(
    "gives a %s caller a chunk and where to continue",
    async (caller) => {
      const result = await agentCall(caller);

      expect(result).toMatchObject({
        transcript: {
          fullText: fullText.slice(0, AGENT_TRANSCRIPT_MAX_CHARS),
          fullTextLength: fullText.length,
          nextFullTextOffset: AGENT_TRANSCRIPT_MAX_CHARS,
          segmentCount: 2,
          segments: [
            expect.objectContaining({ text: "Earlier" }),
            expect.objectContaining({ text: "tail", source: "system" }),
          ],
          note: expect.stringContaining(
            `call get-meeting again with transcriptOffset=${AGENT_TRANSCRIPT_MAX_CHARS}`,
          ),
        },
      });
      expect(result).not.toHaveProperty("transcript.segmentsJson");
    },
  );

  it("reads the rest of the transcript from the offset it was given", async () => {
    const result = await agentCall("mcp", AGENT_TRANSCRIPT_MAX_CHARS);

    expect(result).toMatchObject({
      transcript: {
        fullText: fullText.slice(AGENT_TRANSCRIPT_MAX_CHARS),
        nextFullTextOffset: null,
        segments: [],
      },
    });
  });

  it("still reports earlier audio from the whole transcript", async () => {
    const result = await agentCall("mcp", AGENT_TRANSCRIPT_MAX_CHARS);

    expect(result).toHaveProperty("earlierAudioMinutes", 5);
  });

  it("leaves the app's own reads whole", async () => {
    for (const result of [
      await getMeeting.run({ id: "meeting-1" }),
      await agentCall("frontend"),
    ]) {
      expect(result).toHaveProperty("transcript", { fullText, segmentsJson });
    }
  });

  it("gives an agent each meeting detail once", async () => {
    const { meeting } = await agentCall("mcp");

    expect(meeting).toMatchObject({ id: "meeting-1", bullets: [] });
    for (const field of [
      "bulletsJson",
      "actionItemsJson",
      "actionItemsParsed",
    ]) {
      expect(meeting).not.toHaveProperty(field);
    }
    expect((await agentCall("frontend")).meeting).toMatchObject({
      bulletsJson: "[]",
      actionItemsJson: "[]",
      actionItemsParsed: [],
    });
  });

  it("tells an agent a stored list it can't read from an empty one", async () => {
    mocks.stored = { bulletsJson: "not json", actionItemsJson: '{"text":"x"}' };
    const result = await agentCall("mcp");

    expect(result.meeting).toMatchObject({ bullets: null });
    expect(result).toHaveProperty("actionItems", null);
    expect((await agentCall("frontend")).meeting).toMatchObject({
      bullets: [],
      actionItemsParsed: [],
    });
  });

  it("tells an agent the transcript's segments can't be read", async () => {
    mocks.transcript = { fullText: "Me: hi", segmentsJson: "not json" };

    expect(await agentCall("mcp")).toMatchObject({
      transcript: {
        fullText: "Me: hi",
        segments: [],
        segmentCount: null,
        segmentsUnreadable: true,
        note: expect.stringContaining("couldn't be read"),
      },
    });
    mocks.transcript = { fullText, segmentsJson };
    expect(await agentCall("mcp")).toMatchObject({
      transcript: { segmentsUnreadable: false },
    });
  });

  it("returns no transcript to an agent when the meeting has none", async () => {
    mocks.transcript = null;

    await expect(agentCall("mcp")).resolves.toHaveProperty("transcript", null);
  });
});
