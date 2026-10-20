import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getDefaultRecordingVisibility: vi.fn(),
  getRequestUserName: vi.fn(),
  resolveAccess: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserName: (...args: unknown[]) => mocks.getRequestUserName(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
  isNull: (column: unknown) => ({ type: "isNull", column }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: {
    calendarEvents: {
      id: "calendarEvents.id",
      meetingId: "calendarEvents.meetingId",
    },
    meetings: { id: "meetings.id" },
    meetingParticipants: {},
  },
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
  getActiveOrganizationId: async () => "org-1",
  getDefaultRecordingVisibility: (...args: unknown[]) =>
    mocks.getDefaultRecordingVisibility(...args),
  nanoid: () => "meeting-1",
}));

import action from "./create-meeting.js";

function createDb() {
  const updates: Record<string, unknown>[] = [];
  const event = {
    id: "event-1",
    calendarAccountId: "account-1",
    meetingId: null,
    title: "Planning",
    start: "2026-10-02T10:00:00.000Z",
    end: "2026-10-02T11:00:00.000Z",
    joinUrl: "https://meet.google.com/example",
    attendeesJson: "[]",
    organizerEmail: "owner@example.com",
  };
  const db = {
    updates,
    select: vi.fn(() => {
      const builder = {
        from: () => builder,
        where: () => builder,
        limit: async () => [event],
      };
      return builder;
    }),
    update: vi.fn(() => {
      let patch: Record<string, unknown> = {};
      return {
        set(values: Record<string, unknown>) {
          patch = values;
          updates.push(values);
          return {
            where() {
              return patch.meetingId === "meeting-1"
                ? { returning: async () => [{ id: "event-1" }] }
                : Promise.resolve(undefined);
            },
          };
        },
      };
    }),
  };
  return db;
}

describe("create-meeting calendar event claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAccess.mockResolvedValue(true);
  });

  it("releases the event claim when resolving default visibility fails", async () => {
    const failure = new Error("organization settings unavailable");
    const db = createDb();
    mocks.getDb.mockReturnValue(db);
    mocks.getDefaultRecordingVisibility.mockRejectedValue(failure);

    await expect(
      action.run(action.schema.parse({ calendarEventId: "event-1" }), {
        userEmail: "owner@example.com",
      }),
    ).rejects.toBe(failure);

    expect(db.updates.map((patch) => patch.meetingId)).toEqual([
      "meeting-1",
      null,
    ]);
  });
});
