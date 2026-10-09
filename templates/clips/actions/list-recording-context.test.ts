import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  openRecordingContextTestDb,
  resetRecordingContextTestDb,
  seedContextItem,
  seedRecording,
  type RecordingContextTestClient,
} from "../server/lib/recording-context-test-db.js";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  roles: {} as Record<string, "viewer" | "editor" | "owner" | undefined>,
}));

vi.mock("@agent-native/core/action", async () => {
  const fakes = await import("../server/lib/recording-context-test-db.js");
  return { defineAction: (options: unknown) => options, fail: fakes.testFail };
});

vi.mock("@agent-native/core/sharing", async () => {
  const fakes = await import("../server/lib/recording-context-test-db.js");
  return {
    assertAccess: (
      _type: string,
      id: string,
      minRole?: "viewer" | "editor" | "owner",
    ) => fakes.testAssertAccess(mocks.roles, id, minRole),
  };
});

vi.mock("../server/db/index.js", async () => {
  const schema = await import("../server/db/schema.js");
  return { getDb: () => mocks.db, schema };
});

import action from "./list-recording-context";

let client: RecordingContextTestClient;

beforeAll(async () => {
  const opened = await openRecordingContextTestDb();
  client = opened.client;
  mocks.db = opened.db;
});

beforeEach(async () => {
  await resetRecordingContextTestDb(client);
  mocks.roles = { rec_1: "viewer" };
  await seedRecording(client, { id: "rec_1" });
});

afterAll(async () => {
  await client.close();
});

describe("list-recording-context", () => {
  it("lets a viewer list the active item and leaves out removed ones", async () => {
    await seedContextItem(client, {
      id: "active",
      status: "ready",
      mediaRecordingId: "media_1",
    });
    await seedContextItem(client, {
      id: "old",
      recordingId: "rec_2",
      status: "removed",
    });
    mocks.roles = { rec_1: "viewer", rec_2: "viewer" };

    const { items } = await action.run({ recordingId: "rec_1" });
    expect(items.map((item) => item.id)).toEqual(["active"]);
    expect(items[0]).toMatchObject({
      recordingId: "rec_1",
      status: "ready",
      mediaRecordingId: "media_1",
    });

    const removedOnly = await action.run({ recordingId: "rec_2" });
    expect(removedOnly.items).toEqual([]);
  });

  it("returns an empty list when the Clip has no context", async () => {
    await expect(action.run({ recordingId: "rec_1" })).resolves.toEqual({
      items: [],
    });
  });

  it("refuses a caller with no access to the Clip", async () => {
    mocks.roles = {};

    await expect(action.run({ recordingId: "rec_1" })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
