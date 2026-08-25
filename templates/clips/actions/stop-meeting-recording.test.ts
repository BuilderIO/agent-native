import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getDb: vi.fn(),
  shareResource: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

vi.mock("@agent-native/core/sharing/actions/share-resource", () => ({
  default: {
    run: (...args: unknown[]) => mocks.shareResource(...args),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    strings: Array.from(strings),
    values,
  }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.getDb(),
  schema: {
    meetings: {
      id: "meetings.id",
      actualEnd: "meetings.actualEnd",
      updatedAt: "meetings.updatedAt",
      transcriptStatus: "meetings.transcriptStatus",
      meetingId: "meetings.id",
      ownerEmail: "meetings.ownerEmail",
      visibility: "meetings.visibility",
    },
    meetingParticipants: {
      email: "meetingParticipants.email",
      meetingId: "meetingParticipants.meetingId",
    },
    recordingTranscripts: {
      recordingId: "recordingTranscripts.recordingId",
      fullText: "recordingTranscripts.fullText",
    },
    recordings: {
      id: "recordings.id",
      status: "recordings.status",
      updatedAt: "recordings.updatedAt",
      visibility: "recordings.visibility",
    },
  },
}));

import action from "./stop-meeting-recording";

function createDb(results: unknown[][]) {
  let selectIndex = 0;
  const updateBuilder = {
    set: vi.fn(() => updateBuilder),
    where: vi.fn(async () => undefined),
  };
  const db = {
    select: vi.fn(() => {
      const rows = results[selectIndex++] ?? [];
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(async () => rows),
        then: (
          resolve: (value: unknown[]) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return builder;
    }),
    update: vi.fn(() => updateBuilder),
  };
  return db;
}

function meeting(overrides: Record<string, unknown> = {}) {
  return {
    id: "meeting-1",
    recordingId: "recording-1",
    visibility: "public",
    ownerEmail: "owner@example.com",
    actualEnd: null,
    ...overrides,
  };
}

describe("stop-meeting-recording participant access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAccess.mockResolvedValue({ role: "owner" });
    mocks.shareResource.mockResolvedValue({ id: "share-1" });
    mocks.writeAppState.mockResolvedValue(undefined);
  });

  it("shares a public meeting and its public recording with attendees", async () => {
    const db = createDb([
      [meeting()],
      [{ fullText: "Welcome to the call." }],
      [{ visibility: "public" }],
      [
        { email: "OWNER@example.com" },
        { email: "Colleague@example.com" },
        { email: "colleague@example.com" },
      ],
    ]);
    mocks.getDb.mockReturnValue(db);

    await action.run({ meetingId: "meeting-1" });

    expect(mocks.shareResource).toHaveBeenCalledTimes(2);
    expect(mocks.shareResource).toHaveBeenCalledWith({
      resourceType: "meeting",
      resourceId: "meeting-1",
      principalType: "user",
      principalId: "colleague@example.com",
      role: "viewer",
      notify: false,
    });
    expect(mocks.shareResource).toHaveBeenCalledWith({
      resourceType: "recording",
      resourceId: "recording-1",
      principalType: "user",
      principalId: "colleague@example.com",
      role: "viewer",
      notify: false,
    });
  });

  it("shares a public meeting without widening a separately private recording", async () => {
    const db = createDb([
      [meeting()],
      [{ fullText: "Welcome to the call." }],
      [{ visibility: "private" }],
      [{ email: "colleague@example.com" }],
    ]);
    mocks.getDb.mockReturnValue(db);

    await action.run({ meetingId: "meeting-1" });

    expect(mocks.shareResource).toHaveBeenCalledTimes(1);
    expect(mocks.shareResource).toHaveBeenCalledWith({
      resourceType: "meeting",
      resourceId: "meeting-1",
      principalType: "user",
      principalId: "colleague@example.com",
      role: "viewer",
      notify: false,
    });
  });

  it("does not auto-share non-public meetings", async () => {
    const db = createDb([
      [meeting({ visibility: "org" })],
      [{ fullText: "Welcome to the call." }],
      [{ visibility: "org" }],
    ]);
    mocks.getDb.mockReturnValue(db);

    await action.run({ meetingId: "meeting-1" });

    expect(mocks.shareResource).not.toHaveBeenCalled();
  });
});
