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
    await seedRecording(client, { id: "rec_2" });
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

  it("returns 404 recording_not_found for a Clip that was permanently deleted", async () => {
    mocks.roles = {};

    await expect(
      action.run({ recordingId: "rec_deleted" }),
    ).rejects.toMatchObject({
      errorCode: "recording_not_found",
      statusCode: 404,
    });
  });

  it("keeps 403 for an existing Clip with context that the caller cannot access", async () => {
    await seedRecording(client, {
      id: "rec_other",
      ownerEmail: "someone-else@example.com",
    });
    await seedContextItem(client, {
      id: "other_item",
      recordingId: "rec_other",
    });
    mocks.roles = {};

    const error = await action
      .run({ recordingId: "rec_other" })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ statusCode: 403 });
    expect(error).not.toMatchObject({ errorCode: "recording_not_found" });
  });
});
