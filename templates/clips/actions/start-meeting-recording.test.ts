import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  meeting: null as null | Record<string, unknown>,
  existingRecording: null as null | Record<string, unknown>,
  inserted: [] as Record<string, unknown>[],
  trackRecordingCreated: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (action: unknown) => action,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: async () => {},
}));
vi.mock("@agent-native/core/sharing", () => ({ assertAccess: async () => {} }));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (column: unknown) => ({ column }),
}));
vi.mock("../server/lib/recording-created.js", () => ({
  trackRecordingCreated: (...args: unknown[]) =>
    state.trackRecordingCreated(...args),
}));
vi.mock("../server/lib/calendar-event-meetings.js", () => ({
  materializeCalendarMeetingFromVirtualId: async () => null,
  parseCalendarMeetingId: () => null,
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
  getActiveOrganizationId: async () => "org-1",
  nanoid: () => "rec-meeting",
}));
vi.mock("../server/db/index.js", () => ({
  schema: {
    meetings: { id: "meetings.id", table: "meetings" },
    recordings: { id: "recordings.id", table: "recordings" },
  },
  getDb: () => ({
    select: () => ({
      from: (table: { table: string }) => ({
        where: () => ({
          limit: async () =>
            table.table === "meetings"
              ? state.meeting
                ? [state.meeting]
                : []
              : state.existingRecording
                ? [state.existingRecording]
                : [],
        }),
      }),
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        state.inserted.push(values);
      },
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  }),
}));

import startMeetingRecording from "./start-meeting-recording";

const action = startMeetingRecording as unknown as {
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

describe("start-meeting-recording recording_created", () => {
  beforeEach(() => {
    state.trackRecordingCreated.mockReset();
    state.inserted = [];
    state.existingRecording = null;
    state.meeting = {
      id: "meeting-1",
      title: "Standup",
      recordingId: null,
      visibility: "private",
    };
  });

  it("reports the new meeting recording once, as a desktop meeting, on the row and the event", async () => {
    await action.run({
      meetingId: "meeting-1",
      hasAudio: true,
      hasCamera: false,
    });

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({ recordingPlatform: "desktop" });
    expect(state.trackRecordingCreated).toHaveBeenCalledExactlyOnceWith({
      recordingId: "rec-meeting",
      userId: "owner@example.com",
      platform: "desktop",
      source: "meeting",
      hasAudio: true,
      hasCamera: false,
    });
  });

  it("does not report a meeting that already has its recording", async () => {
    state.meeting = { ...state.meeting, recordingId: "rec-existing" };
    state.existingRecording = { id: "rec-existing", status: "uploading" };

    await action.run({ meetingId: "meeting-1" });

    expect(state.inserted).toHaveLength(0);
    expect(state.trackRecordingCreated).not.toHaveBeenCalled();
  });
});
