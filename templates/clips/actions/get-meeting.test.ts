import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transcript: null as { segmentsJson: string } | null,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: async () => ({ role: "owner" }),
}));

vi.mock("../server/db/index.js", () => {
  const rows = [
    {
      id: "meeting-1",
      bulletsJson: "[]",
      actionItemsJson: "[]",
      recordingId: "recording-1",
    },
  ];
  return {
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: () =>
            Object.assign(Promise.resolve([]), { limit: async () => rows }),
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
